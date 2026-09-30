import {isSameType,type TypeRef} from '../types/type-ref.js';
import {validateDbSchema,type DbSchema} from './ir.js';
import {planDbSchemaMigration,requireDbSchemaMigrationReview,type DbSchemaMigrationPlan} from './migrations.js';
import type {SqliteClient} from './adapter.js';

const q=(value:string)=>`"${value.replace(/"/g,'""')}"`;
const scalar=(type:TypeRef):string=>{
  const value=type.kind==='optional'?type.inner:type;
  if(value.kind==='primitive')return value.name==='number'?'REAL':value.name==='integer'||value.name==='boolean'||value.name==='money'?'INTEGER':'TEXT';
  if(value.kind==='model')return 'INTEGER';
  if(value.kind==='enum')return 'TEXT';
  throw new Error(`PIPE-DB-IR-002: unsupported SQLite field type "${value.kind}"`);
};
const literal=(value:unknown):string=>{
  if(value===null)return 'NULL';
  if(typeof value==='boolean')return value?'1':'0';
  if(typeof value==='number'&&Number.isFinite(value))return String(value);
  if(typeof value==='bigint')return value.toString();
  if(typeof value==='string')return `'${value.replace(/'/g,"''")}'`;
  throw new Error('PIPE-DB-IR-002: SQLite default must be a scalar literal');
};

/** Lower a validated BMEC DB schema to SQLite DDL; SQLite remains the engine. */
export function ensureSqliteSchema(client:SqliteClient,schema:DbSchema):void{
  if(!client.exec)throw new Error('PIPE-DB-IR-003: SQLite client must expose exec for schema creation');
  const errors=validateDbSchema(schema);if(errors.length)throw new Error(`PIPE-DB-IR-001: ${errors.join('; ')}`);
  client.exec('PRAGMA foreign_keys = ON');
  for(const model of schema.models){
    const primary=model.fields.find(field=>field.primaryKey);
    const columns=model.fields.map(field=>{let sql=`${q(field.name)} ${scalar(field.type)}`;if(field.primaryKey)sql+=' PRIMARY KEY';if(field.required)sql+=' NOT NULL';if(field.unique)sql+=' UNIQUE';if(field.default!==undefined)sql+=` DEFAULT ${literal(field.default)}`;return sql});
    for(const unique of model.uniqueConstraints??[])columns.push(`UNIQUE (${unique.map(q).join(', ')})`);
    for(const foreign of model.foreignKeys??[]){const target=schema.models.find(candidate=>candidate.id===foreign.references.modelId)!;const remote=target.fields.find(field=>field.name===foreign.references.field)!;const local=model.fields.find(field=>field.name===foreign.field)!;const localType=local.type.kind==='optional'?local.type.inner:local.type;if(localType.kind!=='model'&&!isSameType(localType,remote.type))throw new Error(`PIPE-DB-IR-002: foreign-key type mismatch for ${model.name}.${local.name}`);columns.push(`FOREIGN KEY (${q(local.name)}) REFERENCES ${q(target.name)} (${q(remote.name)})`);}
    if(!primary&&model.fields.every(field=>!field.primaryKey)){
      // SQLite permits a table without a declared primary key; BMEC schema validation remains authoritative.
    }
    client.exec(`CREATE TABLE IF NOT EXISTS ${q(model.name)} (${columns.join(', ')})`);
    for(const index of model.indexes??[])client.exec(`CREATE INDEX IF NOT EXISTS ${q(index.name)} ON ${q(model.name)} (${index.fields.map(q).join(', ')})`);
  }
}

/** Apply only migration changes with a safe SQLite ALTER TABLE representation. */
export function migrateSqliteSchema(client:SqliteClient,previous:DbSchema,current:DbSchema,reviewed=false):DbSchemaMigrationPlan{
  const exec=client.exec?.bind(client);if(!exec)throw new Error('PIPE-DB-IR-003: SQLite client must expose exec for schema migration');
  const plan=planDbSchemaMigration(previous,current);requireDbSchemaMigrationReview(plan,reviewed);
  const safe=plan.changes.every(change=>change.kind==='add_model'||change.kind==='add_index'||change.kind==='add_field'&&!change.destructive);
  if(!safe)throw new Error('PIPE-DB-IR-004: reviewed destructive database migrations require an explicit SQLite rebuild adapter');
  const apply=()=>{for(const change of plan.changes){if(change.kind!=='add_field')continue;const model=current.models.find(candidate=>candidate.id===change.modelId)!;const field=model.fields.find(candidate=>candidate.id===change.fieldId)!;let sql=`ALTER TABLE ${q(model.name)} ADD COLUMN ${q(field.name)} ${scalar(field.type)}`;if(field.required)sql+=' NOT NULL';if(field.default!==undefined)sql+=` DEFAULT ${literal(field.default)}`;exec(sql);}ensureSqliteSchema(client,current);};
  if(typeof client.transaction==='function')client.transaction(apply)();else apply();
  return plan;
}
