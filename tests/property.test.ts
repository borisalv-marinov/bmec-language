import {describe, expect, it} from 'vitest';
import fc from 'fast-check';
import {compile, compileProject} from '../src/compiler.js';
import {PipeLexError} from '../src/lexer/lexer.js';
import {PipeParseError} from '../src/parser/parser.js';
import {executeValue, Money, PipeRuntimeError} from '../src/core/interpreter.js';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parse} from '../src/parser/parser.js';
import {buildDeclarationIndex} from '../src/semantic/declaration-index.js';

const runs = Number(process.env.PIPE_FUZZ_RUNS ?? 100);
const seed = 20260915;
const intMin = -(2n ** 63n);
const intMax = 2n ** 63n - 1n;

const word = fc.tuple(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'), {maxLength: 79}),
).map(([first, rest]) => first + rest.join(''));
const malformedSource = fc.array(fc.constantFrom(...'{}()=+-*/<>!@#$%^&;\n\t abc123\"\'😀'), {maxLength: 220}).map(xs => xs.join(''));
const int64 = fc.bigInt({min: intMin, max: intMax});
const safeCents = fc.integer({min: -100_000, max: 100_000});

function property<T>(p: fc.IProperty<T>): void {
  fc.assert(p, {seed, numRuns: runs, endOnFailure: true});
}

