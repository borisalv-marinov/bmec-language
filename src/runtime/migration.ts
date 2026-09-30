import type Database from 'better-sqlite3';
import type {ProjectIR} from '../ir/ir.js';
import {validateDbSchema} from '../db/ir.js';

export class MigrationError extends Error { code='PIPE-MIG-001'; kind='unsafe_schema_change'; model?:string; field?:string; from?:string; to?:string; constructor(message:string,data:Partial<MigrationError>={}){super(message);Object.assign(this,data);this.name='MigrationError'} }
const q=(s:string)=>`"${s.replace(/"/g,'""')}"`;
const base=(t:string)=>t.endsWith('?')?t.slice(0,-1):t;
const scalar=(t:string)=>{t=base(t);return t==='number'?'REAL':t==='boolean'||t==='id'||t==='money'?'INTEGER':t==='integer'?'INTEGER':'TEXT'};
const literal=(v:unknown)=>typeof v==='boolean'?(v?'1':'0'):typeof v==='number'?String(v):`'${String(v).replace(/'/g,"''")}'`;

export function migrate(db:Database.Database,ir:ProjectIR){
 db.exec('PRAGMA foreign_keys = ON');
 if(ir.db){const errors=validateDbSchema(ir.db);if(errors.length)throw new MigrationError(`PIPE-MIG-001: Invalid canonical database schema. ${errors.join('; ')}`);}
 const run=()=>{
  db.exec('CREATE TABLE IF NOT EXISTS "_pipe_migrations" (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, changes TEXT NOT NULL)');
  const changes:string[]=[]; const ref=(t:string)=>ir.models.some(x=>x.name===base(t));
  const normalize=(v:unknown)=>v===null||v===undefined?undefined:String(v).replace(/^\((.*)\)$/,'$1').replace(/^true$/i,'1').replace(/^false$/i,'0');
  const uniqueFields=(table:string)=>{const fields=new Set<string>();for(const index of db.prepare(`PRAGMA index_list(${table})`).all() as Array<{name:string;unique:number}>){if(!index.unique)continue;for(const row of db.prepare(`PRAGMA index_info(${q(index.name)})`).all() as Array<{name:string}>){if(row.name)fields.add(row.name)}}return fields};
  const current=new Set(ir.models.map(x=>`pipe_${x.name}`));
  const oldTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pipe_%'").all() as Array<{name:string}>;
  for(const old of oldTables)if(!current.has(old.name))throw new MigrationError(`PIPE-MIG-001: Model removal is not supported. ${old.name} must remain in the schema.`,{model:old.name.replace(/^pipe_/,'')});
  for(const m of ir.models){
   const table=q(`pipe_${m.name}`); const exists=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(`pipe_${m.name}`);
   if(!exists){const cols=['"id" INTEGER PRIMARY KEY AUTOINCREMENT',...m.fields.map(f=>{let x=`${q(f.name)} ${ref(f.type)?'INTEGER':scalar(f.type)}`;if(f.required)x+=' NOT NULL';if(f.unique)x+=' UNIQUE';if(f.default!==undefined)x+=` DEFAULT ${literal(f.default)}`;return x}),...(ir.db?.models.find(model=>model.name===m.name)?.foreignKeys??[]).map(foreign=>{const target=ir.db!.models.find(model=>model.id===foreign.references.modelId)!;return `FOREIGN KEY (${q(foreign.field)}) REFERENCES ${q(`pipe_${target.name}`)} (${q(foreign.references.field)})`})];db.exec(`CREATE TABLE ${table} (${cols.join(',')})`);changes.push(`add model ${m.name}`);continue}
   const old=db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string;type:string;notnull:number;dflt_value:string|null}>; const by=new Map(old.map(x=>[x.name,x])); const count=(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n as number; const unique=uniqueFields(table);
   for(const f of m.fields){
    const prior=by.get(f.name),want=ref(f.type)?'INTEGER':scalar(f.type);
    if(!prior){
     if(f.required&&f.default===undefined)throw new MigrationError(`PIPE-MIG-001: Cannot add required field ${m.name}.${f.name} without a default`,{model:m.name,field:f.name,from:'<missing>',to:f.type});
     if(f.unique)throw new MigrationError('PIPE-MIG-001: Adding a unique field to an existing model is not supported safely.',{model:m.name,field:f.name,from:'<missing>',to:f.type});
     let x=`${q(f.name)} ${want}`;if(f.required)x+=' NOT NULL';if(f.default!==undefined)x+=` DEFAULT ${literal(f.default)}`;db.exec(`ALTER TABLE ${table} ADD COLUMN ${x}`);changes.push(`add field ${m.name}.${f.name}`);
    } else if(prior.type.toUpperCase()!==want)throw new MigrationError(`PIPE-MIG-001: Unsafe schema change. ${m.name}.${f.name} changed from ${prior.type} to ${f.type}. Existing data may be incompatible.`,{model:m.name,field:f.name,from:prior.type,to:f.type});
    else if(Boolean(prior.notnull)!==f.required)throw new MigrationError(`PIPE-MIG-001: Constraint change is not supported safely for ${m.name}.${f.name}.`,{model:m.name,field:f.name});
    else if(normalize(prior.dflt_value)!==normalize(f.default===undefined?undefined:literal(f.default)))throw new MigrationError(`PIPE-MIG-001: Default change is not supported safely for ${m.name}.${f.name}.`,{model:m.name,field:f.name});
    else if(unique.has(f.name)!==f.unique)throw new MigrationError(`PIPE-MIG-001: Unique constraint change is not supported safely for ${m.name}.${f.name}.`,{model:m.name,field:f.name});
   }
   const wanted=new Set(m.fields.map(f=>f.name).concat('id'));for(const prior of old)if(!wanted.has(prior.name))throw new MigrationError(`PIPE-MIG-001: Unsafe schema change. ${m.name}.${prior.name} would be removed.`,{model:m.name,field:prior.name,from:prior.type,to:'<removed>'});
  }
  for(const model of ir.db?.models??[])for(const index of model.indexes??[]){
   const existing=db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(index.name);
   if(existing){const columns=(db.prepare(`PRAGMA index_info(${q(index.name)})`).all() as Array<{name:string|null}>).map(column=>column.name);if(JSON.stringify(columns)!==JSON.stringify(index.fields))throw new MigrationError(`PIPE-MIG-001: Index ${index.name} changed definition; add a new index name and review the old index before removal.`,{model:model.name,field:index.name});continue;}
   db.exec(`CREATE INDEX ${q(index.name)} ON ${q(`pipe_${model.name}`)} (${index.fields.map(q).join(', ')})`);changes.push(`add index ${index.name} on ${model.name} (${index.fields.join(', ')})`);
  }
  if(changes.length){const n=((db.prepare('SELECT MAX(version) n FROM "_pipe_migrations"').get() as any).n||0)+1;db.prepare('INSERT INTO "_pipe_migrations" VALUES (?,?,?)').run(n,new Date().toISOString(),JSON.stringify(changes))}
 };db.transaction(run)();
}
