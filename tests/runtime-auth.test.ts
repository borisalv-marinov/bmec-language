import {describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compile} from '../src/compiler.js';
import {startRuntime} from '../src/runtime/server.js';
import type {AuthUser,UserStore} from '../src/runtime/auth.js';

class DurableUserStore implements UserStore {
  private readonly users=new Map<string,AuthUser>();
  async get(id:string):Promise<AuthUser|undefined>{return this.users.get(id)}
  async put(user:AuthUser):Promise<void>{if(this.users.has(user.id))throw new Error('PIPE-AUTH-005: user already exists');this.users.set(user.id,user)}
}

const source=`app AuthApp
model Customer { name text required email text required }
async function listCustomers(db capability<database>) -> task<list<Customer>> { return wait for get customers from Customer using db }
serve GET / customers requiring role admin and database with listCustomers`;

describe('distributed runtime authentication configuration',()=>{
  it('applies a validated host-selected HTTP request rate limit',async()=>{
    const result=compile(source,'auth-rate-limit.bmec');expect(result.diagnostics).toEqual([]);const root=mkdtempSync(join(tmpdir(),'bmec-auth-rate-limit-'));
    const handle=await startRuntime(result.ir!,join(root,'generated'),join(root,'data','app.db'),0,{authUsers:[{id:'admin',password:'admin-pass-123',role:'admin'}],requestRateLimit:{limit:1,windowMs:60000}});
    try{
      expect((await fetch(`${handle.url}/customers`)).status).toBe(403);
      const limited=await fetch(`${handle.url}/customers`);expect(limited.status).toBe(429);const retryAfter=Number(limited.headers.get('retry-after'));expect(retryAfter).toBeGreaterThan(0);expect(retryAfter).toBeLessThanOrEqual(60);expect(await limited.json()).toEqual({error:'rate_limited'});
    }finally{await handle.close()}
  });
  it('seeds local users and enforces role policies around typed routes',async()=>{
    const result=compile(source,'auth-run.bmec');expect(result.diagnostics).toEqual([]);const root=mkdtempSync(join(tmpdir(),'bmec-auth-run-'));
    const handle=await startRuntime(result.ir!,join(root,'generated'),join(root,'data','app.db'),0,{authUsers:[{id:'admin',password:'admin-pass-123',role:'admin'},{id:'worker',password:'worker-pass-123',role:'worker'}]});
    try{
      expect((await fetch(`${handle.url}/customers`)).status).toBe(403);
      const login=async(id:string,password:string)=>{const response=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,password})});expect(response.status).toBe(200);return response.headers.get('set-cookie')!.split(';')[0]!};
      const admin=await login('admin','admin-pass-123');expect((await fetch(`${handle.url}/customers`,{headers:{cookie:admin}})).status).toBe(200);
      const worker=await login('worker','worker-pass-123');expect((await fetch(`${handle.url}/customers`,{headers:{cookie:worker}})).status).toBe(403);
      const logout=await fetch(`${handle.url}/auth/logout`,{method:'POST',headers:{cookie:admin}});expect(logout.status).toBe(204);expect((await fetch(`${handle.url}/customers`,{headers:{cookie:admin}})).status).toBe(403);
    }finally{await handle.close()}
  });

  it('reuses an injected host-owned user store across runtime restarts',async()=>{
    const result=compile(source,'auth-durable-run.bmec');expect(result.diagnostics).toEqual([]);const root=mkdtempSync(join(tmpdir(),'bmec-auth-durable-'));const users=new DurableUserStore();
    const first=await startRuntime(result.ir!,join(root,'generated-one'),join(root,'data','app.db'),0,{authUserStore:users});
    try{
      const registration=await fetch(`${first.url}/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'owner',password:'owner-pass-123'})});expect(registration.status).toBe(201);
    }finally{await first.close()}
    const second=await startRuntime(result.ir!,join(root,'generated-two'),join(root,'data','app.db'),0,{authUserStore:users});
    try{
      const login=await fetch(`${second.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'owner',password:'owner-pass-123'})});expect(login.status).toBe(200);
    }finally{await second.close()}
  });

  it('persists production users and sessions, rotates login state, and requires trusted browser origins',async()=>{
    const result=compile(source,'auth-production-run.bmec');expect(result.diagnostics).toEqual([]);const root=mkdtempSync(join(tmpdir(),'bmec-auth-production-'));const db=join(root,'data','app.db');const options={securityMode:'production' as const,allowedOrigins:['https://app.example.test'],authUsers:[{id:'admin',password:'admin-pass-123',role:'admin'}]};
    await expect(startRuntime(result.ir!,join(root,'missing-origin'),db,0,{...options,allowedOrigins:[]})).rejects.toThrow('BMEC_ALLOWED_ORIGINS');
    const first=await startRuntime(result.ir!,join(root,'generated-one'),db,0,options);
    let originalCookie:string;
    try{
      const denied=await fetch(`${first.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin-pass-123'})});expect(denied.status,await denied.text()).toBe(403);
      const wrongType=await fetch(`${first.url}/auth/login`,{method:'POST',headers:{origin:'https://app.example.test','content-type':'text/plain'},body:'credentials'});expect(wrongType.status).toBe(415);
      const login=await fetch(`${first.url}/auth/login`,{method:'POST',headers:{origin:'https://app.example.test','content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin-pass-123'})});expect(login.status).toBe(200);expect(await login.json()).toEqual({id:'admin'});originalCookie=login.headers.get('set-cookie')!.split(';')[0]!;expect(login.headers.get('set-cookie')).toContain('__Host-pipe_session=');expect(login.headers.get('set-cookie')).toContain('Secure');expect(login.headers.get('set-cookie')).toContain('HttpOnly');expect(login.headers.get('set-cookie')).toContain('SameSite=Lax');expect(login.headers.get('content-security-policy')).toContain("default-src 'self'");expect(readFileSync(join(root,'generated-one','app.js'),'utf8')).not.toContain('admin-pass-123');
      const previousCookie=originalCookie;const relogin=await fetch(`${first.url}/auth/login`,{method:'POST',headers:{origin:'https://app.example.test',cookie:previousCookie,'content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin-pass-123'})});expect(relogin.status).toBe(200);originalCookie=relogin.headers.get('set-cookie')!.split(';')[0]!;expect(originalCookie).not.toBe(previousCookie);expect((await fetch(`${first.url}/customers`,{headers:{cookie:previousCookie}})).status).toBe(403);
      for(let attempt=0;attempt<8;attempt++){const failed=await fetch(`${first.url}/auth/login`,{method:'POST',headers:{origin:'https://app.example.test','content-type':'application/json'},body:JSON.stringify({id:'admin',password:'wrong-password'})});expect(failed.status).toBe(401);expect(await failed.json()).toEqual({error:'invalid_credentials'});}
      const limited=await fetch(`${first.url}/auth/login`,{method:'POST',headers:{origin:'https://app.example.test','content-type':'application/json'},body:JSON.stringify({id:'admin',password:'wrong-password'})});expect(limited.status).toBe(429);expect(await limited.json()).toEqual({error:'rate_limited'});
      expect((await fetch(`${first.url}/customers`,{headers:{cookie:originalCookie}})).status).toBe(200);
      expect((await fetch(`${first.url}/auth/logout`,{method:'POST',headers:{cookie:originalCookie,'content-type':'application/json'},body:'{}'})).status).toBe(403);
    }finally{await first.close()}
    const second=await startRuntime(result.ir!,join(root,'generated-two'),db,0,options);
    try{
      expect((await fetch(`${second.url}/customers`,{headers:{cookie:originalCookie!}})).status).toBe(200);
      const logout=await fetch(`${second.url}/auth/logout`,{method:'POST',headers:{origin:'https://app.example.test',cookie:originalCookie!,'content-type':'application/json'},body:'{}'});expect(logout.status).toBe(204);
      expect((await fetch(`${second.url}/customers`,{headers:{cookie:originalCookie!}})).status).toBe(403);
    }finally{await second.close()}
  });

  it('injects the typed email adapter through the authenticated runtime boundary',async()=>{
    const emailSource=`app EmailApp
async function notify(mail capability<email>) -> task<result<boolean,text>> { return await sendEmail(mail, "user@example.test", "Hello", "Body") }
http POST /notify requires email -> notify`;
    const result=compile(emailSource,'auth-email-run.bmec');expect(result.diagnostics).toEqual([]);const root=mkdtempSync(join(tmpdir(),'bmec-auth-email-'));let delivered:{to:string;subject:string;body:string}|undefined;
    const handle=await startRuntime(result.ir!,join(root,'generated'),join(root,'data','app.db'),0,{authUsers:[{id:'admin',password:'admin-pass-123',role:'admin'}],email:message=>{delivered=message}});
    try{
      const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin-pass-123'})});expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
      const response=await fetch(`${handle.url}/notify`,{method:'POST',headers:{'content-type':'application/json',cookie},body:'{}'});expect(response.status).toBe(200);expect(await response.json()).toEqual({state:'ok',value:true});expect(delivered).toEqual({to:'user@example.test',subject:'Hello',body:'Body'});
    }finally{await handle.close()}
  });

  it('rejects database writes from GET routes before state changes',async()=>{
    const source=`app SafeMethod
model Product { sku text required unique stock integer required }
async function reserve(db capability<database>, sku text) -> task<integer> { return await databaseDecrementWhere(db, "Product", "stock", 1, "sku", sku) }
serve GET /reserve/:sku requiring role admin and database with reserve`;
    const result=compile(source,'safe-method.bmec');expect(result.diagnostics).toEqual([]);const root=mkdtempSync(join(tmpdir(),'bmec-safe-method-'));const handle=await startRuntime(result.ir!,join(root,'generated'),join(root,'data','app.db'),0,{authUsers:[{id:'admin',password:'admin-pass-123',role:'admin'}]});
    try{
      handle.database!.create('Product',{sku:'widget',stock:3});
      const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin-pass-123'})});expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
      const response=await fetch(`${handle.url}/reserve/widget`,{headers:{cookie}});expect(response.status).toBe(405);expect(await response.json()).toEqual({error:'safe_method_effect_forbidden'});expect((handle.database!.list('Product')[0] as any).stock).toBe(3);
    }finally{await handle.close()}
  });

  it('rejects email effects from GET routes before delivery',async()=>{
    const emailSource=`app SafeEmail
async function notify(mail capability<email>) -> task<result<boolean,text>> { return await sendEmail(mail, "user@example.test", "Hello", "Body") }
http GET /notify requires email -> notify`;
    const result=compile(emailSource,'safe-email.bmec');expect(result.diagnostics).toEqual([]);const root=mkdtempSync(join(tmpdir(),'bmec-safe-email-'));let delivered=false;
    const handle=await startRuntime(result.ir!,join(root,'generated'),join(root,'data','app.db'),0,{authUsers:[{id:'admin',password:'admin-pass-123',role:'admin'}],email:()=>{delivered=true}});
    try{
      const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin-pass-123'})});expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
      const response=await fetch(`${handle.url}/notify`,{headers:{cookie}});expect(response.status,await response.clone().text()).toBe(405);expect(await response.json()).toEqual({error:'safe_method_effect_forbidden'});expect(delivered).toBe(false);
    }finally{await handle.close()}
  });
});
