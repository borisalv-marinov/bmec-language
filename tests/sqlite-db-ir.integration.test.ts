import {describe,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {sqliteAdapter} from '../src/db/adapter.js';
import {type DbSchema} from '../src/db/ir.js';
import {primitive} from '../src/types/type-ref.js';
import {ensureSqliteSchema,migrateSqliteSchema} from '../src/db/sqlite.js';

describe('real SQLite execution of backend-neutral DB IR',()=>{
  it('lowers schema constraints into real SQLite tables',()=>{
    const client=new Database(':memory:');
    const schema:DbSchema={version:1,models:[
      {id:'DB-USER',name:'User',fields:[{id:'U-ID',name:'id',type:primitive('integer'),primaryKey:true},{id:'U-EMAIL',name:'email',type:primitive('text'),unique:true,required:true}]},
      {id:'DB-TASK',name:'Task',fields:[{id:'T-ID',name:'id',type:primitive('integer'),primaryKey:true},{id:'T-OWNER',name:'owner',type:{kind:'model',name:'User',symbol:'DB-USER'},required:true}],foreignKeys:[{field:'owner',references:{modelId:'DB-USER',field:'id'}}]}
    ]};
    ensureSqliteSchema(client,schema);
    client.prepare('INSERT INTO "User" (id,email) VALUES (?,?)').run(1,'ada@example.test');
    client.prepare('INSERT INTO "Task" (id,owner) VALUES (?,?)').run(1,1);
    expect(()=>client.prepare('INSERT INTO "User" (id,email) VALUES (?,?)').run(2,'ada@example.test')).toThrow();
    expect(()=>client.prepare('INSERT INTO "Task" (id,owner) VALUES (?,?)').run(2,99)).toThrow();
    client.close();
  });
  it('executes parameterized insert/select/update/delete operations',async()=>{
    const client=new Database(':memory:');
    client.exec('CREATE TABLE "Item" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "qty" INTEGER NOT NULL)');
    const schema:DbSchema={version:1,models:[{id:'DB-ITEM',name:'Item',fields:[{id:'F-ID',name:'id',type:primitive('integer'),primaryKey:true},{id:'F-NAME',name:'name',type:primitive('text'),required:true},{id:'F-QTY',name:'qty',type:primitive('integer'),required:true}]}]};
    const db=sqliteAdapter(client,schema);
    await db.execute({kind:'insert',model:'Item',modelId:'DB-ITEM',values:{id:primitive('integer'),name:primitive('text'),qty:primitive('integer')}},[1,'Ada',2]);
    await expect(db.execute({kind:'select',model:'Item',modelId:'DB-ITEM',fields:['id','name','qty'],where:{kind:'compare',field:'id',operator:'=',value:primitive('integer')}},[1])).resolves.toMatchObject({rows:[{id:1,name:'Ada',qty:2}],rowCount:1});
    await db.execute({kind:'update',model:'Item',modelId:'DB-ITEM',values:{name:primitive('text'),qty:primitive('integer')},where:{kind:'compare',field:'id',operator:'=',value:primitive('integer')}},['Grace',3,1]);
    await expect(db.execute({kind:'select',model:'Item',modelId:'DB-ITEM',where:{kind:'compare',field:'id',operator:'=',value:primitive('integer')}},[1])).resolves.toMatchObject({rows:[{id:1,name:'Grace',qty:3}],rowCount:1});
    await db.execute({kind:'delete',model:'Item',modelId:'DB-ITEM',where:{kind:'compare',field:'id',operator:'=',value:primitive('integer')}},[1]);
    await expect(db.execute({kind:'select',model:'Item',modelId:'DB-ITEM'})).resolves.toMatchObject({rows:[],rowCount:0});
    client.close();
  });
  it('keeps runtime values out of SQL text',async()=>{
    const client=new Database(':memory:');client.exec('CREATE TABLE "Item" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)');
    const schema:DbSchema={version:1,models:[{id:'DB-ITEM',name:'Item',fields:[{id:'F-ID',name:'id',type:primitive('integer'),primaryKey:true},{id:'F-NAME',name:'name',type:primitive('text')}]}]};
    const db=sqliteAdapter(client,schema);const attack="x'); DROP TABLE Item; --";
    await db.execute({kind:'insert',model:'Item',modelId:'DB-ITEM',values:{id:primitive('integer'),name:primitive('text')}},[1,attack]);
    const row=await db.execute({kind:'select',model:'Item',modelId:'DB-ITEM',where:{kind:'compare',field:'name',operator:'=',value:primitive('text')}},[attack]);
    expect(row.rows).toHaveLength(1);expect(client.prepare('SELECT count(*) AS n FROM "Item"').get()).toEqual({n:1});client.close();
  });
  it('commits and rolls back async DB IR transactions atomically',async()=>{
    const client=new Database(':memory:');client.exec('CREATE TABLE "Item" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)');
    const schema:DbSchema={version:1,models:[{id:'DB-ITEM',name:'Item',fields:[{id:'F-ID',name:'id',type:primitive('integer'),primaryKey:true},{id:'F-NAME',name:'name',type:primitive('text')}]}]};
    const db=sqliteAdapter(client,schema);const insert={kind:'insert' as const,model:'Item',modelId:'DB-ITEM',values:{id:primitive('integer'),name:primitive('text')}};
    await db.transaction(async tx=>{await tx.execute(insert,[1,'committed']);});
    await expect(db.transaction(async tx=>{await tx.execute(insert,[2,'rolled-back']);throw new Error('abort');})).rejects.toThrow('abort');
    expect(client.prepare('SELECT id, name FROM "Item" ORDER BY id').all()).toEqual([{id:1,name:'committed'}]);client.close();
  });
  it('keeps unrelated SQLite operations outside an awaited transaction',async()=>{
    const client=new Database(':memory:');client.exec('CREATE TABLE "Item" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)');
    const schema:DbSchema={version:1,models:[{id:'DB-ITEM',name:'Item',fields:[{id:'F-ID',name:'id',type:primitive('integer'),primaryKey:true},{id:'F-NAME',name:'name',type:primitive('text')}]}]};
    const db=sqliteAdapter(client,schema),insert={kind:'insert' as const,model:'Item',modelId:'DB-ITEM',values:{id:primitive('integer'),name:primitive('text')}};
    let signalEntered!:()=>void,releaseTransaction!:()=>void;
    const entered=new Promise<void>(resolve=>{signalEntered=resolve}),block=new Promise<void>(resolve=>{releaseTransaction=resolve});
    try{
      const transaction=db.transaction(async tx=>{await tx.execute(insert,[1,'transaction-start']);signalEntered();await block;await tx.execute(insert,[2,'transaction-end']);});
      await entered;
      let outsideCompleted=false;
      const outside=db.execute(insert,[3,'outside-request']).then(()=>{outsideCompleted=true});
      await new Promise(resolve=>setTimeout(resolve,10));
      expect(outsideCompleted).toBe(false);
      releaseTransaction();
      await Promise.all([transaction,outside]);
      expect(client.prepare('SELECT id, name FROM "Item" ORDER BY id').all()).toEqual([
        {id:1,name:'transaction-start'},{id:2,name:'transaction-end'},{id:3,name:'outside-request'},
      ]);
      await expect(db.transaction(async tx=>tx.transaction(async()=>undefined))).rejects.toThrow('PIPE-DB-008');
    }finally{releaseTransaction();client.close()}
  });
  it('executes safe canonical schema migrations and refuses unsafe rewrites',()=>{
    const client=new Database(':memory:');
    const previous:DbSchema={version:1,models:[{id:'DB-ITEM',name:'Item',fields:[{id:'F-ID',name:'id',type:primitive('integer'),primaryKey:true}]}]};
    const current:DbSchema={version:1,models:[{...previous.models[0]!,fields:[...previous.models[0]!.fields,{id:'F-NAME',name:'name',type:primitive('text')}]}]};
    migrateSqliteSchema(client,{version:1,models:[]},previous);client.prepare('INSERT INTO "Item" (id) VALUES (?)').run(1);const plan=migrateSqliteSchema(client,previous,current);expect(plan.requiresReview).toBe(false);expect(client.prepare('PRAGMA table_info("Item")').all().map((row:{name:string})=>row.name)).toContain('name');expect(client.prepare('SELECT id FROM "Item"').get()).toEqual({id:1});
    const unsafe:DbSchema={version:1,models:[{...current.models[0]!,fields:current.models[0]!.fields.map(field=>field.name==='name'?{...field,type:primitive('integer')}:field)}]};
    expect(()=>migrateSqliteSchema(client,current,unsafe)).toThrow('PIPE-MIG-002');client.close();
  });
});
