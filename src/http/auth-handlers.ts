import type {HttpHandler,HttpResponse,HttpRouter} from './runtime.js';
import {AuthService} from '../runtime/auth.js';
import {expiredSessionCookie,resolveSessionFromRequest,sessionCookie} from '../runtime/auth-http.js';
import type {RateLimitStore} from './rate-limit.js';
import {opaqueRateLimitKey} from './rate-limit.js';

export interface AuthRouteIds {register:string;login:string;logout:string}
const json=(value:unknown):Record<string,unknown>|undefined=>{
  if(value&&typeof value==='object')return value as Record<string,unknown>;
  if(typeof value!=='string')return undefined;
  try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:undefined}catch{return undefined}
};
const invalid=(message='Invalid authentication request'):HttpResponse=>({status:400,headers:{},body:{error:'invalid_auth_request',message}});

/** Host HTTP handlers for the server-owned authentication lifecycle. The
 * router remains authoritative for route matching and policies; this adapter
 * only translates JSON bytes into AuthService calls. */
export function registerAuthHandlers(router:HttpRouter,auth:AuthService,ids:AuthRouteIds,secureCookie=true,rateLimitStore?:RateLimitStore):void{
  const rateLimited=async(request:Parameters<HttpHandler>[0],scope:string,limit:number,windowMs:number):Promise<HttpResponse|undefined>=>{if(!rateLimitStore)return undefined;const key=opaqueRateLimitKey(`${scope}:${request.remoteAddress??'unknown'}`);const result=await rateLimitStore.consume(key,limit,windowMs);return result.allowed?undefined:{status:429,headers:{'retry-after':String(result.retryAfterSeconds),'cache-control':'no-store'},body:{error:'rate_limited'}}};
  const register:HttpHandler=async (request):Promise<HttpResponse>=>{
    const limited=await rateLimited(request,'auth-register-ip',5,3600000);if(limited)return limited;
    const input=json(request.body);if(typeof input?.id!=='string'||typeof input.password!=='string')return {...invalid(),headers:{'cache-control':'no-store'}};
    try{const user=await auth.register(input.id,input.password);return {status:201,headers:{'cache-control':'no-store'},body:{id:user.id}}}
    catch(error){const message=error instanceof Error?error.message:'';if(message.startsWith('PIPE-AUTH-005'))return {status:409,headers:{'cache-control':'no-store'},body:{error:'user_exists'}};if(message.startsWith('PIPE-AUTH-001')||message.startsWith('PIPE-AUTH-006'))return {...invalid(),headers:{'cache-control':'no-store'}};return {status:500,headers:{'cache-control':'no-store'},body:{error:'internal_error'}}}
  };
  const login:HttpHandler=async (request):Promise<HttpResponse>=>{
    const input=json(request.body);if(typeof input?.id!=='string'||typeof input.password!=='string')return {...invalid(),headers:{'cache-control':'no-store'}};
    const byAddress=await rateLimited(request,'auth-login-ip',10,900000);if(byAddress)return byAddress;
    const byAccount=rateLimitStore?await rateLimitStore.consume(opaqueRateLimitKey(`auth-login-account:${input.id.trim().toLocaleLowerCase('en-US')}`),10,900000):undefined;
    if(byAccount&&!byAccount.allowed)return {status:429,headers:{'retry-after':String(byAccount.retryAfterSeconds),'cache-control':'no-store'},body:{error:'rate_limited'}};
    const previous=await resolveSessionFromRequest(request,auth.sessions);
    const session=await auth.login(input.id,input.password,Date.now(),previous?.id);if(!session)return {status:401,headers:{'cache-control':'no-store'},body:{error:'invalid_credentials'}};
    return {status:200,headers:{'set-cookie':sessionCookie(session,secureCookie),'cache-control':'no-store'},body:{id:session.userId}};
  };
  const logout:HttpHandler=async (request):Promise<HttpResponse>=>{const session=await resolveSessionFromRequest(request,auth.sessions);if(!session)return {status:401,headers:{'cache-control':'no-store'},body:{error:'unauthenticated'}};await auth.logout(session.id);return {status:204,headers:{'set-cookie':expiredSessionCookie(secureCookie),'cache-control':'no-store'}}};
  router.register(ids.register,register).register(ids.login,login).register(ids.logout,logout);
}
