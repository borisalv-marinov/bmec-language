import {afterEach,describe,expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import {copyFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';
import {installGracefulShutdown} from '../src/runtime/operations.js';
import type {HttpLogEvent} from '../src/http/node-adapter.js';

const source='app Operations\nmodel Task { title text required }';
const handles:RuntimeHandle[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close()});
async function boot(dbFile:string,logger?:(event:HttpLogEvent)=>void){
 const result=compile(source);expect(result.diagnostics).toEqual([]);
 const root=mkdtempSync(join(tmpdir(),'bmec-ops-'));
 const handle=await startRuntime(result.ir!,join(root,'generated'),dbFile,0,{logger});
 handles.push(handle);return handle;
}

describe('production operations surface',()=>{
 it('serves liveness and readiness with request IDs and safe JSON request events',async()=>{
  const events:any[]=[];const root=mkdtempSync(join(tmpdir(),'bmec-ops-db-'));
  const handle=await boot(join(root,'app.db'),event=>events.push(event));
  const live=await fetch(`${handle.url}/healthz`),ready=await fetch(`${handle.url}/readyz`);
  expect(live.status).toBe(200);expect(await live.json()).toEqual({status:'ok'});
  expect(ready.status).toBe(200);expect(ready.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  expect(events[0].requestId).toBe(live.headers.get('x-request-id'));expect(events[1].requestId).toBe(ready.headers.get('x-request-id'));
  const secret='a'.repeat(40);await fetch(`${handle.url}/missing/${secret}?token=private`);
  expect(events.map(event=>event.path)).toEqual(['/healthz','/readyz','/missing/:redacted']);
  expect(JSON.stringify(events)).not.toContain(secret);expect(JSON.stringify(events)).not.toContain('private');
 });

 it('rejects invalid ports before starting a listener',async()=>{
  const result=compile(source);expect(result.ir).toBeDefined();
  await expect(startRuntime(result.ir!,join(tmpdir(),'bmec-invalid-port'),join(tmpdir(),'unused.db'),70000)).rejects.toThrow('PIPE-NET-009');
 });

 it('rejects production mode without a trusted browser origin',async()=>{
  const result=compile(source);expect(result.ir).toBeDefined();
  await expect(startRuntime(result.ir!,join(tmpdir(),'bmec-invalid-origin'),join(tmpdir(),'unused.db'),0,{securityMode:'production'})).rejects.toThrow('PIPE-AUTH-008');
 });

 it('fails promptly and releases resources when PostgreSQL is unavailable',async()=>{
  const result=compile(source);expect(result.ir).toBeDefined();
  const postgresUrl='postgres://bmec:placeholder@127.0.0.1:1/bmec?connection_timeout=1000';
  await expect(startRuntime(result.ir!,join(tmpdir(),'bmec-unavailable-pg'),join(tmpdir(),'unused.db'),0,{securityMode:'production',allowedOrigins:['https://app.example.test'],postgresUrl})).rejects.toThrow();
 });

 it('handles shutdown signals once and removes listeners after draining',async()=>{
  const signals=new EventEmitter();let closes=0;
  const remove=installGracefulShutdown({close:async()=>{closes++}},signals as never);
  signals.emit('SIGTERM');signals.emit('SIGINT');
  await new Promise(resolve=>setImmediate(resolve));
  expect(closes).toBe(1);expect(signals.listenerCount('SIGTERM')).toBe(0);expect(signals.listenerCount('SIGINT')).toBe(0);
  remove();
 });

 it('stops the real HTTP listener after a shutdown signal',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-ops-signal-')),handle=await boot(join(root,'app.db'));
  const signals=new EventEmitter();let closed=false;
  const stopped=new Promise<void>(resolve=>installGracefulShutdown({close:async()=>{await handle.close();closed=true;resolve()}},signals as never));
  signals.emit('SIGTERM');signals.emit('SIGINT');await stopped;
  expect(closed).toBe(true);await expect(fetch(`${handle.url}/healthz`)).rejects.toThrow();
 });

 it('preserves application data through SQLite backup, restore, and runtime restart',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-ops-restart-')),dbFile=join(root,'app.db'),backup=join(root,'backup.db');
  let handle=await boot(dbFile);
  const created=await fetch(`${handle.url}/api/Task`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Persisted'})});
  expect(created.status).toBe(201);await handle.close();handles.splice(handles.indexOf(handle),1);
  const liveDb=new Database(dbFile);await liveDb.backup(backup);liveDb.close();
  const restored=new Database(backup);expect(restored.pragma('integrity_check')).toEqual([{integrity_check:'ok'}]);restored.close();
  copyFileSync(backup,dbFile);
  handle=await boot(dbFile);
  const rows=await (await fetch(`${handle.url}/api/Task`)).json();expect(rows).toEqual([{id:1,title:'Persisted'}]);
 });
});
