import type {HttpMethod,HttpProgram,HttpRoute} from './ir.js';
import type {CapabilityKind} from '../runtime/capabilities.js';
import {decodeJsonAs,encodeJson,matchesJsonType} from '../runtime/json.js';
import type {JsonRecordSchemas} from '../runtime/json.js';
import type {TypeRef} from '../types/type-ref.js';
import type {MultipartForm} from './multipart.js';
import type {Principal} from '../runtime/authorization.js';

export interface HttpRequest {method:HttpMethod|string;url:string;headers?:Record<string,string|undefined>;body?:unknown;multipart?:MultipartForm;remoteAddress?:string}
export interface HttpResponse {status:number;headers:Record<string,string>;body?:unknown;errorKind?:'application'|'adapter'}
export interface HttpContext {readonly principal?:Principal}
export type HttpHandler=(request:HttpRequest,params:Record<string,string>,context:HttpContext)=>HttpResponse|Promise<HttpResponse>;
export type HttpMiddleware=(request:HttpRequest,next:()=>Promise<HttpResponse>)=>HttpResponse|Promise<HttpResponse>;
export type HttpPolicy=(request:HttpRequest,params:Record<string,string>,context:HttpContext)=>boolean|Promise<boolean>;

function matchPath(pattern:string,path:string):Record<string,string>|null {
 const a=pattern.replace(/^\/+|\/+$/g,'').split('/').filter(Boolean),b=path.replace(/^\/+|\/+$/g,'').split('/').filter(Boolean);
 if(a.length!==b.length)return null;const params:Record<string,string>={};
 for(let i=0;i<a.length;i++){const p=a[i],v=b[i];if(p.startsWith(':'))params[p.slice(1)]=decodeURIComponent(v);else if(p!==v)return null;}
 return params;
}
function validParam(value:string,type:TypeRef):boolean{if(type.kind==='optional')return validParam(value,type.inner);if(type.kind!=='primitive')return true;switch(type.name){case'integer':return /^-?(0|[1-9]\d*)$/.test(value);case'number':return Number.isFinite(Number(value));case'boolean':return value==='true'||value==='false';case'date':return /^\d{4}-\d{2}-\d{2}$/.test(value);case'datetime':return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value);case'id':return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);default:return true}}

