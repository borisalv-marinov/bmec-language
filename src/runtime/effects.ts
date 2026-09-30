import {randomInt,randomUUID} from 'node:crypto';
import {requireCapability,type CapabilityToken} from './capabilities.js';
export function currentTime(capability:CapabilityToken):number{requireCapability(capability,'time');return Date.now()}
export function randomNumber(capability:CapabilityToken):number{requireCapability(capability,'random');return Math.random()}
export function randomInteger(capability:CapabilityToken,lower:bigint,upper:bigint):bigint{requireCapability(capability,'random');const min=Number(lower),max=Number(upper);if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||lower>=upper||max-min>Number.MAX_SAFE_INTEGER)throw new Error('PIPE-RANDOM-001: randomInteger requires safe integer bounds, a safe range width, and lower < upper');return BigInt(Math.floor(Math.random()*(max-min))+min)}
export function secureRandomInteger(capability:CapabilityToken,lower:bigint,upper:bigint):bigint{requireCapability(capability,'secureRandom');const min=Number(lower),max=Number(upper);if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||lower>=upper||max-min>2**48-1)throw new Error('PIPE-RANDOM-002: secureRandomInteger requires safe integer bounds, lower < upper, and a range below 2^48');return BigInt(randomInt(min,max))}
export function secureRandomId(capability:CapabilityToken):string{requireCapability(capability,'secureRandom');return randomUUID()}
