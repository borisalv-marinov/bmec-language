import {CAPABILITY_KINDS,type CapabilityKind} from '../runtime/capabilities.js';
import {typeRefFromUnknown,type TypeRef} from '../types/type-ref.js';

export type HttpMethod='GET'|'POST'|'PUT'|'PATCH'|'DELETE';
export interface HttpField {name:string;type:TypeRef;required?:boolean}
export interface HttpRoute {id:string;method:HttpMethod;path:string;pathParams:HttpField[];query:HttpField[];headers:HttpField[];requestBody?:TypeRef;responseBody?:TypeRef;status:number;errorStatuses?:number[];handlerId:string;capabilities?:CapabilityKind[];policyId?:string;principalParam?:string}
export interface HttpProgram {routes:HttpRoute[]}

const jsonEqual=(a:unknown,b:unknown):boolean=>JSON.stringify(a??null)===JSON.stringify(b??null);
const sameRequestContract=(a:HttpRoute,b:HttpRoute):boolean=>jsonEqual(a.pathParams,b.pathParams)&&jsonEqual(a.query,b.query)&&jsonEqual(a.headers,b.headers)&&jsonEqual(a.requestBody,b.requestBody)&&jsonEqual(a.responseBody,b.responseBody)&&jsonEqual(a.capabilities??[],b.capabilities??[])&&a.status===b.status&&jsonEqual(a.errorStatuses??[],b.errorStatuses??[])&&jsonEqual(a.principalParam,b.principalParam);

/** Validate typed routes. Exact method/path alternatives are safe only when
 * every alternative is protected by a distinct policy and exposes the same
 * request/response contract. */
export function validateHttp(program:HttpProgram):string[]{
 const errors:string[]=[],ids=new Set<string>(),paths=new Map<string,HttpRoute[]>(),caps=new Set<CapabilityKind>(CAPABILITY_KINDS),methods=new Set<HttpMethod>(['GET','POST','PUT','PATCH','DELETE']);
 for(const route of program.routes){
  if(!route||typeof route!=='object'||typeof route.id!=='string'||ids.has(route.id))errors.push(`Invalid or duplicate HTTP route id "${String(route?.id)}"`);else ids.add(route.id);
  const path=typeof route?.path==='string'?route.path:'',key=`${String(route?.method)} ${path}`,group=paths.get(key)??[];group.push(route);paths.set(key,group);
  const errorStatuses=Array.isArray(route?.errorStatuses)?route.errorStatuses:[];
  if(!methods.has(route?.method)||!route.handlerId||typeof route.handlerId!=='string'||route.status<100||route.status>599||errorStatuses.some(status=>!Number.isInteger(status)||status<400||status>599)||new Set(errorStatuses).size!==errorStatuses.length||errorStatuses.includes(route.status)||!path.startsWith('/'))errors.push(`Invalid HTTP route contract "${String(route?.id)}"`);
  const placeholders=[...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(x=>x[1]!);
  const parameterNames=(kind:'pathParams'|'query'|'headers')=>{const fields=Array.isArray(route?.[kind])?route[kind]:[],names=new Set<string>();for(const field of fields){if(!field||typeof field.name!=='string'||names.has(field.name))errors.push(`Duplicate or invalid HTTP ${kind} field "${String(field?.name)}"`);else names.add(field.name);if(!field||!typeRefFromUnknown(field.type))errors.push(`Invalid HTTP ${kind} TypeRef "${String(field?.name)}"`);}return [...names]};
  const pathNames=parameterNames('pathParams');if(placeholders.length!==pathNames.length||placeholders.some((name,i)=>name!==pathNames[i]))errors.push(`HTTP route path parameters do not match route "${String(route?.id)}"`);parameterNames('query');parameterNames('headers');
  if(route?.principalParam!==undefined&&(!route.principalParam||typeof route.principalParam!=='string'||!route.policyId||route.principalParam==='body'||[...(Array.isArray(route.pathParams)?route.pathParams:[]),...(Array.isArray(route.query)?route.query:[]),...(Array.isArray(route.headers)?route.headers:[])].some(field=>field?.name===route.principalParam)))errors.push('HTTP principal parameter requires an authorized route and cannot overlap request inputs');
  if(route?.requestBody!==undefined&&!typeRefFromUnknown(route.requestBody))errors.push(`Invalid HTTP request body TypeRef "${String(route?.id)}"`);if(route?.responseBody!==undefined&&!typeRefFromUnknown(route.responseBody))errors.push(`Invalid HTTP response body TypeRef "${String(route?.id)}"`);for(const capability of Array.isArray(route?.capabilities)?route.capabilities:[])if(!caps.has(capability))errors.push(`Unknown route capability "${String(capability)}"`);
 }
 for(const [key,routes] of paths){if(routes.length<2)continue;const policies=routes.map(route=>route.policyId);if(policies.some(policy=>typeof policy!=='string'||!policy.startsWith('role:')))errors.push(`HTTP route alternatives for "${key}" require role policies`);if(new Set(policies).size!==policies.length)errors.push(`HTTP route alternatives for "${key}" require distinct authorization policies`);if(routes.some(route=>!sameRequestContract(routes[0]!,route)))errors.push(`HTTP route alternatives for "${key}" must have the same request and response contract`);}
 return errors;
}
