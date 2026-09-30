import {describe,expect,it} from 'vitest';
import {mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {compile} from '../src/compiler.js';import {PipeDatabase} from '../src/runtime/database.js';
import {executeAsyncValue} from '../src/core/interpreter.js';
import {ensureSqliteSchema} from '../src/db/sqlite.js';
import {sqliteAdapter} from '../src/db/adapter.js';
import {issueCapability} from '../src/runtime/capabilities.js';
describe('PIPE explicit transactions',()=>{it('commits and rolls back atomically',()=>{const ir=compile('model Item { value text }').ir!;const db=new PipeDatabase(ir,join(mkdtempSync(join(tmpdir(),'pipe-tx-')),'data.db'));db.transaction(tx=>{tx.create('Item',{value:'ok'})});expect(db.list('Item')).toHaveLength(1);expect(()=>db.transaction(tx=>{tx.create('Item',{value:'rollback'});throw new Error('abort')})).toThrow('abort');expect(db.list('Item')).toHaveLength(1);db.close();});});

describe('BMEC source transaction blocks',()=>{
 it('does not consume the next assignment after a record initializer',async()=>{
  const source=`model Item { name text required unique }
type Receipt { itemId integer }
async function checkout(db capability<database>, name text) -> task<result<Receipt,text>> {
  var itemId integer = 0
  transaction using db {
    let item = Item { name: name }
    itemId = await add item to Item using db
  }
  return ok(Receipt { itemId: itemId })
}`;
  const compiled=compile(source);expect(compiled.diagnostics).toEqual([]);
  const client=new Database(':memory:');
  try{
   ensureSqliteSchema(client,compiled.ir!.db!);
   const database={adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!};
   const result=await executeAsyncValue(compiled.ir!.functions,'checkout',[issueCapability('database'),'book'],{database});
   expect(result).toMatchObject({state:'ok'});
   expect((result as any).payload.fields.get('itemId')).toBe(1n);
   expect(client.prepare('SELECT name FROM "Item"').all()).toEqual([{name:'book'}]);
  }finally{client.close()}
 });

 it('commits awaited writes and rolls back the whole block on a database failure',async()=>{
  const source=`model Item { name text required unique }
async function insertPair(db capability<database>, first Item, second Item) -> task<result<integer,text>> {
  var firstId integer = 0
  transaction using db {
    firstId = await add first to Item using db
    let secondId = await add second to Item using db
  }
  return ok(firstId)
}`;
  const compiled=compile(source);expect(compiled.diagnostics).toEqual([]);
  const client=new Database(':memory:');
  try{
   ensureSqliteSchema(client,compiled.ir!.db!);
   const database={adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!};
   const token=issueCapability('database');
   await expect(executeAsyncValue(compiled.ir!.functions,'insertPair',[token,{name:'one'},{name:'two'}],{database})).resolves.toMatchObject({state:'ok',payload:1n});
   expect(client.prepare('SELECT name FROM "Item" ORDER BY id').all()).toEqual([{name:'one'},{name:'two'}]);
   await expect(executeAsyncValue(compiled.ir!.functions,'insertPair',[token,{name:'duplicate'},{name:'duplicate'}],{database})).rejects.toThrow();
   expect(client.prepare('SELECT name FROM "Item" ORDER BY id').all()).toEqual([{name:'one'},{name:'two'}]);
  }finally{client.close()}
 });

 it('keeps a job write and its audit write atomic',async()=>{
  const source=`model Job { title text required }
model AuditEvent { action text required }
async function createJob(db capability<database>, job Job, event AuditEvent) -> task<integer> {
  var jobId integer = 0
  transaction using db {
    jobId = await add job to Job using db
    let auditId = await add event to AuditEvent using db
  }
  return jobId
}`;
  const compiled=compile(source);expect(compiled.diagnostics).toEqual([]);
  const client=new Database(':memory:');
  try{
   ensureSqliteSchema(client,compiled.ir!.db!);
   client.exec(`CREATE TRIGGER reject_audit BEFORE INSERT ON "AuditEvent" BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
   const database={adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!};
   const token=issueCapability('database'),args=[token,{title:'job'},{action:'create'}];
   await expect(executeAsyncValue(compiled.ir!.functions,'createJob',args,{database})).rejects.toThrow();
   expect(client.prepare('SELECT count(*) AS count FROM "Job"').get()).toEqual({count:0});
   expect(client.prepare('SELECT count(*) AS count FROM "AuditEvent"').get()).toEqual({count:0});
   client.exec('DROP TRIGGER reject_audit');
   await expect(executeAsyncValue(compiled.ir!.functions,'createJob',args,{database})).resolves.toBe(1n);
   expect(client.prepare('SELECT count(*) AS count FROM "Job"').get()).toEqual({count:1});
   expect(client.prepare('SELECT count(*) AS count FROM "AuditEvent"').get()).toEqual({count:1});
  }finally{client.close()}
 });

 it('rejects synchronous and nested transactions and rolls back on an early return',async()=>{
  const synchronous=compile('model Item { name text } function write(db capability<database>) -> integer { transaction using db { } return 1 }');
  expect(synchronous.diagnostics.map(item=>item.code)).toContain('PIPE-ASYNC-003');
  const nested=compile('async function write(db capability<database>) -> task<integer> { transaction using db { transaction using db { } } return 1 }');
  expect(nested.diagnostics.map(item=>item.code)).toContain('PIPE-DB-006');
  const earlyReturn=compile(`model Item { name text required unique }
async function write(db capability<database>) -> task<result<integer,text>> {
  transaction using db {
    let item = Item { name: "rolled" }
    let inserted = await add item to Item using db
    return err("aborted")
  }
  return ok(1)
}`);
  expect(earlyReturn.diagnostics).toEqual([]);
  const client=new Database(':memory:');
  try{
   ensureSqliteSchema(client,earlyReturn.ir!.db!);
   const database={adapter:sqliteAdapter(client,earlyReturn.ir!.db!),schema:earlyReturn.ir!.db!};
   await expect(executeAsyncValue(earlyReturn.ir!.functions,'write',[issueCapability('database')],{database})).resolves.toMatchObject({state:'err',payload:'aborted'});
   expect(client.prepare('SELECT count(*) AS count FROM "Item"').get()).toEqual({count:0});
  }finally{client.close()}
 });
});
