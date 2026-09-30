import {describe,expect,it} from 'vitest';
import {parse} from '../src/parser/parser.js';
import {compile} from '../src/compiler.js';

describe('parser comparison and generic disambiguation',()=>{
 it('parses ordinary less-than expressions',()=>{const r=compile('function before(a integer, b integer) -> boolean { return a < b }');expect(r.diagnostics).toEqual([]);});
 it('still parses generic calls with explicit type arguments',()=>{const r=compile('function identity<T>(value T) -> T { return value } function main() -> integer { return identity<integer>(1) }');expect(r.diagnostics).toEqual([]);expect(parse('function f(a integer, b integer) -> boolean { return a < b }').declarations).toHaveLength(1);});
});
