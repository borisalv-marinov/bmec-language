import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeValue} from '../src/core/interpreter.js';

describe('interpreter integer literal cache',()=>{
  it('revalidates changed IR text and preserves signed 64-bit precision and overflow',()=>{
    const result=compile('function main() -> integer { return 1 }');
    expect(result.diagnostics).toEqual([]);
    const returned=result.ir!.functions.find(fn=>fn.name==='main')!.body[0] as unknown as {value:{value:unknown}};
    expect(executeValue(result.ir!.functions,'main',[])).toBe(1n);
    returned.value.value='9223372036854775807';
    expect(executeValue(result.ir!.functions,'main',[])).toBe(9223372036854775807n);
    returned.value.value='-9223372036854775808';
    expect(executeValue(result.ir!.functions,'main',[])).toBe(-9223372036854775808n);
    returned.value.value='9223372036854775808';
    expect(()=>executeValue(result.ir!.functions,'main',[])).toThrow(expect.objectContaining({code:'PIPE-RUNTIME-004',message:'Invalid integer value'}));
  });
});
