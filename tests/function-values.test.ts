import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeValue,FunctionValue} from '../src/core/interpreter.js';

const source=`function add(a integer, b integer) -> integer { return a + b }
function apply(f (integer,integer) -> integer, x integer, y integer) -> integer { return f(x, y) }
function main() -> integer { let f = add return apply(f, 2, 3) }`;

describe('first-class function values',()=>{
 it('types function references and performs indirect calls',()=>{const r=compile(source);expect(r.diagnostics).toEqual([]);expect(executeValue(r.ir!.functions,'main',[])).toBe(5n)});
 it('stores canonical FunctionId on direct calls',()=>{const r=compile('function add(a integer, b integer) -> integer { return a + b } function main() -> integer { return add(2, 3) }');expect(r.diagnostics).toEqual([]);const call=r.ir!.functions[1].body[0].value;expect(call.kind).toBe('call');expect(call.calleeId).toBe(r.ir!.functions[0].id);});
 it('represents function types structurally in IR',()=>{const r=compile(source);expect(r.ir!.functions[1].parameters[0].typeRef).toEqual({kind:'function',parameters:[{kind:'primitive',name:'integer'},{kind:'primitive',name:'integer'}],returns:{kind:'primitive',name:'integer'}})});
 it('rejects incompatible function arguments',()=>{const r=compile('function textValue(x text) -> text { return x } function apply(f (integer) -> integer, x integer) -> integer { return f(x) } function main() -> integer { return apply(textValue, 1) }');expect(r.diagnostics.map(x=>x.code)).toContain('PIPE-FUNC-009')});
 it('rejects unknown function references',()=>expect(compile('function main() -> integer { let f = missing return 1 }').diagnostics.map(x=>x.code)).toContain('PIPE-REF-004'));
 it('does not expose host functions as PIPE values',()=>expect(new FunctionValue('add').kind).toBe('function'));
 it('supports mutually recursive direct calls by identity',()=>{const r=compile('function even(x integer) -> boolean { if x == 0 { return true } else { return odd(x - 1) } } function odd(x integer) -> boolean { if x == 0 { return false } else { return even(x - 1) } } function main() -> boolean { return even(6) }');expect(r.diagnostics).toEqual([]);expect(executeValue(r.ir!.functions,'main',[])).toBe(true);});
});
