import {describe,expect,it} from 'vitest';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compileProject} from '../src/compiler.js';
import {buildRelease} from '../src/release/release.js';
import {startNodeHttpSource,type NodeHttpHandle} from '../src/http/node-adapter.js';
import {startNodeRelease} from '../src/release/server.js';
import Database from 'better-sqlite3';
import {ensureSqliteSchema} from '../src/db/sqlite.js';
import {sqliteAdapter} from '../src/db/adapter.js';
import {issueCapability} from '../src/runtime/capabilities.js';
import {serializeValue} from '../src/runtime/value-contract.js';
import type {ProjectIR} from '../src/ir/ir.js';
import {AuthService} from '../src/runtime/auth.js';
import {authenticatedSession,rolePolicy} from '../src/http/auth-policy.js';
import {registerAuthHandlers} from '../src/http/auth-handlers.js';

describe('clean release artifact smoke',()=>it('serves the generated public entrypoint and bundled browser asset',async()=>{
 const compiled=compileProject(join(process.cwd(),'examples','task-manager','main.pipe'));
 expect(compiled.diagnostics).toEqual([]);
 const directory=join(mkdtempSync(join(tmpdir(),'pipe-clean-release-')),'dist');
 const release=buildRelease(compiled.ir!,directory,{packageName:'task-manager',packageVersion:'0.1.0',languageVersion:'0.1-alpha'});
 const serverIR=readFileSync(join(directory,release.artifacts.server),'utf8');
 expect(serverIR).toContain('databaseSelect');
 expect(readFileSync(join(directory,'app.js'),'utf8')).not.toContain('APP_SECRET');
 const server=createServer((request,response)=>{const name=request.url==='/'?'index.html':request.url?.slice(1);if(!name||!['index.html','app.js','pipe-release.json'].includes(name)){response.writeHead(404);return response.end()}response.end(readFileSync(join(directory,name)));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));
 try {const address=server.address();if(!address||typeof address==='string')throw new Error('server did not bind');const root=`http://127.0.0.1:${address.port}`;const page=await fetch(root+'/');const asset=await fetch(root+'/app.js');expect(page.status).toBe(200);expect(await page.text()).toContain('<script src="app.js"></script>');expect(asset.status).toBe(200);expect((await asset.text()).length).toBeGreaterThan(100);} finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}));

describe('clean release authentication smoke',()=>it('logs in and protects the released BMEC application over TCP',async()=>{
 const compiled=compileProject(join(process.cwd(),'examples','task-manager','main.pipe'));
 expect(compiled.diagnostics).toEqual([]);
 const directory=join(mkdtempSync(join(tmpdir(),'pipe-release-auth-')),'dist');
 const release=buildRelease(compiled.ir!,directory,{packageName:'task-manager',packageVersion:'0.1.0',languageVersion:'0.1-alpha'});
 const serverIR=JSON.parse(readFileSync(join(directory,release.artifacts.server),'utf8')) as ProjectIR;
 const client=new Database(':memory:');ensureSqliteSchema(client,serverIR.db!);
 const auth=new AuthService();await auth.register('owner','owner pass',{role:'admin'});
 const authRoutes=[
   {id:'register',method:'POST' as const,path:'/auth/register',pathParams:[],query:[],headers:[],status:201,errorStatuses:[400,409],handlerId:'register'},
   {id:'login',method:'POST' as const,path:'/auth/login',pathParams:[],query:[],headers:[],status:200,errorStatuses:[400,401],handlerId:'login'},
   {id:'logout',method:'POST' as const,path:'/auth/logout',pathParams:[],query:[],headers:[],status:204,errorStatuses:[401],handlerId:'logout'},
 ];
 const protectedIR={...serverIR,http:{routes:[...(serverIR.http?.routes??[]),...authRoutes]}};
 const token=issueCapability('database');
 const handle=await startNodeHttpSource(protectedIR,{capabilityTokens:new Map([['database',token]]),database:{adapter:sqliteAdapter(client,serverIR.db!),schema:serverIR.db!},configureRouter:router=>{registerAuthHandlers(router,auth,{register:'register',login:'login',logout:'logout'});router.registerPolicy('authenticated',authenticatedSession(auth.sessions));router.registerPolicy('role:admin',rolePolicy(auth,'admin'));}});
 try {
   const denied=await fetch(`${handle.url}/tasks`);expect(denied.status).toBe(403);
   const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'owner',password:'owner pass'})});
   expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')?.split(';',1)[0];expect(cookie).toMatch(/^__Host-pipe_session=/);expect(login.headers.get('set-cookie')).toContain('Secure');
   const allowed=await fetch(`${handle.url}/tasks`,{headers:{cookie:cookie!}});expect(allowed.status).toBe(200);expect(await allowed.json()).toEqual([]);
   const logout=await fetch(`${handle.url}/auth/logout`,{method:'POST',headers:{cookie:cookie!}});expect(logout.status).toBe(204);
   expect((await fetch(`${handle.url}/tasks`,{headers:{cookie:cookie!}})).status).toBe(403);
 } finally {await handle.close();client.close();}
}));

describe('release server artifact smoke',()=>it('launches server-ir.json and serves a BMEC source route',async()=>{
 const compiled=compileProject(join(process.cwd(),'examples','task-manager','main.pipe'));
 const directory=join(mkdtempSync(join(tmpdir(),'pipe-release-server-')),'dist');
 const release=buildRelease(compiled.ir!,directory,{packageName:'task-manager',packageVersion:'0.1.0',languageVersion:'0.1-alpha'});
 const serverIR=JSON.parse(readFileSync(join(directory,release.artifacts.server),'utf8')) as ProjectIR;
 const client=new Database(':memory:');ensureSqliteSchema(client,serverIR.db!);const db=sqliteAdapter(client,serverIR.db!);const token=issueCapability('database');const auth=new AuthService();await auth.register('owner','owner pass',{role:'admin'});const session=await auth.login('owner','owner pass');const authHeaders={authorization:`Bearer ${session!.id}`};
 const handle:NodeHttpHandle=await startNodeRelease(directory,{capabilityTokens:new Map([['database',token]]),database:{adapter:db,schema:serverIR.db!},configureRouter:router=>{router.registerPolicy('authenticated',authenticatedSession(auth.sessions));router.registerPolicy('role:admin',rolePolicy(auth,'admin'));}});
 try {const page=await fetch(`${handle.url}/`);expect(page.status).toBe(200);expect(await page.text()).toContain('<script src="app.js"></script>');const asset=await fetch(`${handle.url}/app.js`);expect(asset.status).toBe(200);expect(await asset.text()).toContain('PIPE_UI_EVENTS');expect((await fetch(`${handle.url}/server-ir.json`)).status).toBe(404);expect((await fetch(`${handle.url}/tasks`)).status).toBe(403);const empty=await fetch(`${handle.url}/tasks`,{headers:authHeaders});expect(empty.status).toBe(200);expect(await empty.json()).toEqual([]);const create=serverIR.functions.find(fn=>fn.name==='createTask')!;const bodyType=create.parameters.find(parameter=>parameter.name==='body')!.typeRef;const body=serializeValue({kind:'model',type:bodyType,fields:{title:{kind:'text',value:'from release'},done:{kind:'boolean',value:false}}});const response=await fetch(`${handle.url}/tasks`,{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify(body)});expect(response.status).toBe(200);expect(await response.json()).toBe(1);expect(await (await fetch(`${handle.url}/tasks`,{headers:authHeaders})).json()).toMatchObject([{title:'from release',done:false}]);} finally {await handle.close();client.close();}
}));
