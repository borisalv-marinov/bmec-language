import {describe,expect,it} from 'vitest';
import {compile,compileTests} from '../src/compiler.js';
import {executeValue} from '../src/core/interpreter.js';

describe('PIPE-native test declarations',()=>{it('parses tests without changing executable declarations',()=>{const result=compile('function add(a integer, b integer) -> integer { return a + b } test "addition works" { expect(add(2, 3)).toEqual(5) }');expect(result.diagnostics).toEqual([]);expect(result.ast.declarations.some(x=>x.kind==='TestDeclaration')).toBe(true);expect((result.ast.declarations.find(x=>x.kind==='TestDeclaration') as any).body[0].kind).toBe('ExpectStatement');expect(result.ir!.functions.map(x=>x.name)).toEqual(['add']);});});
it('executes PIPE tests through typed IR',()=>{const result=compileTests('function add(a integer, b integer) -> integer { return a + b } test "addition works" { expect(add(2, 3)).toEqual(5) }');expect(result.diagnostics).toEqual([]);expect(()=>executeValue(result.ir!.functions,'__pipe_test_1',[])).not.toThrow();});
