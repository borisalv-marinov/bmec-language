import {afterEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {migratePostgresSchema} from '../src/runtime/postgres-migration.js';
import type {DbSchema} from '../src/db/ir.js';
import {primitive} from '../src/types/type-ref.js';

const connection=process.env.BMEC_POSTGRES_URL;
const maybePostgres=connection?it:it.skip;
let pool:Pool|undefined;
afterEach(async()=>{await pool?.end();pool=undefined;});

describe('PostgreSQL production migrations',()=>{
 maybePostgres('applies indexes and additive migrations transactionally and survives a new pool',async()=>{
  pool=new Pool({connectionString:connection});
  const model=`BmecMigration_${process.pid}_${Date.now()}`;
  const table=`"${model}"`;
  const base:DbSchema={version:1,models:[{id:`DB-${model}`,name:model,fields:[{id:`${model}-id`,name:'id',type:primitive('integer'),required:true,primaryKey:true},{id:`${model}-title`,name:'title',type:primitive('text'),required:true},{id:`${model}-createdAt`,name:'createdAt',type:primitive('datetime'),required:true}]}]};
  const next:DbSchema={version:1,models:[{...base.models[0]!,fields:[...base.models[0]!.fields,{id:`${model}-category`,name:'category',type:primitive('text'),required:true,default:'general'}],indexes:[{name:`${model}_category_title`,fields:['category','title']}]}]};
  try{
   await migratePostgresSchema(pool,base);
   await pool.query(`INSERT INTO ${table}(title,"createdAt") VALUES($1,$2)`,['Persisted','2026-09-30T00:00:00Z']);
   await migratePostgresSchema(pool,next);
   await migratePostgresSchema(pool,next);
   const rows=await pool.query(`SELECT title,category FROM ${table}`);
   expect(rows.rows).toEqual([{title:'Persisted',category:'general'}]);
   const index=await pool.query('SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname=$1',[`${model}_category_title`]);
   expect(index.rows[0]?.indexdef).toContain('(category, title)');
   const history=await pool.query('SELECT changes FROM "_bmec_migrations" WHERE changes::text LIKE $1',[`%${model}%`]);
   expect(history.rows).toHaveLength(2);
   const unsafe:DbSchema={version:1,models:[{...next.models[0]!,fields:[...next.models[0]!.fields,{id:`${model}-required`,name:'unsafe',type:primitive('text'),required:true}]}]};
   await expect(migratePostgresSchema(pool,unsafe)).rejects.toThrow('PIPE-MIG-001');
   const missing=await pool.query('SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2',[model,'unsafe']);
   expect(missing.rows).toHaveLength(0);
   const restarted=new Pool({connectionString:connection});
   try{expect((await restarted.query(`SELECT title,category FROM ${table}`)).rows).toEqual([{title:'Persisted',category:'general'}]);}finally{await restarted.end();}
  }finally{
   if(pool)await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`).catch(()=>{});
  }
 });
});
