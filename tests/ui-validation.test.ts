import {describe,expect,it} from 'vitest';
import {primitive,optionalType} from '../src/types/type-ref.js';
import {validateInput} from '../src/ui/validation.js';
describe('typed UI input validation',()=>{it('validates exact primitive inputs',()=>{expect(validateInput('12',primitive('integer'))).toBeUndefined();expect(validateInput('1.234',primitive('money'))).toBe('expected exact money');expect(validateInput('x',primitive('boolean'))).toBe('expected boolean')});it('allows absent optionals',()=>expect(validateInput('',optionalType(primitive('text')))).toBeUndefined());});
