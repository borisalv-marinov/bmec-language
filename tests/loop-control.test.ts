import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeValue} from '../src/core/interpreter.js';

describe('structured loop foundations',()=>{
  it('executes while with controlled step limits',()=>{
    const r=compile('function main() -> integer { var x integer = 0 while x < 3 { x = x + 1 } return x }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'main',[])).toBe(3n);
  });
  it('executes repeat exactly its integer count',()=>{
    const r=compile('function main() -> integer { var x integer = 0 repeat 3 { x = x + 1 } return x }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'main',[])).toBe(3n);
  });
  it('supports zero and reversed ranges at runtime',()=>{
    const r=compile('function main() -> list<integer> { return range(3, 1) }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'main',[])).toEqual({kind:'list',items:[]});
  });
  it('shares mutable cells with closures',()=>{
    const r=compile('function make() -> () -> integer { var count integer = 0 return lambda() -> integer { count = count + 1 return count } } function main() -> integer { let f = make() let ignored integer = f() return f() }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'main',[])).toBe(2n);
  });
  it('rejects loop control outside loops but accepts it inside',()=>{
    expect(compile('function bad() -> integer { break return 1 }').diagnostics.map(x=>x.code)).toContain('PIPE-FUNC-011');
    const good=compile('function good() -> integer { var x integer = 0 while true { break } return x }');
    expect(good.diagnostics).toEqual([]);
    expect(executeValue(good.ir!.functions,'good',[])).toBe(0n);
  });
});
