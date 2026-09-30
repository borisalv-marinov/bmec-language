import {describe,expect,it} from 'vitest';
import {dbSchemaFromProjectModels,validateDbSchema,validateDbOperationAgainstSchema,type DbSchema} from '../src/db/ir.js';
import {modelType,primitive} from '../src/types/type-ref.js';
import {compile} from '../src/compiler.js';
import {validateSerializedIR} from '../src/ir/validate.js';
import Database from 'better-sqlite3';
import {ensureSqliteSchema} from '../src/db/sqlite.js';

describe('backend-neutral database schema IR',()=>{
  const userId=modelType('User','DB-USER');
  const schema:DbSchema={version:1,models:[
    {id:'DB-USER',name:'User',fields:[{id:'F-USER-ID',name:'id',type:primitive('id'),primaryKey:true},{id:'F-USER-EMAIL',name:'email',type:primitive('text'),unique:true}]},
    {id:'DB-TASK',name:'Task',fields:[{id:'F-TASK-ID',name:'id',type:primitive('id'),primaryKey:true},{id:'F-TASK-OWNER',name:'owner',type:userId}],uniqueConstraints:[['owner','id']],foreignKeys:[{field:'owner',references:{modelId:'DB-USER',field:'id'}}]}
  ]};
  it('accepts canonical TypeRefs and primary, unique, and foreign-key constraints',()=>expect(validateDbSchema(schema)).toEqual([]));
  it('rejects duplicate fields, unknown references, and mismatched foreign-key types',()=>{
    const broken:DbSchema={version:1,models:[
      {id:'DB-A',name:'A',fields:[{id:'F-1',name:'id',type:primitive('id'),primaryKey:true},{id:'F-2',name:'id',type:primitive('text')}],foreignKeys:[{field:'id',references:{modelId:'DB-MISSING',field:'id'}}]},
      {id:'DB-B',name:'B',fields:[{id:'F-3',name:'id',type:primitive('id'),primaryKey:true},{id:'F-4',name:'owner',type:primitive('text')}],foreignKeys:[{field:'owner',references:{modelId:'DB-B',field:'id'}}]}
    ]};
    const errors=validateDbSchema(broken);
    expect(errors).toEqual(expect.arrayContaining([
      'Invalid database field "id" in "A"',
      'Database foreign key references unknown model "DB-MISSING"',
      'Database foreign key types differ for "B.owner" and "B.id"'
    ]));
  });
  it('derives a typed schema from ProjectIR model fields without replacing TypeRefs',()=>{
    const result=dbSchemaFromProjectModels([{id:'DB-1',name:'Item',fields:[{id:'F-1',name:'id',type:'id',typeRef:primitive('id'),required:true}]}]);
    expect(result.models[0]!.fields[0]).toMatchObject({id:'F-1',name:'id',type:primitive('id'),primaryKey:true});
  });
  it('derives required and optional model relationships as SQLite foreign keys',()=>{
    const result=compile('app Store\nmodel Region { name text required }\nmodel ExplorerRecord { region Region required backupRegion Region? }');
    expect(result.diagnostics).toEqual([]);
    const region=result.ir!.db!.models.find(model=>model.name==='Region')!;
    const record=result.ir!.db!.models.find(model=>model.name==='ExplorerRecord')!;
    expect(record.foreignKeys).toEqual([{field:'region',references:{modelId:region.id,field:'id'}},{field:'backupRegion',references:{modelId:region.id,field:'id'}}]);
    const client=new Database(':memory:');
    ensureSqliteSchema(client,result.ir!.db!);
    client.prepare('INSERT INTO "Region" (id,name) VALUES (?,?)').run(1,'North');
    expect(()=>client.prepare('INSERT INTO "ExplorerRecord" (region,backupRegion) VALUES (?,?)').run(99,null)).toThrow();
    client.prepare('INSERT INTO "ExplorerRecord" (region,backupRegion) VALUES (?,?)').run(1,null);
    client.close();
  });
  it('compiles declared composite indexes into the canonical schema and creates them in SQLite',()=>{
    const result=compile('app Store\nmodel Task { status text required createdAt datetime required }\nindex task_status_created on Task by status, createdAt');
    expect(result.diagnostics).toEqual([]);
    const indexes=result.ir!.db!.models[0]!.indexes;
    expect(indexes).toEqual([{name:'task_status_created',fields:['status','createdAt']}]);
    const client=new Database(':memory:');ensureSqliteSchema(client,result.ir!.db!);
    const columns=(client.prepare('PRAGMA index_info("task_status_created")').all() as Array<{name:string}>).map(row=>row.name);
    expect(columns).toEqual(['status','createdAt']);client.close();
  });
  it('rejects index declarations with unknown fields and duplicate names',()=>{
    const result=compile('app Store\nmodel Task { status text }\nindex by_status on Task by status\nindex by_status on Task by missing');
    expect(result.diagnostics.map(item=>item.kind)).toEqual(expect.arrayContaining(['duplicate_index_name','unknown_index_field']));
  });
  it('embeds the validated schema in compiled ProjectIR and rejects malformed serialized schema',()=>{
    const result=compile('app Store\nmodel Item { sku text required }');
    expect(result.diagnostics).toEqual([]);
    expect(validateDbSchema(result.ir!.db!)).toEqual([]);
    expect(result.ir!.db!.models[0]!.fields[0]).toMatchObject({name:'id',primaryKey:true,required:true,type:{kind:'primitive',name:'integer'}});
    const serialized=JSON.parse(JSON.stringify(result.ir));
    serialized.db.models[0].fields[0].type={kind:'invalid'};
    expect(validateSerializedIR(serialized).errors.some(error=>error.startsWith('IR db:'))).toBe(true);
  });
  it('requires canonical model identity and validates operation fields from schema TypeRefs',()=>{
    const valid=validateDbOperationAgainstSchema({kind:'select',model:'Task',modelId:'DB-TASK',fields:['owner'],where:{kind:'compare',field:'owner',operator:'=',value:userId},orderBy:{field:'id'},limit:10},schema);
    expect(valid).toEqual([]);
    expect(validateDbOperationAgainstSchema({kind:'select',model:'Task',fields:['owner']},schema)).toContain('Database operation requires a canonical modelId');
    expect(validateDbOperationAgainstSchema({kind:'update',model:'Task',modelId:'DB-TASK',values:{owner:primitive('text')}},schema)).toContain('Database value for "owner" has an incompatible type');
  });
  it('returns diagnostics rather than throwing for malformed constraint containers',()=>{
    const malformed={version:1,models:[{id:'DB-X',name:'X',fields:[{id:'F-X',name:'id',type:primitive('integer')}],uniqueConstraints:{bad:true},foreignKeys:{bad:true}}]} as unknown as DbSchema;
    expect(()=>validateDbSchema(malformed)).not.toThrow();
    expect(validateDbSchema(malformed)).toEqual(expect.arrayContaining(['Invalid database unique constraints on "X"','Invalid database foreign keys on "X"']));
  });
});