export class HttpRouter {
 private readonly handlers=new Map<string,HttpHandler>();
 private readonly middleware:HttpMiddleware[]=[];
 private readonly policies=new Map<string,HttpPolicy>();
 private principalResolver?: (request:HttpRequest)=>Promise<Principal|undefined>;
 constructor(private readonly program:HttpProgram,private readonly suppliedCapabilities:ReadonlySet<CapabilityKind>=new Set(),private readonly jsonRecordSchemas:JsonRecordSchemas={}){
  const errors=(program.routes??[]).filter(r=>!r.id||!r.handlerId||!r.path||!r.method);
  if(errors.length)throw new Error('Invalid HTTP program');
 }
 register(handlerId:string,handler:HttpHandler):this {this.handlers.set(handlerId,handler);return this;}
 use(middleware:HttpMiddleware):this {this.middleware.push(middleware);return this;}
 registerPolicy(policyId:string,policy:HttpPolicy):this {this.policies.set(policyId,policy);return this;}
 setPrincipalResolver(resolver:(request:HttpRequest)=>Promise<Principal|undefined>):this {this.principalResolver=resolver;return this;}
 async dispatch(request:HttpRequest):Promise<HttpResponse>{
  const url=new URL(request.url,'http://pipe.local'), method=request.method.toUpperCase() as HttpMethod;
  const matchedRoutes=this.program.routes.filter(r=>r.method===method&&matchPath(r.path,url.pathname)!==null);let route=matchedRoutes[0];
  if(!route){const allowed=this.program.routes.some(r=>matchPath(r.path,url.pathname)!==null);return {status:allowed?405:404,headers:{'content-type':'application/json'},body:{error:allowed?'method_not_allowed':'not_found'}};}
  let handler=this.handlers.get(route.handlerId);if(!handler)throw new Error(`Missing HTTP handler "${route.handlerId}"`);
  const params=matchPath(route.path,url.pathname)!;
  const context:HttpContext={...(this.principalResolver?{principal:await this.principalResolver(request)}:{})};
  if(route.policyId){const policy=this.policies.get(route.policyId);if(!policy)throw new Error(`Missing HTTP policy "${route.policyId}"`);if(!await policy(request,params,context)){let selected:{route:HttpRoute;handler:HttpHandler}|undefined;for(const candidate of matchedRoutes.slice(1)){if(!candidate.policyId)continue;const alternatePolicy=this.policies.get(candidate.policyId);if(!alternatePolicy)throw new Error(`Missing HTTP policy "${candidate.policyId}"`);if(await alternatePolicy(request,params,context)){const alternateHandler=this.handlers.get(candidate.handlerId);if(!alternateHandler)throw new Error(`Missing HTTP handler "${candidate.handlerId}"`);selected={route:candidate,handler:alternateHandler};break;}}if(!selected)return {status:403,headers:{'content-type':'application/json'},body:{error:'forbidden',policy:route.policyId}};route=selected.route;handler=selected.handler;}}
  for(const capability of route.capabilities??[])if(!this.suppliedCapabilities.has(capability))return {status:500,headers:{'content-type':'application/json'},body:{error:'missing_capability',capability}};
  for(const field of route.pathParams){if(params[field.name]===undefined){if(field.required)return {status:400,headers:{'content-type':'application/json'},body:{error:'missing_path_param',field:field.name}};}else if(!validParam(params[field.name],field.type))return {status:400,headers:{'content-type':'application/json'},body:{error:'invalid_path_param',field:field.name}};}
  for(const field of route.query){const value=url.searchParams.get(field.name);if(value===null){if(field.required)return {status:400,headers:{'content-type':'application/json'},body:{error:'missing_query_param',field:field.name}};}else if(!validParam(value,field.type))return {status:400,headers:{'content-type':'application/json'},body:{error:'invalid_query_param',field:field.name}};else params[field.name]=value;}
  const requestHeaders=request.headers??{};for(const field of route.headers){const key=Object.keys(requestHeaders).find(x=>x.toLowerCase()===field.name.toLowerCase());const value=key?requestHeaders[key]:undefined;if(value===undefined){if(field.required)return {status:400,headers:{'content-type':'application/json'},body:{error:'missing_header',field:field.name}};}else if(!validParam(value,field.type))return {status:400,headers:{'content-type':'application/json'},body:{error:'invalid_header',field:field.name}};else {params[`header:${field.name}`]=value;params[field.name]=value;}}
  if(route.requestBody!==undefined&&request.body===undefined&&route.requestBody.kind!=='optional')return {status:400,headers:{'content-type':'application/json'},body:{error:'missing_body'}};
  let resolvedRequest=request;if(route.requestBody!==undefined&&typeof request.body==='string'){const contentType=Object.entries(request.headers??{}).find(([key])=>key.toLowerCase()==='content-type')?.[1];if(contentType&&contentType.split(';',1)[0].trim().toLowerCase()!=='application/json')return {status:415,headers:{'content-type':'application/json'},body:{error:'unsupported_media_type'}};try{resolvedRequest={...request,body:decodeJsonAs(request.body,route.requestBody,this.jsonRecordSchemas)}}catch(error){return {status:400,headers:{'content-type':'application/json'},body:{error:'invalid_body'}};}}
  const invoke=async(index:number):Promise<HttpResponse>=>{if(index<this.middleware.length)return this.middleware[index](resolvedRequest,()=>invoke(index+1));return handler(resolvedRequest,params,context)};
  try {const response=await invoke(0);if(response.status!==route.status&&!route.errorStatuses?.includes(response.status))return {status:500,headers:{'content-type':'application/json'},body:{error:'contract_status_mismatch',expected:route.status,received:response.status},errorKind:'application'};if(route.responseBody!==undefined&&response.body===undefined)return {status:500,headers:{'content-type':'application/json'},body:{error:'missing_response_body'},errorKind:'application'};if(route.responseBody!==undefined&&response.body&&typeof response.body==='object'&&'kind' in response.body&&typeof (response.body as {kind?:unknown}).kind==='string'){if(!matchesJsonType(response.body as any,route.responseBody))return {status:500,headers:{'content-type':'application/json'},body:{error:'invalid_response_body'},errorKind:'application'};return {...response,headers:{...response.headers},body:JSON.parse(encodeJson(response.body as any))};}return {...response,headers:{...response.headers}};} catch(error){const message=error instanceof Error?error.message:'';const code=error&&typeof error==='object'&&'code' in error?String((error as {code?:unknown}).code):'';if(message.startsWith('PIPE-MULTIPART-'))return {status:400,headers:{'content-type':'application/json'},body:{error:'invalid_multipart',code:message.split(':',1)[0]},errorKind:'application'};if(message.startsWith('PIPE-DB-002:'))return {status:400,headers:{'content-type':'application/json'},body:{error:'invalid_database_value',code:'PIPE-DB-002'},errorKind:'application'};if(code==='PIPE-NET-008'||message.startsWith('PIPE-NET-008:'))return {status:405,headers:{'content-type':'application/json'},body:{error:'safe_method_effect_forbidden'},errorKind:'application'};return {status:500,headers:{'content-type':'application/json'},body:{error:'internal_error'},errorKind:'application'};}
 }
}
