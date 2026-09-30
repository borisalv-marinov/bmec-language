import {describe,expect,it} from 'vitest';
import {issueCapability} from '../src/runtime/capabilities.js';
import {PipeEnvironment,booleanEnvironment,dateEnvironment,datetimeEnvironment,idEnvironment,integerEnvironment} from '../src/runtime/environment.js';
import {DateValue,DateTimeValue,IdValue} from '../src/core/interpreter.js';

describe('typed environment capability',()=>{
 it('requires capability and parses explicit types',()=>{const env=new PipeEnvironment(issueCapability('environment'),{PORT:'3000',TOKEN:'secret',ENABLED:'true',DATE:'2026-01-02',STAMP:'2026-01-02T00:00:00Z',ID:'a'});expect(env.get('PORT',integerEnvironment)).toBe(3000n);expect(env.get('ENABLED',booleanEnvironment)).toBe(true);expect(env.get('DATE',dateEnvironment)).toEqual(new DateValue('2026-01-02'));expect(env.get('STAMP',datetimeEnvironment)).toEqual(new DateTimeValue('2026-01-02T00:00:00Z'));expect(env.get('ID',idEnvironment)).toEqual(new IdValue('a'));expect(String(env.secret('TOKEN'))).toBe('[REDACTED]');});
 it('rejects invalid typed values',()=>{const env=new PipeEnvironment(issueCapability('environment'),{PORT:'x',DATE:'2025-02-29',STAMP:'2026-01-01T24:00:00Z'});expect(()=>env.get('PORT',integerEnvironment)).toThrow('PIPE-ENV-001');expect(()=>env.get('DATE',dateEnvironment)).toThrow('PIPE-ENV-001');expect(()=>env.get('STAMP',datetimeEnvironment)).toThrow('PIPE-ENV-001');});
 it('rejects wrong capability at construction',()=>expect(()=>new PipeEnvironment(issueCapability('time'),{})).toThrow('PIPE-EFFECT-002'));
});
