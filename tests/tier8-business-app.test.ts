import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {Pool} from 'pg';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

const handles:RuntimeHandle[]=[];
const roots:string[]=[];
const postgresConnection=process.env.BMEC_POSTGRES_URL;
const maybePostgres=postgresConnection?it:it.skip;
const postgresFixtureSource=`app TierEightPostgresAudit
type Principal { id text role text }
model T8CI_Record { title text required }
model T8CI_Audit { action text required actor text required targetId integer? }
async function createRecord(principal Principal, db capability<database>, body T8CI_Record) -> task<integer> {
 var createdId integer = 0
 transaction using db {
  createdId = await databaseInsertId(db, "T8CI_Record", body)
  let event = T8CI_Audit { action: "created", actor: principal.id, targetId: createdId }
  let auditId = wait for add event to T8CI_Audit using db
 }
 return createdId
}
async function updateRecord(principal Principal, db capability<database>, id integer, body T8CI_Record) -> task<integer> {
 var changed integer = 0
 transaction using db {
  changed = wait for update body in T8CI_Record with id using db
  if changed > 0 {
   let event = T8CI_Audit { action: "updated", actor: principal.id, targetId: id }
   let auditId = wait for add event to T8CI_Audit using db
  }
 }
 return changed
}
async function deleteRecord(principal Principal, db capability<database>, id integer) -> task<integer> {
 var changed integer = 0
 transaction using db {
  changed = wait for delete id from T8CI_Record using db
  if changed > 0 {
   let event = T8CI_Audit { action: "deleted", actor: principal.id, targetId: id }
   let auditId = wait for add event to T8CI_Audit using db
  }
 }
 return changed
}
serve POST /api/records requiring role admin and database with createRecord
serve PATCH /api/records/:id requiring role admin and database with updateRecord
serve DELETE /api/records/:id requiring role admin and database with deleteRecord`;
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('Tier 8 authenticated SQLite business app',()=>{
 it('audits role-checked mutations, rejects invalid writes, and persists across restart',async()=>{
  const compiled=compile(`app TeamBoard
type Principal { id text role text }
enum JobState { scheduled in_progress done }
model Customer { name text required }
model TeamMember { authId text required unique role text required }
model Job { title text required customer Customer required assignedTo text required status JobState required createdAt text required }
model AuditEvent { action text required actor text required target text required targetId integer? createdAt integer required }
async function adminJobs(principal Principal, db capability<database>) -> task<list<Job>> {
 return wait for get items from Job using db
}
async function workerJobs(principal Principal, db capability<database>) -> task<list<Job>> {
 let assignedWorkerId = principal.id
 return wait for get items from Job where assignedTo is assignedWorkerId using db
}
async function viewerJobs(principal Principal, db capability<database>) -> task<list<Job>> {
 return wait for get items from Job using db
}
async function audit(principal Principal, db capability<database>) -> task<list<AuditEvent>> {
 return wait for get items from AuditEvent using db
}
async function createJob(principal Principal, db capability<database>, clock capability<time>, body Job) -> task<result<integer,text>> {
 let assigneeId = body.assignedTo
 let teamMembers = wait for get members from TeamMember where authId is assigneeId using db
 let eligibleWorkers = filter(teamMembers, lambda(member TeamMember) -> boolean { return member.role == "worker" })
 if length(eligibleWorkers) == 0 {
  return err("unknown_assignee")
 }
 var createdId integer = 0
 transaction using db {
  createdId = await databaseInsertId(db, "Job", body)
  let event = AuditEvent { action: "job_created", actor: principal.id, target: "Job", targetId: createdId, createdAt: currentTime(clock) }
  let auditId = wait for add event to AuditEvent using db
 }
 return ok(createdId)
}
async function updateAssigned(principal Principal, db capability<database>, clock capability<time>, id integer, body Job) -> task<integer> {
 let assignedWorkerId = principal.id
 var changed integer = 0
 transaction using db {
  changed = wait for update body in Job with id where assignedTo is assignedWorkerId using db
  if changed > 0 {
   let event = AuditEvent { action: "job_updated", actor: principal.id, target: "Job", targetId: id, createdAt: currentTime(clock) }
   let auditId = wait for add event to AuditEvent using db
  }
 }
 return changed
}
async function updateAdmin(principal Principal, db capability<database>, clock capability<time>, id integer, body Job) -> task<integer> {
 var changed integer = 0
 transaction using db {
  changed = wait for update body in Job with id using db
  if changed > 0 {
   let event = AuditEvent { action: "job_updated", actor: principal.id, target: "Job", targetId: id, createdAt: currentTime(clock) }
   let auditId = wait for add event to AuditEvent using db
  }
 }
 return changed
}
async function deleteJob(principal Principal, db capability<database>, clock capability<time>, id integer) -> task<integer> {
 var changed integer = 0
 transaction using db {
  changed = wait for delete id from Job using db
  if changed > 0 {
   let event = AuditEvent { action: "job_deleted", actor: principal.id, target: "Job", targetId: id, createdAt: currentTime(clock) }
   let auditId = wait for add event to AuditEvent using db
  }
 }
 return changed
}
serve GET /api/jobs requiring role admin and database with adminJobs
serve GET /api/jobs requiring role worker and database with workerJobs
serve GET /api/jobs requiring role viewer and database with viewerJobs
serve GET /api/audit requiring role admin and database with audit
http POST /api/jobs returns 200 errors 400 requires role admin, database, time -> createJob
serve PATCH /api/jobs/:id requiring role admin and database and time with updateAdmin
serve PATCH /api/jobs/:id requiring role worker and database and time with updateAssigned
serve DELETE /api/jobs/:id requiring role admin and database and time with deleteJob`);
  expect(compiled.diagnostics).toEqual([]);
  const root=mkdtempSync(join(tmpdir(),'bmec-tier8-business-app-'));roots.push(root);
  const databasePath=join(root,'team-board.sqlite');
  const users=[{id:'admin',password:'admin-pass-123',role:'admin'},{id:'worker',password:'worker-pass-123',role:'worker'},{id:'worker2',password:'worker2-pass-123',role:'worker'},{id:'viewer',password:'viewer-pass-123',role:'viewer'}];
  const start=()=>startRuntime(compiled.ir!,join(root,'generated'),databasePath,0,{authUsers:users,defaultPolicy:'none'});
  let handle=await start();handles.push(handle);
  handle.database.create('TeamMember',{authId:'worker',role:'worker'});
  handle.database.create('TeamMember',{authId:'worker2',role:'worker'});
  handle.database.create('TeamMember',{authId:'admin',role:'admin'});
  const customer=Number(handle.database.create('Customer',{name:'Northwind'}).id);
  const workerJob=Number(handle.database.create('Job',{title:'Worker job',customer,assignedTo:'worker',status:'scheduled',createdAt:'2026-09-25T00:00:00Z'}).id);
  const otherJob=Number(handle.database.create('Job',{title:'Other job',customer,assignedTo:'worker2',status:'scheduled',createdAt:'2026-09-25T00:00:00Z'}).id);
  const login=async(id:string,password:string)=>{const response=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,password})});expect(response.status).toBe(200);return response.headers.get('set-cookie')!.split(';',1)[0]!;};
  const admin=await login('admin','admin-pass-123'),worker=await login('worker','worker-pass-123'),viewer=await login('viewer','viewer-pass-123');
  expect(await (await fetch(`${handle.url}/api/jobs`,{headers:{cookie:worker}})).json()).toMatchObject([{title:'Worker job',assignedTo:'worker'}]);
  const deniedViewer=await fetch(`${handle.url}/api/jobs/${workerJob}`,{method:'DELETE',headers:{cookie:viewer}});
  expect(deniedViewer.status).toBe(403);
  const viewerUpdate=await fetch(`${handle.url}/api/jobs/${workerJob}`,{method:'PATCH',headers:{cookie:viewer,'content-type':'application/json'},body:JSON.stringify({title:'Viewer change',customer,assignedTo:'worker',status:'done',createdAt:'2026-09-25T00:00:00Z'})});
  expect(viewerUpdate.status).toBe(403);
  const spoof=await fetch(`${handle.url}/api/jobs/${otherJob}?role=worker`,{method:'PATCH',headers:{cookie:worker,'x-role':'admin','content-type':'application/json'},body:JSON.stringify({title:'Stolen',customer,assignedTo:'worker',status:'done',createdAt:'2026-09-25T00:00:00Z'})});
  expect(spoof.status).toBe(200);expect(await spoof.json()).toBe(0);
  const badStatus=await fetch(`${handle.url}/api/jobs/${workerJob}`,{method:'PATCH',headers:{cookie:worker,'content-type':'application/json'},body:JSON.stringify({title:'Bad status',customer,assignedTo:'worker',status:'cancelled',createdAt:'2026-09-25T00:00:00Z'})});
  expect(badStatus.status).toBe(400);expect(handle.database.get('Job',workerJob)).toMatchObject({title:'Worker job',status:'scheduled'});expect(handle.database.list('AuditEvent')).toHaveLength(0);
  const allowed=await fetch(`${handle.url}/api/jobs/${workerJob}`,{method:'PATCH',headers:{cookie:worker,'content-type':'application/json'},body:JSON.stringify({title:'Worker job updated',customer,assignedTo:'worker',status:'in_progress',createdAt:'2026-09-25T00:00:00Z'})});
  expect(allowed.status).toBe(200);expect(await allowed.json()).toBe(1);
  const adminUpdate=await fetch(`${handle.url}/api/jobs/${otherJob}`,{method:'PATCH',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify({title:'Admin changed other job',customer,assignedTo:'worker2',status:'done',createdAt:'2026-09-25T00:00:00Z'})});
  expect(adminUpdate.status).toBe(200);expect(await adminUpdate.json()).toBe(1);
  const created=await fetch(`${handle.url}/api/jobs`,{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify({title:'Admin job',customer,assignedTo:'worker2',status:'scheduled',createdAt:'2026-09-25T00:00:00Z'})});
  expect(created.status).toBe(200);expect(await created.json()).toEqual({state:'ok',value:3});
  const triggerClient=(handle.database as unknown as {db:InstanceType<typeof Database>}).db;
  const jobsBeforeAuditFailure=handle.database.list('Job').length,auditsBeforeAuditFailure=handle.database.list('AuditEvent').length;
  triggerClient.exec(`CREATE TRIGGER reject_tier8_audit BEFORE INSERT ON "pipe_AuditEvent" BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
  const failedAuditCreate=await fetch(`${handle.url}/api/jobs`,{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify({title:'Must roll back',customer,assignedTo:'worker2',status:'scheduled',createdAt:'2026-09-25T00:00:00Z'})});
  expect(failedAuditCreate.status).toBe(500);await failedAuditCreate.text();
  expect(handle.database.list('Job')).toHaveLength(jobsBeforeAuditFailure);expect(handle.database.list('AuditEvent')).toHaveLength(auditsBeforeAuditFailure);
  const failedAuditUpdate=await fetch(`${handle.url}/api/jobs/${otherJob}`,{method:'PATCH',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify({title:'Must roll back update',customer,assignedTo:'worker2',status:'scheduled',createdAt:'2026-09-25T00:00:00Z'})});
  expect(failedAuditUpdate.status).toBe(500);await failedAuditUpdate.text();
  expect(handle.database.get('Job',otherJob)).toMatchObject({title:'Admin changed other job',status:'done'});expect(handle.database.list('AuditEvent')).toHaveLength(auditsBeforeAuditFailure);
  const failedAuditDelete=await fetch(`${handle.url}/api/jobs/${otherJob}`,{method:'DELETE',headers:{cookie:admin}});
  expect(failedAuditDelete.status).toBe(500);await failedAuditDelete.text();
  expect(handle.database.get('Job',otherJob)).toMatchObject({title:'Admin changed other job'});expect(handle.database.list('AuditEvent')).toHaveLength(auditsBeforeAuditFailure);
  triggerClient.exec('DROP TRIGGER reject_tier8_audit');
  const beforeInvalidAssignee=handle.database.list('Job').length;
  for(const assignedTo of ['missing-worker','admin']){
   const invalidAssignee=await fetch(`${handle.url}/api/jobs`,{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify({title:'Invalid assignee',customer,assignedTo,status:'scheduled',createdAt:'2026-09-25T00:00:00Z'})});
   expect(invalidAssignee.status).toBe(400);expect(await invalidAssignee.json()).toEqual({state:'err',error:'unknown_assignee'});
   expect(handle.database.list('Job')).toHaveLength(beforeInvalidAssignee);
   expect(handle.database.list('AuditEvent')).toHaveLength(3);
  }
  const deleted=await fetch(`${handle.url}/api/jobs/${otherJob}`,{method:'DELETE',headers:{cookie:admin}});
  expect(deleted.status).toBe(200);expect(await deleted.json()).toBe(1);
  const auditResponse=await fetch(`${handle.url}/api/audit`,{headers:{cookie:admin}});
  expect(auditResponse.status).toBe(200);expect((await auditResponse.json()).map((event:{action:string;actor:string})=>`${event.action}:${event.actor}`).sort()).toEqual(['job_created:admin','job_deleted:admin','job_updated:admin','job_updated:worker']);
  expect(handle.database.list('AuditEvent').every(event=>event.targetId===workerJob||event.targetId===otherJob||event.targetId===3)).toBe(true);
  expect(handle.database.list('AuditEvent').find(event=>event.action==='job_updated'&&event.actor==='worker')?.targetId).toBe(workerJob);
  expect(handle.database.list('AuditEvent').find(event=>event.action==='job_updated'&&event.actor==='admin')?.targetId).toBe(otherJob);
  expect(handle.database.list('AuditEvent').find(event=>event.action==='job_deleted')?.targetId).toBe(otherJob);
  expect(handle.database.list('AuditEvent').find(event=>event.action==='job_created')?.targetId).toBe(3);
  expect((await fetch(`${handle.url}/api/audit`,{headers:{cookie:viewer}})).status).toBe(403);
  await handle.close();handles.splice(handles.indexOf(handle),1);
  handle=await start();handles.push(handle);
  const adminAfterRestart=await login('admin','admin-pass-123');
  expect(await (await fetch(`${handle.url}/api/jobs`,{headers:{cookie:adminAfterRestart}})).json()).toMatchObject([{title:'Worker job updated',status:{type:'JobState',variant:'in_progress'}},{title:'Admin job'}]);
  expect(await (await fetch(`${handle.url}/api/audit`,{headers:{cookie:adminAfterRestart}})).json()).toHaveLength(4);
 });
});

describe('Tier 8 PostgreSQL transaction parity',()=>{
 it('compiles the PostgreSQL transaction fixture',()=>{
  const compiled=compile(postgresFixtureSource);
  expect(compiled.diagnostics).toEqual([]);
 });
 maybePostgres('rolls back an authenticated business mutation when its audit insert fails',async()=>{
  const compiled=compile(postgresFixtureSource);
  const pool=new Pool({connectionString:postgresConnection});
  const handleRoot=mkdtempSync(join(tmpdir(),'bmec-tier8-postgres-'));roots.push(handleRoot);
  try {
   await pool.query('DROP TABLE IF EXISTS "T8CI_Audit", "T8CI_Record" CASCADE');
   await pool.query('CREATE TABLE "T8CI_Record" ("id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,"title" text NOT NULL)');
   await pool.query('CREATE TABLE "T8CI_Audit" ("id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,"action" text NOT NULL,"actor" text NOT NULL,"targetId" bigint)');
   const handle=await startRuntime(compiled.ir!,join(handleRoot,'generated'),join(handleRoot,'unused.sqlite'),0,{postgresUrl:postgresConnection,authUsers:[{id:'admin',password:'admin-pass-123',role:'admin'}],defaultPolicy:'none'});handles.push(handle);
   const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin-pass-123'})});
   expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';',1)[0]!;
   const created=await fetch(`${handle.url}/api/records`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({title:'Committed'})});
   expect(created.status).toBe(200);expect(await created.json()).toBe(1);
   await pool.query(`CREATE FUNCTION reject_t8ci_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$`);
   await pool.query('CREATE TRIGGER reject_t8ci_audit BEFORE INSERT ON "T8CI_Audit" FOR EACH ROW EXECUTE FUNCTION reject_t8ci_audit()');
   const rejected=await fetch(`${handle.url}/api/records`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({title:'Must roll back'})});
   expect(rejected.status).toBe(500);await rejected.text();
   const failedUpdate=await fetch(`${handle.url}/api/records/1`,{method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({title:'Must roll back update'})});
   expect(failedUpdate.status).toBe(500);await failedUpdate.text();
   const failedDelete=await fetch(`${handle.url}/api/records/1`,{method:'DELETE',headers:{cookie}});
   expect(failedDelete.status).toBe(500);await failedDelete.text();
   expect((await pool.query('SELECT "title" FROM "T8CI_Record" ORDER BY "id"')).rows).toEqual([{title:'Committed'}]);
   expect((await pool.query('SELECT "action", "targetId" FROM "T8CI_Audit"')).rows).toEqual([{action:'created',targetId:'1'}]);
  } finally {
   await pool.query('DROP TABLE IF EXISTS "T8CI_Audit", "T8CI_Record" CASCADE');
   await pool.query('DROP FUNCTION IF EXISTS reject_t8ci_audit()');
   await pool.end();
  }
 });
});
