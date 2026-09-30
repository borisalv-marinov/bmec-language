import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

const handles:RuntimeHandle[]=[];
const roots:string[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('policy-selected same-path HTTP routes',()=>{
 it('selects one protected handler by server role and ignores request role claims',async()=>{
  const compiled=compile(`app JobBoard
type Principal { id text role text }
model Job { title text required workerId text required }
async function adminJobs(principal Principal, db capability<database>) -> task<list<Job>> {
 return wait for get jobs from Job ordered by title ascending limited to 100 using db
}
async function workerJobs(principal Principal, db capability<database>) -> task<list<Job>> {
 let assignedWorkerId = principal.id
 return wait for get jobs from Job where workerId is assignedWorkerId ordered by title ascending limited to 100 using db
}
async function viewerJobs(principal Principal, db capability<database>) -> task<list<Job>> {
 return wait for get jobs from Job ordered by title ascending limited to 100 using db
}
serve GET /api/jobs requiring role admin and database with adminJobs
serve GET /api/jobs requiring role worker and database with workerJobs
serve GET /api/jobs requiring role viewer and database with viewerJobs`);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.ir?.http?.routes.filter(route=>route.path==='/api/jobs')).toHaveLength(3);
  const root=mkdtempSync(join(tmpdir(),'bmec-role-route-selection-'));roots.push(root);
  const handle=await startRuntime(compiled.ir!,join(root,'generated'),join(root,'jobs.db'),0,{authUsers:[{id:'admin-1',password:'admin password',role:'admin'},{id:'worker-7',password:'worker password',role:'worker'},{id:'viewer-1',password:'viewer password',role:'viewer'}],defaultPolicy:'none'});handles.push(handle);
  handle.database.create('Job',{title:'Seven job',workerId:'worker-7'});
  handle.database.create('Job',{title:'Eight job',workerId:'worker-8'});
  const login=async(id:string,password:string)=>{const response=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,password})});expect(response.status).toBe(200);return response.headers.get('set-cookie')!.split(';',1)[0]!};
  expect((await fetch(`${handle.url}/api/jobs`)).status).toBe(403);
  const admin=await login('admin-1','admin password'),worker=await login('worker-7','worker password'),viewer=await login('viewer-1','viewer password');
  const adminResponse=await fetch(`${handle.url}/api/jobs`,{headers:{cookie:admin}});
  const workerResponse=await fetch(`${handle.url}/api/jobs?role=admin&workerId=worker-8`,{headers:{cookie:worker,'x-role':'admin'}});
  const viewerResponse=await fetch(`${handle.url}/api/jobs?role=worker`,{headers:{cookie:viewer}});
  expect(await adminResponse.json()).toMatchObject([{title:'Eight job'},{title:'Seven job'}]);
  expect(await workerResponse.json()).toMatchObject([{title:'Seven job',workerId:'worker-7'}]);
  expect(await viewerResponse.json()).toMatchObject([{title:'Eight job'},{title:'Seven job'}]);
 });
});
