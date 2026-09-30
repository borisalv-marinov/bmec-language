import {describe,expect,it} from 'vitest';
import {compile,compileTests} from '../src/compiler.js';
import {executeValue,publicValue,PIPE_NONE} from '../src/core/interpreter.js';

const checked=(source:string)=>{
  const result=compile(source,'stdlib-semantics.bmec');
  expect(result.diagnostics).toEqual([]);
  return result.ir!;
};

describe('public standard-library semantic contracts',()=>{
  it('executes generic map, filter, and fold contracts',()=>{
    const ir=checked('function inc(value integer) -> integer { return value + 1 } function positive(value integer) -> boolean { return value > 0 } function mapped(values list<integer>) -> list<integer> { return map(values, inc) } function filtered(values list<integer>) -> list<integer> { return filter(values, positive) } function total(values list<integer>) -> integer { return fold(values, 0, add) } function add(acc integer, value integer) -> integer { return acc + value }');
    expect(publicValue(executeValue(ir.functions,'mapped',[[1n,2n]]))).toEqual([2,3]);
    expect(publicValue(executeValue(ir.functions,'filtered',[[-1n,2n,0n]]))).toEqual([2]);
    expect(publicValue(executeValue(ir.functions,'total',[[1n,2n,3n]]))).toBe(6);
  });

  it('passes typed list and record values between language functions',()=>{
    const ir=checked('type Attendee { name text age integer } function firstAdult(attendees list<Attendee>) -> result<Attendee,text> { for attendee in attendees { if attendee.age >= 18 { return ok(attendee) } } return err("No adult attendee found") } function empty() -> result<Attendee,text> { return firstAdult([]) } function choose() -> result<Attendee,text> { return firstAdult([Attendee { name: "Riley", age: 12 }, Attendee { name: "Jordan", age: 18 }]) }');
    expect(publicValue(executeValue(ir.functions,'empty',[]))).toEqual({state:'err',error:'No adult attendee found'});
    expect(publicValue(executeValue(ir.functions,'choose',[]))).toEqual({state:'ok',value:{name:'Jordan',age:18}});
  });

  it('runs list and record equality assertions in application tests',()=>{
    const result=compileTests('type Attendee { name text age integer } function firstAdult(attendees list<Attendee>) -> result<Attendee,text> { for attendee in attendees { if attendee.age >= 18 { return ok(attendee) } } return err("No adult attendee found") } test "empty list" { expect(firstAdult([])).toEqual(err("No adult attendee found")) } test "first adult" { expect(firstAdult([Attendee { name: "Riley", age: 12 }, Attendee { name: "Jordan", age: 18 }])).toEqual(ok(Attendee { name: "Jordan", age: 18 })) }');
    expect(result.diagnostics).toEqual([]);
    for(let index=0;index<result.tests.length;index++)executeValue(result.ir!.functions,`__pipe_test_${index+1}`,[]);
  });

  it('preserves Result and optional contracts through runtime values',()=>{
    const ir=checked('function parsed() -> result<integer,text> { return parseInteger("42") } function maybe() -> integer? { return some(42) } function present(value integer?) -> boolean { return isSome(value) }');
    expect(publicValue(executeValue(ir.functions,'parsed',[]))).toEqual({state:'ok',value:42});
    expect(publicValue(executeValue(ir.functions,'maybe',[]))).toBe(42);
    expect(publicValue(executeValue(ir.functions,'present',[PIPE_NONE]))).toBe(false);
  });

  it('checks temporal contracts with typed date values',()=>{
    const ir=checked('function dateValue() -> date { return "2025-01-02" } function rendered() -> text { return formatDate(dateValue()) } function year() -> integer { return dateYear(dateValue()) }');
    expect(publicValue(executeValue(ir.functions,'rendered',[]))).toBe('2025-01-02');
    expect(publicValue(executeValue(ir.functions,'year',[]))).toBe(2025);
  });

  it('rejects advertised contracts with incompatible argument shapes',()=>{
    expect(compile('function bad() -> result<integer,text> { return parseInteger(42) }').diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
    expect(compile('function bad(values list<integer>) -> list<integer> { return map(values, 1) }').diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-006');
    expect(compile('function bad(value integer) -> boolean { return isSome(value) }').diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
  });
});
