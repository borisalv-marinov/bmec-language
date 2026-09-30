import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeValue,FunctionValue,ListValue,Money,NoneValue,PIPE_NONE,RecordValue,ResultValue,VariantValue} from '../src/core/interpreter.js';

describe('authoritative exact runtime values',()=>{
  it('preserves signed int64 boundaries as bigint',()=>{
    const r=compile('function low() -> integer { return -9223372036854775808 } function high() -> integer { return 9223372036854775807 }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'low',[])).toBe(-9223372036854775808n);
    expect(executeValue(r.ir!.functions,'high',[])).toBe(9223372036854775807n);
  });
  it('preserves fixed-scale money and explicit none',()=>{
    const r=compile('function price() -> money { return 92233720368547758.07 } function missing() -> integer? { return none }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'price',[])).toEqual(new Money(9223372036854775807n));
    expect(executeValue(r.ir!.functions,'missing',[])).toBe(PIPE_NONE);
  });
  it('returns structured collection, record, result, enum, and function values',()=>{
    const r=compile('type Point { x integer } enum State { ready done } function point() -> Point { return Point { x: 1 } } function list() -> list<integer> { return [1, 2] } function result() -> result<integer,text> { return ok(1) } function state(s State) -> State { return s } function add(a integer, b integer) -> integer { return a + b } function fn() -> (integer,integer) -> integer { return add }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'point',[])).toBeInstanceOf(RecordValue);
    expect(executeValue(r.ir!.functions,'list',[])).toBeInstanceOf(ListValue);
    expect(executeValue(r.ir!.functions,'result',[])).toBeInstanceOf(ResultValue);
    expect(executeValue(r.ir!.functions,'state',[new VariantValue('State','ready')])).toBeInstanceOf(VariantValue);
    expect(executeValue(r.ir!.functions,'fn',[])).toBeInstanceOf(FunctionValue);
  });
  it('keeps execute as a lossy compatibility adapter',()=>{
    const r=compile('function value() -> integer { return 9223372036854775807 }');
    expect(executeValue(r.ir!.functions,'value',[])).toBe(9223372036854775807n);
  });
});
