import {describe, expect, it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeAsyncValue, executeValue, NoneValue, TaskValue} from '../src/core/interpreter.js';
import {validateSerializedIR} from '../src/ir/validate.js';
import {issueCapability,SecretValue} from '../src/runtime/capabilities.js';
import {parseAsync} from '../src/parser/async.js';

describe('PIPE compiler-owned async language', () => {
  it('parses, types, lowers, and executes async task composition', async () => {
    const result = compile('app Async\nasync function one() -> task<integer> { return 1 }\nasync function two() -> task<integer> { return await one() }');
    expect(result.diagnostics).toEqual([]);
    expect(validateSerializedIR(JSON.parse(JSON.stringify(result.ir)))).toEqual({valid: true, errors: []});
    expect(result.ir?.functions.map(fn => ({name: fn.name, async: fn.async, type: fn.returnType}))).toEqual([
      {name: 'one', async: true, type: 'task<integer>'},
      {name: 'two', async: true, type: 'task<integer>'},
    ]);
    const immediate = executeAsyncValue(result.ir!.functions, 'one', []);
    expect(await immediate).toBe(1n);
    await expect(executeAsyncValue(result.ir!.functions, 'two', [])).resolves.toBe(1n);
    expect(executeValue(result.ir!.functions, 'one', [])).toBeInstanceOf(TaskValue);
  });

  it('preserves source offsets when lowering async declarations through the parser', () => {
    const source = 'app Async\nasync function one() -> task<integer> { return 1 }';
    const program = parseAsync(source, 'async.pipe');
    expect(program.declarations[1]?.span.start.offset).toBe(source.indexOf('async'));
  });

  it('rejects await on a non-task and async functions without task results', () => {
    expect(compile('app Bad\nasync function bad() -> integer { return 1 }').diagnostics.map(error => error.code)).toContain('PIPE-ASYNC-002');
    expect(compile('app Bad\nfunction bad() -> integer { return 1 }\nfunction caller() -> integer { return await bad() }').diagnostics.map(error => error.code)).toContain('PIPE-ASYNC-001');
    expect(compile('app Bad\nfunction caller() -> integer { return await 1 }').diagnostics.map(error => error.code)).toContain('PIPE-ASYNC-003');
  });

  it('reports a useful fix when an awaited database operation is written as a standalone statement', () => {
    const invalid = compile('app Store\nmodel Item { name text required }\nasync function seed(db capability<database>) -> task<integer> {\n  let item = Item { name: "Book" }\n  await add item to Item using db\n  return 1\n}');
    expect(invalid.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PIPE-SYN-005',
        message: expect.stringContaining('cannot stand alone'),
        suggestions: ['Use let inserted = await add item to Item using db'],
      }),
    ]);

    const valid = compile('app Store\nmodel Item { name text required }\nasync function seed(db capability<database>) -> task<integer> {\n  let item = Item { name: "Book" }\n  let inserted = await add item to Item using db\n  return inserted\n}');
    expect(valid.diagnostics).toEqual([]);
  });

  it('rejects malformed async metadata at the serialized IR boundary', () => {
    const result = compile('app Async\nasync function one() -> task<integer> { return 1 }');
    const ir = JSON.parse(JSON.stringify(result.ir));
    ir.functions[0].async = 'yes';
    expect(validateSerializedIR(ir).valid).toBe(false);
    ir.functions[0].async = true;
    ir.functions[0].returnTypeRef = {kind: 'primitive', name: 'integer'};
    ir.functions[0].returnType = 'integer';
    expect(validateSerializedIR(ir).valid).toBe(false);
  });

  it('exposes host-issued capabilities to source effects without making them constructible', () => {
    const result = compile('app Effects\nfunction now(time capability<time>) -> integer { return currentTime(time) }\nfunction sample(random capability<random>) -> number { return randomNumber(random) }\nfunction identifier(random capability<random>) -> id { return randomId(random) }');
    expect(result.diagnostics).toEqual([]);
    expect(executeValue(result.ir!.functions, 'now', [issueCapability('time')])).toEqual(expect.any(BigInt));
    expect(executeValue(result.ir!.functions, 'sample', [issueCapability('random')])).toEqual(expect.any(Number));
    const generated = executeValue(result.ir!.functions, 'identifier', [issueCapability('random')]);
    expect(generated).toEqual(expect.objectContaining({kind:'id'}));
    expect(String(generated)).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => executeValue(result.ir!.functions, 'now', [issueCapability('random')])).toThrow('PIPE-EFFECT-002');
    expect(() => executeValue(result.ir!.functions, 'identifier', [issueCapability('time')])).toThrow('PIPE-EFFECT-002');
    expect(compile('app BadEffects\nfunction bad(random capability<random>) -> integer { return currentTime(random) }').diagnostics.map(error => error.code)).toContain('PIPE-FUNC-009');
  });

  it('supports typed optional environment reads and opaque source secrets', () => {
    const previous = process.env.PIPE_SOURCE_SECRET;
    process.env.PIPE_SOURCE_SECRET = 'hidden-value';
    try {
      const result = compile('app Env\nfunction read(env capability<environment>) -> text? { return environmentText(env, "PIPE_SOURCE_MISSING") }\nfunction load(env capability<environment>) -> secret<text>? { return environmentSecret(env, "PIPE_SOURCE_SECRET") }\nfunction reveal(value secret<text>, env capability<environment>) -> text { return revealSecret(value, env) }');
      expect(result.diagnostics).toEqual([]);
      const env = issueCapability('environment');
      expect(executeValue(result.ir!.functions, 'read', [env])).toBeInstanceOf(NoneValue);
      const value = executeValue(result.ir!.functions, 'load', [env]);
      expect(value).toBeInstanceOf(SecretValue);
      expect(executeValue(result.ir!.functions, 'reveal', [value, env])).toBe('hidden-value');
      expect(() => executeValue(result.ir!.functions, 'read', [issueCapability('time')])).toThrow('PIPE-EFFECT-002');
      expect(() => executeValue(result.ir!.functions, 'reveal', [value, issueCapability('time')])).toThrow('PIPE-EFFECT-002');
    } finally {
      if (previous === undefined) delete process.env.PIPE_SOURCE_SECRET; else process.env.PIPE_SOURCE_SECRET = previous;
    }
  });
});
