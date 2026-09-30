import {afterEach,describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {compile} from '../src/compiler.js';
import {startNodeHttpSource,type NodeHttpHandle} from '../src/http/node-adapter.js';
import {ensureSqliteSchema} from '../src/db/sqlite.js';
import {sqliteAdapter} from '../src/db/adapter.js';
import {issueCapability} from '../src/runtime/capabilities.js';
import {AuthService} from '../src/runtime/auth.js';
import {authenticatedSession} from '../src/http/auth-policy.js';
import {serializeValue} from '../src/runtime/value-contract.js';
import {formatSource} from '../src/tooling/formatter.js';
import {postgresPoolAdapter} from '../src/db/postgres.js';
import {generateClientBindings} from '../src/http/client-bindings.js';
import {buildRelease} from '../src/release/release.js';

const postgresConnection=process.env.BMEC_POSTGRES_URL;const maybePostgres=postgresConnection?it:it.skip;

const handles:NodeHttpHandle[]=[];const clients:InstanceType<typeof Database>[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const client of clients.splice(0))client.close()});

describe('BMEC controlled-English application fixture',()=>{
 it('compiles the representative full-stack surface through the canonical IR',()=>{
  const file=join(process.cwd(),'examples','controlled-english','main.bmec');
  const source=readFileSync(file,'utf8');
  const result=compile(source,file);
  expect(result.diagnostics).toEqual([]);
  expect(result.ir?.models.map(model=>model.name)).toEqual(['User','Task']);
  expect(result.ir?.ui?.components.map(component=>component.name)).toEqual(['Dashboard','TaskRow','TaskForm']);
  expect(result.ir?.ui?.components.find(component=>component.name==='Dashboard')?.events).toEqual([{name:'Save',parameters:{}}]);
  expect(result.ir?.ui?.components.find(component=>component.name==='TaskForm')?.children).toEqual(expect.arrayContaining([expect.objectContaining({kind:'input',name:'title',validation:'nonempty'}),expect.objectContaining({kind:'button',label:'Save',event:'Save'})]));
  expect((result.ir?.functions.find(fn=>fn.name==='createTask')?.body[0] as any)?.value?.operand).toMatchObject({kind:'call',callee:'databaseInsert'});
  expect(result.ir?.apis).toEqual([expect.objectContaining({route:'/tasks',model:'Task',policyId:'authenticated'})]);
  expect(result.ir?.http?.routes.filter(route=>route.path==='/tasks'||route.path==='/tasks/:id')).toEqual(expect.arrayContaining([
   expect.objectContaining({method:'GET',path:'/tasks',policyId:'authenticated',capabilities:['database']}),
   expect.objectContaining({method:'POST',path:'/tasks',policyId:'authenticated',capabilities:['database']}),
   expect.objectContaining({method:'GET',path:'/tasks/:id',policyId:'authenticated'}),
   expect.objectContaining({method:'PUT',path:'/tasks/:id',policyId:'authenticated'}),
   expect.objectContaining({method:'DELETE',path:'/tasks/:id',policyId:'authenticated'}),
  ]));
  expect(result.ir?.styles?.map(style=>style.name)).toContain('DashboardStyle');
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  const cli=join(process.cwd(),'dist','cli','index.js');
  const project=JSON.parse(execFileSync(process.execPath,[cli,'project',file,'--json'],{encoding:'utf8'}));
  expect(project.models.map((model:{name:string})=>model.name)).toEqual(['User','Task']);
  expect(project.components).toEqual(expect.arrayContaining([expect.objectContaining({name:'TaskForm'}),expect.objectContaining({name:'TaskRow'})]));
  expect(project.routes).toEqual(expect.arrayContaining([expect.objectContaining({method:'GET',path:'/tasks',policyId:'authenticated',capabilities:['database']}),expect.objectContaining({method:'POST',path:'/tasks',policyId:'authenticated',capabilities:['database']})]));
  expect(project.releaseBoundary).toMatchObject({version:'bmec.release-boundary.v1',publicArtifacts:['index.html','app.js','pipe-release.json'],privateArtifacts:['server-ir.json'],credentialHandling:'server-only',sessionHandling:'server-only',protectedRoutes:expect.arrayContaining([expect.objectContaining({path:'/tasks',policyId:'authenticated',capabilities:['database']})]),capabilityRoutes:expect.arrayContaining([expect.objectContaining({path:'/tasks',capabilities:['database']})])});
  expect(JSON.stringify(project.releaseBoundary)).not.toMatch(/password|passwordHash|scrypt|pipe_session|APP_SECRET/i);
  const routes=JSON.parse(execFileSync(process.execPath,[cli,'routes',file,'--json'],{encoding:'utf8'}));
  const capabilities=JSON.parse(execFileSync(process.execPath,[cli,'capabilities',file,'--json'],{encoding:'utf8'}));
  expect(routes.routes).toEqual(project.routes);expect(capabilities.capabilities).toEqual(project.capabilities);
  expect(project.releaseBoundary.protectedRoutes).toEqual(project.routes.filter((route:{policyId?:string})=>route.policyId!==undefined).map((route:{id:string;method:string;path:string;policyId?:string;capabilities:string[]})=>({id:route.id,method:route.method,path:route.path,policyId:route.policyId,capabilities:route.capabilities})));
  expect(project.releaseBoundary.capabilityRoutes).toEqual(project.routes.filter((route:{capabilities:string[]})=>route.capabilities.length>0).map((route:{id:string;method:string;path:string;capabilities:string[]})=>({id:route.id,method:route.method,path:route.path,capabilities:route.capabilities})));
  const pages=JSON.parse(execFileSync(process.execPath,[cli,'pages',file,'--json'],{encoding:'utf8'}));
  expect(pages.pages).toEqual([expect.objectContaining({name:'Dashboard',children:expect.arrayContaining([expect.objectContaining({kind:'list',source:'tasks',item:'task'})])})]);
  const styles=JSON.parse(execFileSync(process.execPath,[cli,'styles',file,'--json'],{encoding:'utf8'}));
  expect(styles.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'DashboardStyle',layout:'grid',columns:2,responsiveColumns:1})]));
 });
 it('keeps the representative release boundary deterministic and server-safe',()=>{
  const file=join(process.cwd(),'examples','controlled-english','main.bmec');
  const result=compile(readFileSync(file,'utf8'),file);expect(result.diagnostics).toEqual([]);expect(result.ir?.http).toBeDefined();
  const client=generateClientBindings(result.ir!.http!,result.ir!);
  expect(client).toContain('SOURCE_HTTP_001');expect(client).toContain('SOURCE_HTTP_001Params');expect(client).toContain('request("POST"');expect(client).toContain('const path=`/tasks`');
  const first=mkdtempSync(join(tmpdir(),'bmec-controlled-release-a-'));const second=mkdtempSync(join(tmpdir(),'bmec-controlled-release-b-'));
  try{
   const metadata={packageName:'controlled-english',packageVersion:'0.2.0-test',languageVersion:'0.1-alpha'};
   const a=buildRelease(result.ir!,first,metadata);const b=buildRelease(result.ir!,second,metadata);
   for(const artifact of [a.artifacts.server,a.artifacts.browser,a.artifacts.manifest,'app.js']){
    expect(readFileSync(join(first,artifact))).toEqual(readFileSync(join(second,artifact)));
   }
   const server=readFileSync(join(first,a.artifacts.server),'utf8');const browser=readFileSync(join(first,a.artifacts.browser),'utf8');const app=readFileSync(join(first,'app.js'),'utf8');
   expect(existsSync(join(first,'server-ir.json'))).toBe(true);expect(server).toContain('databaseInsert');expect(server).toContain('"path": "/tasks"');
   expect(browser).toContain('data-model="Task"');expect(browser).toContain('data-api="/tasks"');expect(browser).toContain('data-pipe-event="Save"');expect(browser).not.toContain('databaseInsert');expect(browser).not.toContain('"db":');
   expect(app).not.toContain('databaseSelect');expect(app).not.toContain('databaseInsert');expect(app).not.toContain('capability<database>');
  }finally{rmSync(first,{recursive:true,force:true});rmSync(second,{recursive:true,force:true})}
 });
 it('executes the controlled-English create route through authenticated HTTP and SQLite',async()=>{
  const file=join(process.cwd(),'examples','controlled-english','main.bmec');
  const result=compile(readFileSync(file,'utf8'),file);expect(result.diagnostics).toEqual([]);
  const client=new Database(':memory:');clients.push(client);ensureSqliteSchema(client,result.ir!.db!);
  const auth=new AuthService();await auth.register('owner','owner pass');
  const handle=await startNodeHttpSource(result.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!},configureRouter:router=>router.registerPolicy('authenticated',authenticatedSession(auth.sessions))});handles.push(handle);
  expect((await fetch(`${handle.url}/tasks`)).status).toBe(403);
  const session=await auth.login('owner','owner pass');const authHeaders={authorization:`Bearer ${session!.id}`};
  const create=result.ir!.functions.find(fn=>fn.name==='createTask')!;const bodyType=create.parameters.find(parameter=>parameter.name==='body')!.typeRef;
  const body=serializeValue({kind:'model',type:bodyType,fields:{title:{kind:'text',value:'controlled task'},done:{kind:'boolean',value:false}}});
  const response=await fetch(`${handle.url}/tasks`,{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify(body)});
  expect(response.status).toBe(200);expect(await response.json()).toBe(1);
  const updateBody=JSON.stringify(serializeValue({kind:'model',type:bodyType,fields:{title:{kind:'text',value:'unauthorized update'},done:{kind:'boolean',value:true}}}));
  for(const [method,url] of [['GET','/tasks/1'],['PUT','/tasks/1'],['DELETE','/tasks/1']] as const){const denied=await fetch(`${handle.url}${url}`,{method,headers:method==='PUT'?{'content-type':'application/json'}:{},...(method==='PUT'?{body:updateBody}:{})});expect(denied.status).toBe(403);}
  const deniedCreate=await fetch(`${handle.url}/tasks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});expect(deniedCreate.status).toBe(403);
  const rows=await fetch(`${handle.url}/tasks`,{headers:authHeaders});expect(rows.status).toBe(200);expect(await rows.json()).toEqual([{id:1,title:'controlled task',done:false}]);
  expect((await fetch(`${handle.url}/tasks/1`,{headers:authHeaders})).status).toBe(200);
  const updated=await fetch(`${handle.url}/tasks/1`,{method:'PUT',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify(serializeValue({kind:'model',type:bodyType,fields:{title:{kind:'text',value:'updated task'},done:{kind:'boolean',value:true}}}))});expect(updated.status).toBe(200);
  expect(await (await fetch(`${handle.url}/tasks/1`,{headers:authHeaders})).json()).toMatchObject({title:'updated task',done:true});
  const removed=await fetch(`${handle.url}/tasks/1`,{method:'DELETE',headers:authHeaders});expect(removed.status).toBe(200);expect((await fetch(`${handle.url}/tasks/1`,{headers:authHeaders})).status).toBe(404);
 });
 maybePostgres('executes the controlled-English create route through authenticated HTTP and PostgreSQL',async()=>{
  const file=join(process.cwd(),'examples','controlled-english','main.bmec');const result=compile(readFileSync(file,'utf8'),file);expect(result.diagnostics).toEqual([]);
  const {Pool}=await import('pg');const pool=new Pool({connectionString:postgresConnection});
  try{
   await pool.query('DROP TABLE IF EXISTS "Task" CASCADE');await pool.query('CREATE TABLE "Task" ("id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,"title" text NOT NULL,"done" boolean NOT NULL)');
   const auth=new AuthService();await auth.register('owner','owner pass');
   const handle=await startNodeHttpSource(result.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:postgresPoolAdapter(pool),schema:result.ir!.db!},configureRouter:router=>router.registerPolicy('authenticated',authenticatedSession(auth.sessions))});handles.push(handle);
   expect((await fetch(`${handle.url}/tasks`)).status).toBe(403);const session=await auth.login('owner','owner pass');const authHeaders={authorization:`Bearer ${session!.id}`};
   const create=result.ir!.functions.find(fn=>fn.name==='createTask')!;const bodyType=create.parameters.find(parameter=>parameter.name==='body')!.typeRef;const body=serializeValue({kind:'model',type:bodyType,fields:{title:{kind:'text',value:'postgres task'},done:{kind:'boolean',value:false}}});
   const response=await fetch(`${handle.url}/tasks`,{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify(body)});expect(response.status).toBe(200);expect(await response.json()).toBe(1);
   const rows=await fetch(`${handle.url}/tasks`,{headers:authHeaders});expect(rows.status).toBe(200);expect(await rows.json()).toEqual([{id:1,title:'postgres task',done:false}]);
  } finally {await pool.query('DROP TABLE IF EXISTS "Task" CASCADE');await pool.end()}
 });
});
