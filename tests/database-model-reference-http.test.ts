import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

const handles:RuntimeHandle[]=[];
const roots:string[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('model-reference foreign keys in SQLite HTTP operations',()=>{
 it('enforces a declared model relationship and leaves no row for an unknown reference',async()=>{
  const compiled=compile(`app JobBoard
model Customer { name text required }
type NewJob { customer Customer title text }
model Job { customer Customer required title text required createdAt integer required }
async function addJob(time capability<time>, db capability<database>, body NewJob) -> task<integer> {
 let job = Job { customer: body.customer, title: body.title, createdAt: currentTime(time) }
 return wait for add job to Job using db
}
serve POST /jobs requiring authenticated and database and time with addJob`);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.ir?.db?.models.find(model=>model.name==='Job')?.foreignKeys).toHaveLength(1);
  const root=mkdtempSync(join(tmpdir(),'bmec-model-reference-'));roots.push(root);
  const handle=await startRuntime(compiled.ir!,join(root,'generated'),join(root,'jobs.db'),0,{authUsers:[{id:'worker-1',password:'worker password',role:'worker'}],defaultPolicy:'none'});handles.push(handle);
  handle.database.create('Customer',{name:'Northwind'});
  const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'worker-1',password:'worker password'})});
  expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';',1)[0]!;
  const valid=await fetch(`${handle.url}/jobs`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({customer:1,title:'Valid reference'})});
  expect(valid.status,await valid.clone().text()).toBe(200);expect(await valid.json()).toBe(1);
  const blank=await fetch(`${handle.url}/jobs`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({customer:1,title:''})});
  expect(blank.status).toBe(400);expect(await blank.json()).toEqual({error:'invalid_database_value',code:'PIPE-DB-002'});
  const invalid=await fetch(`${handle.url}/jobs`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({customer:999,title:'Invalid reference'})});
  expect(invalid.status).toBe(400);expect(await invalid.json()).toEqual({error:'invalid_database_value',code:'PIPE-DB-002'});
  expect(handle.database.get('Job',1)).toMatchObject({title:'Valid reference',createdAt:expect.any(Number)});
  expect(handle.database.get('Job',2)).toBeNull();
 });
});
