import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

const handles:RuntimeHandle[]=[];
const roots:string[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('typed authenticated principal context',()=>{
 it('injects server-resolved identity and attributes instead of request claims',async()=>{
  const compiled=compile(`app Secure
type Principal { id text role text }
function identity(principal Principal) -> text { return principal.id }
function roleOf(principal Principal) -> text { return principal.role }
serve GET /whoami requiring authenticated with identity
serve GET /role requiring authenticated with roleOf`);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.ir?.http?.routes.map(route=>({path:route.path,query:route.query.map(field=>field.name),principalParam:route.principalParam}))).toEqual([
   {path:'/whoami',query:[],principalParam:'principal'},
   {path:'/role',query:[],principalParam:'principal'},
  ]);
  const root=mkdtempSync(join(tmpdir(),'bmec-principal-context-'));roots.push(root);
  const handle=await startRuntime(compiled.ir!,join(root,'generated'),join(root,'secure.db'),0,{authUsers:[{id:'worker-7',password:'worker password',role:'worker'}],defaultPolicy:'none'});handles.push(handle);
  expect((await fetch(`${handle.url}/whoami`)).status).toBe(403);
  const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'worker-7',password:'worker password'})});
  expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';',1)[0]!;
  const identity=await fetch(`${handle.url}/whoami?principal=admin&id=admin`,{headers:{cookie}});
  const role=await fetch(`${handle.url}/role?principal=admin&role=admin`,{headers:{cookie}});
  expect(identity.status).toBe(200);expect(await identity.json()).toBe('worker-7');
  expect(role.status).toBe(200);expect(await role.json()).toBe('worker');
 });
 it('rejects a Principal handler input on an unprotected route',()=>{
  const compiled=compile(`app Secure
type Principal { id text }
function identity(principal Principal) -> text { return principal.id }
serve GET /whoami with identity`);
  expect(compiled.diagnostics.map(diagnostic=>diagnostic.code)).toContain('PIPE-HTTP-005');
 });
 it('requires a text identity field in the Principal record',()=>{
  const compiled=compile(`app Secure
type Principal { id integer }
function identity(principal Principal) -> text { return "user" }
serve GET /whoami requiring authenticated with identity`);
  expect(compiled.diagnostics.map(diagnostic=>diagnostic.code)).toContain('PIPE-HTTP-005');
 });
 it('filters database reads using the authenticated principal id',async()=>{
  const compiled=compile(`app JobBoard
type Principal { id text role text }
model Job { title text required workerId text required }
async function assignedJobs(principal Principal, db capability<database>) -> task<list<Job>> {
 let assignedWorkerId = principal.id
 return wait for get jobs from Job where workerId is assignedWorkerId using db
}
serve GET /my-jobs requiring authenticated and database with assignedJobs`);
  expect(compiled.diagnostics).toEqual([]);
  const root=mkdtempSync(join(tmpdir(),'bmec-principal-owner-read-'));roots.push(root);
  const handle=await startRuntime(compiled.ir!,join(root,'generated'),join(root,'jobs.db'),0,{authUsers:[{id:'worker-7',password:'worker password',role:'worker'},{id:'worker-8',password:'other password',role:'worker'}],defaultPolicy:'none'});handles.push(handle);
  handle.database.create('Job',{title:'Assigned to seven',workerId:'worker-7'});
  handle.database.create('Job',{title:'Assigned to eight',workerId:'worker-8'});
  const login=async(id:string,password:string)=>{const response=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,password})});expect(response.status).toBe(200);return response.headers.get('set-cookie')!.split(';',1)[0]!};
  const workerSeven=await login('worker-7','worker password'),workerEight=await login('worker-8','other password');
  const seven=await fetch(`${handle.url}/my-jobs?workerId=worker-8`,{headers:{cookie:workerSeven}});
  const eight=await fetch(`${handle.url}/my-jobs?workerId=worker-7`,{headers:{cookie:workerEight}});
  expect(await seven.json()).toMatchObject([{title:'Assigned to seven',workerId:'worker-7'}]);
 expect(await eight.json()).toMatchObject([{title:'Assigned to eight',workerId:'worker-8'}]);
 });
 it('updates only the authenticated owner row in one conditional database operation',async()=>{
  const compiled=compile(`app JobBoard
type Principal { id text role text }
model Job { title text required workerId text required }
async function updateAssignedJob(principal Principal, db capability<database>, id integer, body Job) -> task<integer> {
 let assignedWorkerId = principal.id
 return wait for update body in Job with id where workerId is assignedWorkerId using db
}
serve PATCH /jobs/:id requiring authenticated and database with updateAssignedJob`);
  expect(compiled.diagnostics).toEqual([]);
  const root=mkdtempSync(join(tmpdir(),'bmec-principal-owner-update-'));roots.push(root);
  const handle=await startRuntime(compiled.ir!,join(root,'generated'),join(root,'jobs.db'),0,{authUsers:[{id:'worker-7',password:'worker password',role:'worker'},{id:'worker-8',password:'other password',role:'worker'}],defaultPolicy:'none'});handles.push(handle);
  const sevenId=Number(handle.database.create('Job',{title:'Original seven',workerId:'worker-7'}).id),eightId=Number(handle.database.create('Job',{title:'Original eight',workerId:'worker-8'}).id);
  const login=async(id:string,password:string)=>{const response=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,password})});expect(response.status).toBe(200);return response.headers.get('set-cookie')!.split(';',1)[0]!};
  const workerSeven=await login('worker-7','worker password');
  const update=async(id:number,title:string,workerId:string)=>fetch(`${handle.url}/jobs/${id}?workerId=worker-8`,{method:'PATCH',headers:{cookie:workerSeven,'content-type':'application/json'},body:JSON.stringify({title,workerId})});
  const denied=await update(eightId,'Stolen title','worker-8');expect(denied.status).toBe(200);expect(await denied.json()).toBe(0);
  const allowed=await update(sevenId,'Seven updated','worker-8');expect(allowed.status).toBe(200);expect(await allowed.json()).toBe(1);
  expect(handle.database.get('Job',sevenId)).toMatchObject({title:'Seven updated',workerId:'worker-7'});
  expect(handle.database.get('Job',eightId)).toMatchObject({title:'Original eight',workerId:'worker-8'});
 });
});
