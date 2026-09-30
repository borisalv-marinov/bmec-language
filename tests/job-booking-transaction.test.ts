import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

const handles:RuntimeHandle[]=[];
const roots:string[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('Job Booking example transactional audit',()=>{
 it('commits HTTP create/update/delete with audit rows and rolls each mutation back on audit failure',async()=>{
  const sourcePath=join(process.cwd(),'examples','job-booking','main.bmec');
  const compiled=compile(readFileSync(sourcePath,'utf8'),sourcePath);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.ir?.apis.map(api=>({model:api.model,policyId:api.policyId}))).toEqual([
   {model:'Customer',policyId:'role:admin'},
   {model:'Job',policyId:'role:admin'},
   {model:'JobNote',policyId:'role:admin'},
  ]);
  expect(compiled.ir?.http?.routes.find(route=>route.method==='POST'&&route.path==='/job-notes')?.policyId).toBe('role:worker');
  const root=mkdtempSync(join(tmpdir(),'bmec-job-booking-transaction-'));roots.push(root);
  const databasePath=join(root,'job-booking.sqlite');
  const users=[{id:'admin',password:'admin-pass-123',role:'admin'},{id:'worker',password:'worker-pass-123',role:'worker'},{id:'worker2',password:'worker2-pass-123',role:'worker'}];
  const start=()=>startRuntime(compiled.ir!,join(root,'generated'),databasePath,0,{authUsers:users,defaultPolicy:'none'});
  let handle=await start();handles.push(handle);
  handle.database.create('User',{authId:'admin',email:'admin@example.test',role:'admin'});
  const workerRecord=handle.database.create('User',{authId:'worker',email:'worker@example.test',role:'worker'});
  const secondWorkerRecord=handle.database.create('User',{authId:'worker2',email:'worker2@example.test',role:'worker'});
  handle.database.create('Customer',{name:'Northwind',email:'client@example.test',phone:'555-0100'});
  const login=async(id:string,password:string)=>{const response=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,password})});expect(response.status).toBe(200);return response.headers.get('set-cookie')!.split(';',1)[0]!;};
  const admin=await login('admin','admin-pass-123'),worker=await login('worker','worker-pass-123');
  const jobBody={customer:1,workerAuthId:'worker',title:'Postgres boiler repair',description:'Persist status through example',price:1250,scheduledDate:'2026-10-02',status:'Pending'};
  const anonymousRequests=[
   {path:'/customers',method:'GET'},
   {path:'/customers',method:'POST',body:{name:'Anonymous',email:'anon@example.test',phone:'555-0000'}},
   {path:'/customers/1',method:'GET'},
   {path:'/customers/1',method:'PUT',body:{name:'Tampered',email:'anon@example.test',phone:'555-0000'}},
   {path:'/customers/1',method:'DELETE'},
   {path:'/jobs',method:'POST',body:jobBody},
   {path:'/jobs/1',method:'GET'},
   {path:'/jobs/1',method:'PUT',body:jobBody},
   {path:'/jobs/1',method:'DELETE'},
   {path:'/job-notes',method:'GET'},
   {path:'/job-notes',method:'POST',body:{jobId:1,text:'Anonymous note'}},
   {path:'/job-notes/1',method:'DELETE'},
  ] as const;
  for(const request of anonymousRequests){
   const response=await fetch(`${handle.url}${request.path}`,{method:request.method,...('body'in request?{headers:{'content-type':'application/json'},body:JSON.stringify(request.body)}:{})});
   expect(response.status,`${request.method} ${request.path} must deny anonymous access: ${await response.text()}`).toBe(403);
  }
  expect((await fetch(`${handle.url}/customers`,{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status).toBe(403);
  const created=await fetch(`${handle.url}/jobs`,{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify(jobBody)});
  expect(created.status,await created.clone().text()).toBe(200);expect(await created.json()).toBe(1);
  const invalidAssignment=await fetch(`${handle.url}/jobs`,{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify({...jobBody,workerAuthId:'missing-worker'})});
  expect(invalidAssignment.status).toBe(200);expect(await invalidAssignment.json()).toBe(0);expect(handle.database.list('Job')).toHaveLength(1);expect(handle.database.list('JobAudit')).toHaveLength(1);
  const secondJob=handle.database.create('Job',{...jobBody,worker:Number(secondWorkerRecord.id),workerAuthId:'worker2',title:'Worker two private job'});
  const secondWorker=await login('worker2','worker2-pass-123');
  const adminJobs=await fetch(`${handle.url}/jobs`,{headers:{cookie:admin}});
  expect(adminJobs.status).toBe(200);expect((await adminJobs.json()).map((job:{title:string})=>job.title)).toEqual(['Postgres boiler repair','Worker two private job']);
  expect((await fetch(`${handle.url}/jobs`)).status).toBe(403);
  expect((await fetch(`${handle.url}/jobs`,{headers:{cookie:worker}})).status).toBe(403);
  expect((await fetch(`${handle.url}/worker-jobs`)).status).toBe(403);
  const workerJobs=await fetch(`${handle.url}/worker-jobs`,{headers:{cookie:worker}});
  expect(workerJobs.status,await workerJobs.clone().text()).toBe(200);expect((await workerJobs.json()).map((job:{title:string})=>job.title)).toEqual(['Postgres boiler repair']);
  const secondWorkerJobs=await fetch(`${handle.url}/worker-jobs`,{headers:{cookie:secondWorker}});
  expect(secondWorkerJobs.status).toBe(200);expect((await secondWorkerJobs.json()).map((job:{title:string})=>job.title)).toEqual(['Worker two private job']);
  const spoofedNote=await fetch(`${handle.url}/job-notes`,{method:'POST',headers:{cookie:worker,'content-type':'application/json'},body:JSON.stringify({jobId:1,author:Number(secondWorkerRecord.id),text:'Spoofed author',createdAt:'2026-10-02T09:00:00.000Z'})});
  expect(spoofedNote.status).toBe(400);expect(handle.database.list('JobNote')).toHaveLength(0);
  const otherJobNote=await fetch(`${handle.url}/job-notes`,{method:'POST',headers:{cookie:worker,'content-type':'application/json'},body:JSON.stringify({jobId:Number(secondJob.id),text:'Wrong job',createdAt:'2026-10-02T09:00:00.000Z'})});
  expect(otherJobNote.status).toBe(200);expect(await otherJobNote.json()).toBe(0);expect(handle.database.list('JobNote')).toHaveLength(0);
  const createdNote=await fetch(`${handle.url}/job-notes`,{method:'POST',headers:{cookie:worker,'content-type':'application/json'},body:JSON.stringify({jobId:1,text:'On my way',createdAt:'2026-10-02T09:00:00.000Z'})});
  expect(createdNote.status,await createdNote.clone().text()).toBe(200);expect(await createdNote.json()).toBe(1);
  expect(handle.database.get('JobNote',1)).toMatchObject({job:1,author:Number(workerRecord.id),text:'On my way'});
  handle.database.delete('JobNote',1);
  expect((await fetch(`${handle.url}/worker-jobs/${secondWorkerRecord.id}`,{headers:{cookie:worker}})).status).toBe(405);
  const crossWorkerUpdate=await fetch(`${handle.url}/worker-jobs/${secondJob.id}`,{method:'PATCH',headers:{cookie:worker,'content-type':'application/json'},body:JSON.stringify({status:'Done'})});
  expect(crossWorkerUpdate.status).toBe(200);expect(await crossWorkerUpdate.json()).toBe(0);
  expect(handle.database.get('Job',Number(secondJob.id))).toMatchObject({title:'Worker two private job',worker:Number(secondWorkerRecord.id)});
  const forbiddenFieldUpdate=await fetch(`${handle.url}/worker-jobs/1`,{method:'PATCH',headers:{cookie:worker,'content-type':'application/json'},body:JSON.stringify({status:'InProgress',title:'Tampered title',price:1,worker:Number(secondWorkerRecord.id)})});
  expect(forbiddenFieldUpdate.status).toBe(400);
  const updated=await fetch(`${handle.url}/worker-jobs/1`,{method:'PATCH',headers:{cookie:worker,'content-type':'application/json'},body:JSON.stringify({status:'InProgress'})});
  expect(updated.status).toBe(200);expect(await updated.json()).toBe(1);
  expect(handle.database.get('Job',1)).toMatchObject({worker:Number(workerRecord.id),title:'Postgres boiler repair',price:{minor:'125000',scale:2},status:'InProgress'});
  expect(handle.database.list('JobAudit').map(row=>`${row.action}:${row.actor}:${row.targetId}`).sort()).toEqual(['job_created:admin:1','job_updated:worker:1']);

  const sqlite=(handle.database as unknown as {db:InstanceType<typeof Database>}).db;
  const jobBeforeFailures=handle.database.get('Job',1),auditCount=handle.database.list('JobAudit').length;
  sqlite.exec(`CREATE TRIGGER reject_job_booking_audit BEFORE INSERT ON "pipe_JobAudit" BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
  const failedCreate=await fetch(`${handle.url}/jobs`,{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify(jobBody)});
  expect(failedCreate.status).toBe(500);await failedCreate.text();
  const failedUpdate=await fetch(`${handle.url}/worker-jobs/1`,{method:'PATCH',headers:{cookie:worker,'content-type':'application/json'},body:JSON.stringify({status:'Done'})});
  expect(failedUpdate.status).toBe(500);await failedUpdate.text();
  const failedDelete=await fetch(`${handle.url}/jobs/1`,{method:'DELETE',headers:{cookie:admin}});
  expect(failedDelete.status).toBe(500);await failedDelete.text();
  expect(handle.database.list('Job')).toHaveLength(2);
  expect(handle.database.get('Job',1)).toMatchObject({title:'Postgres boiler repair',status:'InProgress'});
  expect(handle.database.list('JobAudit')).toHaveLength(auditCount);
  sqlite.exec('DROP TRIGGER reject_job_booking_audit');

  const deleted=await fetch(`${handle.url}/jobs/1`,{method:'DELETE',headers:{cookie:admin}});
  expect(deleted.status).toBe(200);expect(await deleted.json()).toBe(1);
  expect(handle.database.list('Job')).toHaveLength(1);
  expect(handle.database.get('Job',Number(secondJob.id))).toMatchObject({title:'Worker two private job',worker:Number(secondWorkerRecord.id)});
  expect(handle.database.list('JobAudit').map(row=>`${row.action}:${row.actor}:${row.targetId}`).sort()).toEqual(['job_created:admin:1','job_deleted:admin:1','job_updated:worker:1']);
  await handle.close();handles.splice(handles.indexOf(handle),1);
  handle=await start();handles.push(handle);
  const adminAfterRestart=await login('admin','admin-pass-123');
  expect(handle.database.list('JobAudit')).toHaveLength(3);
  expect((await (await fetch(`${handle.url}/jobs`,{headers:{cookie:adminAfterRestart}})).json()).map((job:{title:string})=>job.title)).toEqual(['Worker two private job']);
 });
});
