export interface Principal {id:string;attributes:Readonly<Record<string,string|number|boolean>>}
export interface AuthorizationContext {principal?:Principal;resource?:Readonly<Record<string,unknown>>}
export type Policy=(context:AuthorizationContext)=>boolean;
export function authorize(policy:Policy,context:AuthorizationContext):void{if(typeof policy!=='function'||!policy(context))throw new Error('PIPE-AUTHZ-001: authorization policy denied the operation');}
export const allOf=(...policies:Policy[]):Policy=>context=>policies.every(policy=>policy(context));
export const anyOf=(...policies:Policy[]):Policy=>context=>policies.some(policy=>policy(context));
export const authenticated:Policy=context=>Boolean(context.principal);
export const hasAttribute=(name:string,value:string|number|boolean):Policy=>context=>context.principal?.attributes[name]===value;
export const role=(name:string):Policy=>hasAttribute('role',name);
export const owns=(resourceField:string):Policy=>context=>Boolean(context.principal&&context.resource&&context.resource[resourceField]===context.principal.id);
