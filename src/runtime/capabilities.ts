export type CapabilityKind='http'|'database'|'environment'|'time'|'random'|'secureRandom'|'filesystem'|'email';
export const CAPABILITY_KINDS:readonly CapabilityKind[]=['http','database','environment','time','random','secureRandom','filesystem','email'];
const seal=Symbol('pipe-capability'),authority=Symbol('pipe-capability-authority');
export class CapabilityToken {readonly [seal]=true;readonly [authority]=true;private constructor(public readonly kind:CapabilityKind){}static issue(kind:CapabilityKind):CapabilityToken{return new CapabilityToken(kind)}toJSON():never{throw new Error('PIPE-EFFECT-001: capabilities cannot be serialized')}toString():string{throw new Error('PIPE-EFFECT-001: capabilities cannot be displayed')}}
export function issueCapability(kind:CapabilityKind):CapabilityToken{return CapabilityToken.issue(kind);}
export function requireCapability(value:unknown,kind:CapabilityKind):CapabilityToken{if(!(value instanceof CapabilityToken)||value.kind!==kind||value[authority]!==true)throw new Error(`PIPE-EFFECT-002: ${kind} capability required`);return value;}
/** Opaque secret value: usable by explicitly typed consumers, never printable or JSON serializable. */
export class SecretValue<T=unknown>{readonly kind='secret';constructor(private readonly value:T){}reveal(token:CapabilityToken):T{requireCapability(token,'environment');return this.value}toString():string{return '[REDACTED]'}toJSON():never{throw new Error('PIPE-SECRET-001: secret values cannot be serialized')}}
export const secret=<T>(value:T):SecretValue<T>=>new SecretValue(value);
