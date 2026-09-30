import type {DbOperation,DbPredicate} from './ir.js';

export interface CompiledSql {text:string;parameters:unknown[]}
export type SqlDialect='postgres'|'sqlite';
/** Compile the backend-neutral DB IR to parameterized SQL. Identifiers are validated, values never interpolated. */
export function compileSql(operation:DbOperation,values:unknown[]=[],dialect:SqlDialect='postgres'):CompiledSql {
 const ident=(value:string)=>{if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))throw new Error(`PIPE-DB-001: invalid identifier "${value}"`);return `"${value}"`;};
 const params:unknown[]=[];
 if(!['select','count','insert','update','delete','decrement'].includes((operation as any).kind))throw new Error('PIPE-DB-004: unsupported database operation');
 const requireCount=(count:number)=>{if(values.length!==count)throw new Error(`PIPE-DB-003: expected ${count} runtime parameter${count===1?'':'s'}, received ${values.length}`)};
 const parameter=()=>{const index=params.length;params.push(values[index]);return dialect==='sqlite'?'?':`$${index+1}`};
 const predicate=(p:DbPredicate):string=>p.kind==='compare'?p.operator==='contains'?`${dialect==='sqlite'?'instr':'strpos'}(${ident(p.field)}, ${parameter()}) > 0`:`${ident(p.field)} ${p.operator} ${parameter()}`:`(${p.items.map(predicate).join(` ${p.kind.toUpperCase()} `)})`;
 const model=ident(operation.model);
 if(operation.kind==='select'){const fields=(operation.fields?.length?operation.fields:['*']).map(x=>x==='*'?'*':ident(x)).join(', ');let text=`SELECT ${fields} FROM ${model}`;if(operation.where)text+=` WHERE ${predicate(operation.where)}`;if(operation.orderBy)text+=` ORDER BY ${ident(operation.orderBy.field)}${operation.orderBy.descending?' DESC':' ASC'}`;if(operation.limit!==undefined)text+=` LIMIT ${Math.floor(operation.limit)}`;requireCount(params.length);return {text,parameters:params};}
 if(operation.kind==='count'){let text=`SELECT COUNT(*) AS "count" FROM ${model}`;if(operation.where)text+=` WHERE ${predicate(operation.where)}`;requireCount(params.length);return {text,parameters:params};}
 if(operation.kind==='insert'){const names=Object.keys(operation.values??{});if(!names.length)throw new Error('PIPE-DB-002: insert requires values');const placeholders=names.map(parameter);requireCount(names.length);let text=`INSERT INTO ${model} (${names.map(ident).join(', ')}) VALUES (${placeholders.join(', ')})`;if(operation.conflictField)text+=` ON CONFLICT (${ident(operation.conflictField)}) DO NOTHING`;if(operation.returningId&&(dialect==='postgres'||operation.conflictField))text+=' RETURNING "id"';return {text,parameters:params};}
 if(operation.kind==='update'){const names=Object.keys(operation.values??{});if(!names.length)throw new Error('PIPE-DB-002: update requires values');const assignments=names.map(n=>`${ident(n)} = ${parameter()}`).join(', ');let text=`UPDATE ${model} SET ${assignments}`;if(operation.where)text+=` WHERE ${predicate(operation.where)}`;requireCount(params.length);return {text,parameters:params};}
 if(operation.kind==='decrement'){const predicateParameters=(value:DbPredicate):number=>value.kind==='compare'?1:value.items.reduce((count,item)=>count+predicateParameters(item),0);requireCount(predicateParameters(operation.where)+2);const amount=parameter();const text=`UPDATE ${model} SET ${ident(operation.field)} = ${ident(operation.field)} - ${amount} WHERE ${predicate(operation.where)} AND ${ident(operation.field)} >= ${parameter()}`;return {text,parameters:params};}
 let text=`DELETE FROM ${model}`;if(operation.where)text+=` WHERE ${predicate(operation.where)}`;requireCount(params.length);return {text,parameters:params};
}
