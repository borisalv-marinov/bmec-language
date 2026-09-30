import {describe,it,expect} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeValue,PipeRuntimeError} from '../src/core/interpreter.js';

const run=(source:string,name='main',args:any[]=[])=>{const r=compile(source);expect(r.diagnostics).toEqual([]);return executeValue(r.ir!.functions,name,args)};
const codes=(source:string)=>compile(source).diagnostics.map(d=>d.code);

describe('PIPE executable conformance matrix',()=>{
  it('preserves signed int64 boundaries and rejects overflow',()=>{
    expect(run('function main() -> integer { return 9223372036854775807 }')).toBe(9223372036854775807n);
    expect(()=>run('function main() -> integer { return 9223372036854775807 + 1 }')).toThrowError(PipeRuntimeError);
    expect(()=>run('function main() -> integer { return -9223372036854775808 - 1 }')).toThrowError(PipeRuntimeError);
    expect(run('function main() -> integer { return 10-3-2 }')).toBe(5n);
  });

  it('checks integer arithmetic including modulo and zero failures',()=>{
    expect(run('function main() -> integer { return 10 % 3 }')).toBe(1n);
    expect(()=>run('function main() -> integer { return 10 % 0 }')).toThrowError(/Division by zero/);
  });

  it('keeps numbers finite and strictly typed',()=>{
    expect(run('function main() -> number { return -1.25 / 0.5 }')).toBe(-2.5);
    expect(codes('function main() -> number { return 1 + 1.0 }')).toContain('PIPE-TYPE-005');
    expect(codes('function f(a integer, b number) -> boolean { return a == b }')).toContain('PIPE-TYPE-011');
  });

  it('uses exact fixed-point money and rejects forbidden combinations',()=>{
    expect(run('function main() -> money { return 0.10 + 0.20 }')).toEqual({kind:'money',minor:30n});
    expect(run('function main() -> money { return 1.00 - 0.99 }')).toEqual({kind:'money',minor:1n});
    expect(run('function main() -> money { return 1.00 / 3 }')).toEqual({kind:'money',minor:33n});
    expect(codes('function main(a money, b number) -> money { return a + b }')).toContain('PIPE-TYPE-005');
  });

  it('requires boolean conditions and operators',()=>{
    expect(codes('function main() -> integer { if 1 { return 1 } else { return 0 } }')).toContain('PIPE-TYPE-003');
    expect(codes('function main() -> integer { if "yes" { return 1 } else { return 0 } }')).toContain('PIPE-TYPE-003');
    expect(run('function main() -> boolean { return not true or false }')).toBe(false);
  });

  it('proves complete return paths rather than merely finding a return',()=>{
    expect(codes('function test(x integer) -> integer { if x > 0 { return 1 } }')).toContain('PIPE-FUNC-004');
    expect(codes('function test(x integer) -> integer { if x > 0 { return 1 } else { return 0 } }')).not.toContain('PIPE-FUNC-004');
    expect(codes('function test(x integer) -> integer { if x > 0 { if x > 10 { return 2 } else { return 1 } } else { return 0 } }')).not.toContain('PIPE-FUNC-004');
  });

  it('keeps scope, call, and recursion failures structured',()=>{
    expect(codes('function f(x integer) -> integer { let x = 1 return x }')).toContain('PIPE-FUNC-005');
    expect(codes('function f(x integer) -> integer { return missing }')).toContain('PIPE-REF-004');
    const r=compile('function loop(x integer) -> integer { return loop(x) }');
    expect(()=>executeValue(r.ir!.functions,'loop',[1],{maxCallDepth:4})).toThrowError(PipeRuntimeError);
    try{executeValue(r.ir!.functions,'loop',[1],{maxCallDepth:4})}catch(e){expect((e as PipeRuntimeError).code).toBe('PIPE-RUNTIME-006')}
  });
});
