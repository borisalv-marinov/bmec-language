import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {execute} from '../src/core/interpreter.js';

describe('deprecated execute compatibility adapter',()=>{
  it('documents lossy scalar conversion',()=>{
    const integer=compile('function main() -> integer { return 9223372036854775807 }');
    const money=compile('function main() -> money { return 1.23 }');
    const none=compile('function main() -> integer? { return none }');
    expect(execute(integer.ir!.functions,'main',[])).toBe(Number(9223372036854775807n));
    expect(execute(money.ir!.functions,'main',[])).toBe(1.23);
    expect(execute(none.ir!.functions,'main',[])).toBeUndefined();
  });
  it('documents convenience conversion for compound and function values',()=>{
    const list=compile('function main() -> list<integer> { return [1, 2] }');
    const result=compile('function main() -> result<integer,text> { return ok(1) }');
    const fn=compile('function main() -> (integer) -> integer { return lambda(x integer) -> integer { return x } }');
    expect(execute(list.ir!.functions,'main',[])).toEqual([1,2]);
    expect(execute(result.ir!.functions,'main',[])).toEqual({state:'ok',value:1});
    expect(execute(fn.ir!.functions,'main',[])).toEqual({kind:'function',name:'<lambda>'});
  });
});
