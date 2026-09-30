import {describe,expect,it} from 'vitest';
import {compileSql} from '../src/db/sql.js';
import {primitive} from '../src/types/type-ref.js';

describe('parameterized SQL lowering for literal text search',()=>{
 const operation={
  kind:'select' as const,
  model:'Issue',
  fields:['id','title','description'],
  where:{kind:'or' as const,items:[
   {kind:'compare' as const,field:'title',operator:'contains' as const,value:primitive('text')},
   {kind:'compare' as const,field:'description',operator:'contains' as const,value:primitive('text')},
  ]},
  orderBy:{field:'title'},
  limit:100,
 };

 it('uses literal, case-sensitive substring predicates in SQLite and PostgreSQL',()=>{
  const sqlite=compileSql(operation,['%_','%_'],'sqlite');
  expect(sqlite.text).toContain('instr("title", ?) > 0 OR instr("description", ?) > 0');
  expect(sqlite.parameters).toEqual(['%_','%_']);
  const postgres=compileSql(operation,['%_','%_'],'postgres');
  expect(postgres.text).toContain('strpos("title", $1) > 0 OR strpos("description", $2) > 0');
  expect(postgres.parameters).toEqual(['%_','%_']);
 });

 it('lowers three owner/workspace/cursor predicates with ordered bound parameters',()=>{
  const scoped={...operation,where:{kind:'and' as const,items:[
   {kind:'compare' as const,field:'workspaceId',operator:'=' as const,value:primitive('integer')},
   {kind:'compare' as const,field:'ownerAuthId',operator:'=' as const,value:primitive('text')},
   {kind:'compare' as const,field:'id',operator:'>' as const,value:primitive('integer')},
  ]}};
  const sqlite=compileSql(scoped,[7,'alice',100],'sqlite');
  expect(sqlite.text).toContain('"workspaceId" = ? AND "ownerAuthId" = ? AND "id" > ?');
  expect(sqlite.parameters).toEqual([7,'alice',100]);
  const postgres=compileSql(scoped,[7,'alice',100],'postgres');
  expect(postgres.text).toContain('"workspaceId" = $1 AND "ownerAuthId" = $2 AND "id" > $3');
  expect(postgres.parameters).toEqual([7,'alice',100]);
 });

 it('lowers published title search and its cursor with bound values in both dialects',()=>{
  const journal={...operation,model:'Post',fields:['id','title','slug','published'],orderBy:{field:'slug'},limit:50,where:{kind:'and' as const,items:[
   {kind:'compare' as const,field:'published',operator:'=' as const,value:primitive('boolean')},
   {kind:'compare' as const,field:'title',operator:'contains' as const,value:primitive('text')},
   {kind:'compare' as const,field:'slug',operator:'>' as const,value:primitive('text')},
  ]}};
  const sqlite=compileSql(journal,[true,'needle','needle-049'],'sqlite');
  expect(sqlite.text).toContain('"published" = ? AND instr("title", ?) > 0 AND "slug" > ?');
  expect(sqlite.parameters).toEqual([true,'needle','needle-049']);
  const postgres=compileSql(journal,[true,'needle','needle-049'],'postgres');
  expect(postgres.text).toContain('"published" = $1 AND strpos("title", $2) > 0 AND "slug" > $3');
  expect(postgres.parameters).toEqual([true,'needle','needle-049']);
 });

 it('preserves grouped text search with an AND cursor in PostgreSQL SQL',()=>{
  const grouped={...operation,fields:['id','title','description'],orderBy:{field:'id'},limit:50,where:{kind:'and' as const,items:[
   {kind:'or' as const,items:[
    {kind:'compare' as const,field:'title',operator:'contains' as const,value:primitive('text')},
    {kind:'compare' as const,field:'description',operator:'contains' as const,value:primitive('text')},
   ]},
   {kind:'compare' as const,field:'id',operator:'>' as const,value:primitive('integer')},
  ]}};
  const postgres=compileSql(grouped,['needlepaged','needlepaged',42],'postgres');
  expect(postgres.text).toContain('((strpos("title", $1) > 0 OR strpos("description", $2) > 0) AND "id" > $3)');
  expect(postgres.parameters).toEqual(['needlepaged','needlepaged',42]);
 });
});
