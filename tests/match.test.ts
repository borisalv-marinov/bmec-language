import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeValue,VariantValue,ResultValue,PIPE_NONE} from '../src/core/interpreter.js';
import {deserializeValue,serializeValue} from '../src/runtime/value-contract.js';

const source=`enum Status { Pending Running Done Failed(text) }
function describe(status Status) -> text {
 return match status { Pending => "pending", Running => "running", Done => "done", Failed(message) => message }
}`;

describe('enum matching',()=>{
 it('parses, types, lowers, and interprets exhaustive matches',()=>{
  const result=compile(source,'match.pipe');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir?.functions[0].body[0].value?.kind).toBe('match');
  expect(executeValue(result.ir!.functions,'describe',[new VariantValue('Status','Pending')])).toBe('pending');
  expect(executeValue(result.ir!.functions,'describe',[new VariantValue('Status','Failed','broken')])).toBe('broken');
 });
 it('rejects missing variants',()=>expect(compile('enum S { A B } function f(x S) -> text { return match x { A => "a" } }').diagnostics.map(x=>x.code)).toContain('PIPE-MATCH-007'));
 it('rejects duplicate and unknown arms',()=>{const d=compile('enum S { A } function f(x S) -> text { return match x { A => "a", A => "b", Nope => "n" } }').diagnostics.map(x=>x.code);expect(d).toContain('PIPE-MATCH-003');expect(d).toContain('PIPE-MATCH-002')});
 it('checks payload bindings',()=>{const d=compile('enum S { A B(text) } function f(x S) -> text { return match x { A(message) => "a", B => "b" } }').diagnostics.map(x=>x.code);expect(d).toContain('PIPE-MATCH-004');expect(d).toContain('PIPE-MATCH-005')});
 it('unifies arm result types',()=>expect(compile('enum S { A B } function f(x S) -> text { return match x { A => "a", B => 2 } }').diagnostics.map(x=>x.code)).toContain('PIPE-MATCH-006'));
 it('round-trips explicit enum value contracts',()=>{const value={kind:'enum' as const,type:{kind:'enum' as const,name:'S',symbol:'m::S',variants:[{name:'A'}]},variant:'A'};expect(deserializeValue(serializeValue(value))).toEqual(value)});
 it('rejects non-enum scrutinees',()=>expect(compile('function f(x text) -> text { return match x { A => "a" } }').diagnostics.map(x=>x.code)).toContain('PIPE-MATCH-001'));
 it('supports wildcard, Result, and optional patterns',()=>{
  const wildcard=compile('enum S { A B } function f(x S) -> text { return match x { A => "a", _ => "other" } }');
  expect(wildcard.diagnostics).toEqual([]); expect(executeValue(wildcard.ir!.functions,'f',[new VariantValue('S','B')])).toBe('other');
  const result=compile('function f(x result<integer,text>) -> text { return match x { ok(value) => "ok", err(error) => error } }');
  expect(result.diagnostics).toEqual([]); expect(executeValue(result.ir!.functions,'f',[new ResultValue('err','bad')])).toBe('bad');
  const optional=compile('function f(x integer?) -> text { return match x { some(value) => "some", none => "none" } }');
  expect(optional.diagnostics).toEqual([]); expect(executeValue(optional.ir!.functions,'f',[PIPE_NONE])).toBe('none');
 });
 it('destructures record fields in a pattern arm',()=>{
  const r=compile('type User { name text } function f(u User) -> text { return match u { User { name } => name } }');
  expect(r.diagnostics).toEqual([]);
  expect(executeValue(r.ir!.functions,'f',[{name:'Ada'}])).toBe('Ada');
 });
});
