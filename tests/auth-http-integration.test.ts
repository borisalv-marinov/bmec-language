import {afterEach,describe,expect,it} from 'vitest';
import {startNodeHttp,type NodeHttpHandle} from '../src/http/node-adapter.js';
import {registerAuthHandlers} from '../src/http/auth-handlers.js';
import {AuthService} from '../src/runtime/auth.js';
import {authenticatedSession,principalPolicy,rolePolicy} from '../src/http/auth-policy.js';

const handles:NodeHttpHandle[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close()});

describe('real HTTP authentication lifecycle',()=>{
 it('registers, logs in, authorizes, and logs out through TCP',async()=>{
  const auth=new AuthService();
  const program={routes:[
   {id:'register',method:'POST' as const,path:'/auth/register',pathParams:[],query:[],headers:[],status:201,errorStatuses:[400,409],handlerId:'register'},
   {id:'login',method:'POST' as const,path:'/auth/login',pathParams:[],query:[],headers:[],status:200,errorStatuses:[400,401],handlerId:'login'},
   {id:'logout',method:'POST' as const,path:'/auth/logout',pathParams:[],query:[],headers:[],status:204,errorStatuses:[401],handlerId:'logout'},
   {id:'private',method:'GET' as const,path:'/private',pathParams:[],query:[],headers:[],status:200,handlerId:'private',policyId:'authenticated'},
  ]};
  const handle=await startNodeHttp(program,router=>{registerAuthHandlers(router,auth,{register:'register',login:'login',logout:'logout'});router.registerPolicy('authenticated',authenticatedSession(auth.sessions));router.register('private',()=>({status:200,headers:{},body:{ok:true}}))});handles.push(handle);
  const headers={'content-type':'application/json'};
  expect((await fetch(`${handle.url}/private`)).status).toBe(403);
  expect((await fetch(`${handle.url}/auth/register`,{method:'POST',headers,body:JSON.stringify({id:'ada',password:'correct horse'})})).status).toBe(201);
  expect((await fetch(`${handle.url}/auth/login`,{method:'POST',headers,body:JSON.stringify({id:'ada',password:'wrong horse'})})).status).toBe(401);
  expect((await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{...headers,origin:'https://untrusted.example'},body:JSON.stringify({id:'ada',password:'correct horse'})})).status).toBe(403);
  const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{...headers,origin:handle.url},body:JSON.stringify({id:'ada',password:'correct horse'})});expect(login.status).toBe(200);const setCookie=login.headers.get('set-cookie')!;expect(setCookie).toContain('HttpOnly');expect(setCookie).toContain('Secure');expect(setCookie).toContain('SameSite=Lax');expect(setCookie).toContain('Max-Age=86400');expect(login.headers.get('cache-control')).toBe('no-store');expect(login.headers.get('access-control-allow-origin')).toBeNull();const cookie=/^([^;]+)/.exec(setCookie)![1]!;
  expect((await fetch(`${handle.url}/private`,{headers:{cookie}})).status).toBe(200);
  const logout=await fetch(`${handle.url}/auth/logout`,{method:'POST',headers:{cookie}});expect(logout.status).toBe(204);expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');expect(logout.headers.get('set-cookie')).toContain('Secure');expect(logout.headers.get('set-cookie')).toContain('SameSite=Lax');expect(logout.headers.get('cache-control')).toBe('no-store');expect((await fetch(`${handle.url}/private`,{headers:{cookie}})).status).toBe(403);
  expect((await fetch(`${handle.url}/auth/register`,{method:'POST',headers,body:JSON.stringify({id:'ada',password:'another pass'})})).status).toBe(409);
 });
 it('allows explicitly configured canonical origins for a separate browser host',async()=>{
  const program={routes:[{id:'read',method:'GET' as const,path:'/read',pathParams:[],query:[],headers:[],status:200,handlerId:'read'},{id:'write',method:'POST' as const,path:'/write',pathParams:[],query:[],headers:[],status:200,handlerId:'write'}]};
  const handle=await startNodeHttp(program,router=>router.register('read',()=>({status:200,headers:{},body:{ok:true}})).register('write',()=>({status:200,headers:{},body:{ok:true}})),{allowedOrigins:['https://dashboard.example']});handles.push(handle);
  expect((await fetch(`${handle.url}/write`,{method:'POST',headers:{origin:'https://dashboard.example'}})).status).toBe(200);
  expect((await fetch(`${handle.url}/write`,{method:'POST',headers:{origin:'https://other.example'}})).status).toBe(403);
  expect((await fetch(`${handle.url}/write`,{method:'POST',headers:{origin:'null'}})).status).toBe(403);
  expect((await fetch(`${handle.url}/read`,{headers:{origin:'https://other.example'}})).status).toBe(200);
  await expect(startNodeHttp(program,undefined,{allowedOrigins:['https://dashboard.example/path']})).rejects.toThrow('PIPE-NET-005');
 });
 it('does not expose credential material on invalid requests',async()=>{
  const auth=new AuthService();const program={routes:[{id:'register',method:'POST' as const,path:'/register',pathParams:[],query:[],headers:[],status:201,errorStatuses:[400],handlerId:'register'}]};const handle=await startNodeHttp(program,router=>registerAuthHandlers(router,auth,{register:'register',login:'unused',logout:'unused'}));handles.push(handle);
  const response=await fetch(`${handle.url}/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'ada',password:'short'})});const text=await response.text();expect(response.status).toBe(400);expect(text).not.toContain('short');expect(text).not.toContain('scrypt');
 });
 it('enforces resource policy from server-owned attributes, not request claims',async()=>{
  const auth=new AuthService();await auth.register('member','member pass',{admin:false});await auth.register('admin','admin pass',{admin:true});
  const program={routes:[{id:'admin',method:'GET' as const,path:'/admin',pathParams:[],query:[],headers:[],status:200,errorStatuses:[403],handlerId:'admin',policyId:'admin-only'}]};
  const handle=await startNodeHttp(program,router=>{router.registerPolicy('admin-only',principalPolicy(auth,principal=>principal.attributes.admin===true));router.register('admin',()=>({status:200,headers:{},body:{admin:true}}))});handles.push(handle);
  expect((await fetch(`${handle.url}/admin?admin=true`)).status).toBe(403);
  // The policy is exercised through direct server-side session state; no
  // request field can grant access when the principal is not admin.
  const member=await auth.login('member','member pass');const admin=await auth.login('admin','admin pass');
  expect((await fetch(`${handle.url}/admin?role=admin`,{headers:{authorization:`Bearer ${member!.id}`}})).status).toBe(403);
  expect((await fetch(`${handle.url}/admin`,{headers:{authorization:`Bearer ${admin!.id}`}})).status).toBe(200);
 });
 it('provides a server-owned role policy factory',async()=>{
  const auth=new AuthService();await auth.register('member','member pass',{role:'member'});await auth.register('manager','manager pass',{role:'manager'});
  const program={routes:[{id:'manager',method:'GET' as const,path:'/manager',pathParams:[],query:[],headers:[],status:200,errorStatuses:[403],handlerId:'manager',policyId:'manager-only'}]};
  const handle=await startNodeHttp(program,router=>{router.registerPolicy('manager-only',rolePolicy(auth,'manager'));router.register('manager',()=>({status:200,headers:{},body:{manager:true}}))});handles.push(handle);
  const member=await auth.login('member','member pass');const manager=await auth.login('manager','manager pass');
  expect((await fetch(`${handle.url}/manager?role=manager`,{headers:{authorization:`Bearer ${member!.id}`}})).status).toBe(403);
  expect((await fetch(`${handle.url}/manager`,{headers:{authorization:`Bearer ${manager!.id}`}})).status).toBe(200);
 });
});
