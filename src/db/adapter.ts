import {validateDbOperationAgainstSchema,type DbOperation,type DbSchema} from './ir.js';
import {compileSql} from './sql.js';

export interface DbResult<T=unknown>{rows:T[];rowCount:number;insertedId?:number|bigint|string}
export interface DbAdapter {execute<T=unknown>(operation:DbOperation,values?:unknown[]):Promise<DbResult<T>>;transaction<T>(work:(adapter:DbAdapter)=>Promise<T>):Promise<T>}
export interface SqliteStatement {all(...parameters:unknown[]):unknown[];run(...parameters:unknown[]):{changes:number;lastInsertRowid?:number|bigint}}
export interface SqliteClient {prepare(sql:string):SqliteStatement;transaction<T>(work:()=>T):()=>T;exec?(sql:string):void;defaultSafeIntegers?(toggle?:boolean):SqliteClient}

function nestedTransactionError():Error{return new Error('PIPE-DB-008: nested database transactions are not supported')}

/** Adapter bridge for PostgreSQL-style clients; the client owns connection/pooling and transactions. */
export function postgresAdapter(query:(text:string,parameters?:unknown[])=>Promise<{rows:unknown[];rowCount?:number}>):DbAdapter{
 const execute=async<T>(operation:DbOperation,values:unknown[]=[]):Promise<DbResult<T>>=>{
  const compiled=compileSql(operation,values),result=await query(compiled.text,compiled.parameters),first=result.rows[0] as {id?:number|bigint|string}|undefined;
  return {rows:result.rows as T[],rowCount:result.rowCount??result.rows.length,...(operation.kind==='insert'&&operation.returningId&&first?.id!==undefined?{insertedId:first.id}:{})};
 };
 const transactionAdapter:DbAdapter={execute,async transaction(){throw nestedTransactionError()}};
 return {execute,async transaction<T>(work:(adapter:DbAdapter)=>Promise<T>){
  await query('BEGIN');
  try{const result=await work(transactionAdapter);await query('COMMIT');return result}
  catch(error){await query('ROLLBACK');throw error}
 }};
}

/** SQLite adapter for the typed DB IR. Async transactions hold the shared client lock. */
export function sqliteAdapter(client:SqliteClient,schema?:DbSchema,options:{safeIntegers?:boolean;tablePrefix?:string}={}):DbAdapter{
 if(options.safeIntegers)client.defaultSafeIntegers?.();
 client.exec?.('PRAGMA foreign_keys = ON');

 let lockTail=Promise.resolve();
 const withClientLock=async<T>(work:()=>Promise<T>):Promise<T>=>{
  const previous=lockTail;
  let release!:()=>void;
  lockTail=new Promise<void>(resolve=>{release=resolve});
  await previous;
  try{return await work()}finally{release()}
 };

 const execute=async<T>(operation:DbOperation,values:unknown[]=[]):Promise<DbResult<T>>=>{
  if(schema){const errors=validateDbOperationAgainstSchema(operation,schema);if(errors.length)throw new Error(`PIPE-DB-IR-001: ${errors.join('; ')}`);}
  const compiled=compileSql(options.tablePrefix?{...operation,model:`${options.tablePrefix}${operation.model}`}:operation,values,'sqlite');
  const statement=client.prepare(compiled.text);
  if(operation.kind==='select'||operation.kind==='count'){
   const rows=statement.all(...compiled.parameters) as T[];
   return {rows,rowCount:rows.length};
  }
  if(operation.kind==='insert'&&operation.conflictField&&operation.returningId){
   const rows=statement.all(...compiled.parameters) as T[];
   const first=rows[0] as {id?:number|bigint|string}|undefined;
   return {rows,rowCount:rows.length,...(first?.id!==undefined?{insertedId:first.id}:{})};
  }
  try{
   const result=statement.run(...compiled.parameters);
   return {rows:[],rowCount:result.changes,...(operation.kind==='insert'&&operation.returningId&&result.lastInsertRowid!==undefined?{insertedId:result.lastInsertRowid}:{})};
  }catch(error){
   if(error&&typeof error==='object'&&'code' in error&&(error as {code?:unknown}).code==='SQLITE_CONSTRAINT_FOREIGNKEY')throw new Error('PIPE-DB-002: referenced record does not exist');
   throw error;
  }
 };
 const transactionAdapter:DbAdapter={execute,async transaction(){throw nestedTransactionError()}};
 return {
  execute:<T>(operation:DbOperation,values:unknown[]=[])=>withClientLock(()=>execute<T>(operation,values)),
  async transaction<T>(work:(adapter:DbAdapter)=>Promise<T>):Promise<T>{
   if(!client.exec)throw new Error('PIPE-DB-008: async SQLite transactions require explicit client exec support');
   return withClientLock(async()=>{
    client.exec!('BEGIN IMMEDIATE');
    try{
     const result=await work(transactionAdapter);
     client.exec!('COMMIT');
     return result;
    }catch(error){
     try{client.exec!('ROLLBACK')}catch{/* retain the original transaction failure */}
     throw error;
    }
   });
  },
 };
}
