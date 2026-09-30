import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeValue,ResultValue} from '../src/core/interpreter.js';

describe('postfix Result propagation',()=>{
 it('unwraps ok and returns err early',()=>{
  const r=compile('function parse(value text) -> result<integer,text> { if value == "ok" { return ok(7) } else { return err("bad") } } function use(value text) -> result<integer,text> { let n = parse(value)? return ok(n + 1) }');
  expect(r.diagnostics).toEqual([]);
  expect(executeValue(r.ir!.functions,'use',['ok'])).toEqual(new ResultValue('ok',8n));
  expect(executeValue(r.ir!.functions,'use',['no'])).toEqual(new ResultValue('err','bad'));
 });
 it('rejects propagation outside a compatible Result return',()=>{
  const r=compile('function parse() -> result<integer,text> { return ok(1) } function bad() -> integer { return parse()? }');
  expect(r.diagnostics.map(x=>x.code)).toContain('PIPE-RESULT-007');
 });
});
