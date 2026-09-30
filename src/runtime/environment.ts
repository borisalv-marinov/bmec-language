import {requireCapability,type CapabilityToken,SecretValue} from './capabilities.js';
import {DateValue,DateTimeValue,IdValue} from '../core/interpreter.js';

export type EnvironmentParser<T>=(raw:string)=>T;
export class PipeEnvironment {
 constructor(private readonly capability:CapabilityToken,private readonly values:Readonly<Record<string,string|undefined>>=process.env){requireCapability(capability,'environment');}
 get<T>(name:string,parser:EnvironmentParser<T>):T|undefined{requireCapability(this.capability,'environment');const raw=this.values[name];if(raw===undefined)return undefined;try{return parser(raw)}catch{throw new Error(`PIPE-ENV-001: invalid environment value "${name}"`)}}
 secret(name:string):SecretValue<string>|undefined{const value=this.get(name,x=>x);return value===undefined?undefined:new SecretValue(value)}
}
export const textEnvironment:EnvironmentParser<string>=raw=>raw;
export const integerEnvironment:EnvironmentParser<bigint>=raw=>{if(!/^-?(0|[1-9]\d*)$/.test(raw))throw new Error('invalid integer');return BigInt(raw)};
export const booleanEnvironment:EnvironmentParser<boolean>=raw=>{if(raw==='true')return true;if(raw==='false')return false;throw new Error('invalid boolean')};
const validDate=(raw:string)=>{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);if(!match)return false;const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));return date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()===Number(match[2])-1&&date.getUTCDate()===Number(match[3])};
export const dateEnvironment:EnvironmentParser<DateValue>=raw=>{if(!validDate(raw))throw new Error('invalid date');return new DateValue(raw)};
export const datetimeEnvironment:EnvironmentParser<DateTimeValue>=raw=>{const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(raw);if(!match||!validDate(match[1])||Number(match[2])>23||Number(match[3])>59||Number(match[4])>59)throw new Error('invalid datetime');return new DateTimeValue(raw)};
export const idEnvironment:EnvironmentParser<IdValue>=raw=>{if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(raw))throw new Error('invalid id');return new IdValue(raw)};
