import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

const handles:RuntimeHandle[]=[];
const roots:string[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('enum values in typed database operations',()=>{
 it('inserts and reads a simple enum through an authenticated HTTP route',async()=>{
  const compiled=compile(`app JobBoard
enum JobStatus { Open Assigned Done }
model Job { title text required status JobStatus required }
async function addJob(db capability<database>, body Job) -> task<integer> {
 return wait for add body to Job using db
}
serve POST /jobs requiring authenticated and database with addJob`);
  expect(compiled.diagnostics).toEqual([]);
  const root=mkdtempSync(join(tmpdir(),'bmec-database-enum-'));roots.push(root);
  const handle=await startRuntime(compiled.ir!,join(root,'generated'),join(root,'jobs.db'),0,{authUsers:[{id:'admin-1',password:'admin password',role:'admin'}],defaultPolicy:'none'});handles.push(handle);
  const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'admin-1',password:'admin password'})});
  expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';',1)[0]!;
  const invalid=await fetch(`${handle.url}/jobs`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({title:'Invalid status',status:'Cancelled'})});
  expect(invalid.status).toBe(400);expect(await invalid.json()).toEqual({error:'invalid_body'});expect(handle.database.get('Job',1)).toBeNull();
  const created=await fetch(`${handle.url}/jobs`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({title:'Review application',status:'Open'})});
  expect(created.status,await created.clone().text()).toBe(200);expect(await created.json()).toBe(1);
  expect(handle.database.get('Job',1)).toMatchObject({title:'Review application',status:'Open'});
 });
});