describe('fast-check compiler hardening', () => {
  it('keeps declaration and interface requirement identities deterministic', () => {
    property(fc.property(word, name => {
      const source = `interface ${name} { print(self) -> text }`;
      const a = buildDeclarationIndex(parse(source, 'property.pipe'));
      const b = buildDeclarationIndex(parse(source, 'property.pipe'));
      expect([...a.interfaces.keys()]).toEqual([...b.interfaces.keys()]);
      expect([...a.interfaceMethods.keys()]).toEqual([...b.interfaceMethods.keys()]);
    }));
  });
  it('never turns generated malformed source into an uncontrolled host exception', () => {
    property(fc.property(malformedSource, source => {
      try {
        compile(source, '<property-fuzz>');
      } catch (error) {
        expect(error instanceof PipeParseError || error instanceof PipeLexError).toBe(true);
      }
    }));
  });

  it('preserves every generated signed int64 literal exactly in semantic IR', () => {
    property(fc.property(int64, value => {
      const result = compile(`function value() -> integer { return ${value.toString()} }`);
      expect(result.diagnostics).toEqual([]);
      const expression = result.ir!.functions[0].body[0];
      expect(expression.kind).toBe('return');
      if (value < 0n && value !== intMin) {
        expect(expression.value.kind).toBe('unary');
        expect(expression.value.operator).toBe('-');
        expect(expression.value.operand?.kind).toBe('literal');
        expect(expression.value.operand?.value).toBe((-value).toString());
      } else {
        expect(expression.value.kind).toBe('literal');
        expect(expression.value.value).toBe(value.toString());
      }
    }));
  });

  it('checks integer arithmetic exactly when the result is within int64', () => {
    property(fc.property(int64, int64, fc.constantFrom('+', '-', '*'), (a, b, operator) => {
      const expected = operator === '+' ? a + b : operator === '-' ? a - b : a * b;
      fc.pre(expected >= intMin && expected <= intMax && expected >= -(2n ** 53n) && expected <= 2n ** 53n);
      const result = compile(`function value() -> integer { return ${a} ${operator} ${b} }`);
      expect(result.diagnostics).toEqual([]);
      expect(executeValue(result.ir!.functions, 'value', [])).toBe(expected);
    }));
  });

  it('reports structured integer overflow at runtime', () => {
    property(fc.property(int64, int64, fc.constantFrom('+', '-', '*'), (a, b, operator) => {
      const expected = operator === '+' ? a + b : operator === '-' ? a - b : a * b;
      fc.pre(expected < intMin || expected > intMax);
      const result = compile(`function value() -> integer { return ${a} ${operator} ${b} }`);
      expect(() => executeValue(result.ir!.functions, 'value', [])).toThrowError(PipeRuntimeError);
      try { executeValue(result.ir!.functions, 'value', []); } catch (error) {
        expect(error).toMatchObject({code: 'PIPE-RUNTIME-004'});
      }
    }));
  });

  it('preserves fixed-point money minor units and arithmetic', () => {
    property(fc.property(safeCents, safeCents, (a, b) => {
      const money = (minor: number) => `${minor < 0 ? '-' : ''}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;
      const source = `function value() -> money { return ${money(a)} + ${money(b)} }`;
      const result = compile(source);
      expect(result.diagnostics).toEqual([]);
      const expression = result.ir!.functions[0].body[0];
      expect(expression.kind).toBe('return');
      expect(expression.value.kind).toBe('binary');
      expect(executeValue(result.ir!.functions, 'value', [])).toEqual(new Money(BigInt(a + b)));
    }));
  });

  it('accepts only boolean operands for boolean operators', () => {
    property(fc.property(fc.boolean(), fc.boolean(), (a, b) => {
      const result = compile(`function value() -> boolean { return ${a} and ${b} }`);
      expect(result.diagnostics).toEqual([]);
      expect(executeValue(result.ir!.functions, 'value', [])).toBe(a && b);
    }));
  });

  it('reports invalid type/operator combinations structurally', () => {
    property(fc.property(fc.constantFrom('1 + true', 'true + 1', '1 and false', '"x" - "y"'), expression => {
      const result = compile(`function value() -> integer { return ${expression} }`);
      expect(result.diagnostics.some(d => d.code === 'PIPE-TYPE-005')).toBe(true);
    }));
  });

  it('keeps repeated compilation deterministic', () => {
    property(fc.property(word, fc.integer({min: 0, max: 1000}), (name, value) => {
      const source = `app ${name}\nmodel ${name}Model { count integer default ${value} }`;
      const left = compile(source, '<determinism>');
      const right = compile(source, '<determinism>');
      expect(JSON.stringify(left.diagnostics)).toBe(JSON.stringify(right.diagnostics));
      expect(JSON.stringify(left.ir)).toBe(JSON.stringify(right.ir));
    }));
  });

  it('keeps imports non-transitive and rejects generated paths outside the root', () => {
    property(fc.property(word, word, (symbol, external) => {
      const root = mkdtempSync(join(tmpdir(), 'pipe-property-'));
      const entry = join(root, 'main.pipe');
      writeFileSync(entry, `import { ${symbol} } from "./library.pipe"\napp Main\npage Home { crud ${symbol} }`);
      writeFileSync(join(root, 'library.pipe'), `import { ${external} } from "../outside.pipe"\nmodel ${symbol} {}`);
      const result = compileProject(entry);
      expect(result.diagnostics.some(d => d.code === 'PIPE-MOD-003' || d.code === 'PIPE-MOD-010')).toBe(true);
    }));
  }, 120_000);

  it('keeps module, symbol, and function identities deterministic', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipe-identity-'));
    const entry = join(root, 'main.pipe');
    writeFileSync(entry, 'import { add } from "./math.pipe"\nfunction main() -> integer { return add(2, 3) }');
    writeFileSync(join(root, 'math.pipe'), 'public function add(a integer, b integer) -> integer { return a + b }');
    const left = compileProject(entry);
    const right = compileProject(entry);
    expect(left.diagnostics).toEqual([]);
    expect(right.diagnostics).toEqual([]);
    expect(left.modules.map(m => [m.id, m.symbolIds])).toEqual(right.modules.map(m => [m.id, m.symbolIds]));
    expect(left.ir?.functions.map(f => f.id)).toEqual(right.ir?.functions.map(f => f.id));
  });

  it('keeps ordered closure captures and TypeRefs stable across compilation', () => {
    const source = 'function make(a integer, b integer) -> (integer) -> integer { return lambda(x integer) -> integer { return a + b + x } }';
    const left = compile(source, '<closure-property>');
    const right = compile(source, '<closure-property>');
    expect(left.diagnostics).toEqual([]);
    expect(right.diagnostics).toEqual([]);
    expect(left.ir?.functions[0].body[0].value?.captures).toEqual(['a', 'b']);
    expect(left.ir?.functions[0].body[0].value?.lambda?.id).toBe(right.ir?.functions[0].body[0].value?.lambda?.id);
    expect(left.ir?.functions[0].parameters.map(p => p.typeRef)).toEqual(right.ir?.functions[0].parameters.map(p => p.typeRef));
  });
});
