import {describe,expect,it} from 'vitest';
import {issueCapability} from '../src/runtime/capabilities.js';
import {currentTime,randomNumber} from '../src/runtime/effects.js';
describe('capability-gated effects',()=>it('only executes time and random with matching capabilities',()=>{expect(currentTime(issueCapability('time'))).toBeGreaterThan(0);expect(randomNumber(issueCapability('random'))).toBeGreaterThanOrEqual(0);expect(()=>currentTime(issueCapability('random'))).toThrow('PIPE-EFFECT-002')}));
