import {describe,expect,it} from 'vitest';
import {validateDbOperation} from '../src/db/ir.js';
import {primitive} from '../src/types/type-ref.js';

describe('typed database operation validation',()=>{
 const fields={id:primitive('id'),age:primitive('integer'),name:primitive('text')};
 it('rejects incompatible nested predicate values and unknown ordering fields',()=>{
  const errors=validateDbOperation({kind:'select',model:'users',orderBy:{field:'missing'},where:{kind:'and',items:[{kind:'compare',field:'age',operator:'>=',value:primitive('text')},{kind:'or',items:[]}] }},fields);
  expect(errors).toEqual(expect.arrayContaining(['Database comparison for "age" has an incompatible type','Unknown database field "missing"','Database predicate groups must not be empty']));
 });
 it('accepts structurally typed nested filters and updates',()=>{
  expect(validateDbOperation({kind:'update',model:'users',values:{name:primitive('text')},where:{kind:'compare',field:'id',operator:'=',value:primitive('id')}},fields)).toEqual([]);
 });
 it('allows literal text containment only for text selects',()=>{
  const contains={kind:'compare' as const,field:'name',operator:'contains' as const,value:primitive('text')};
  expect(validateDbOperation({kind:'select',model:'users',where:{kind:'or',items:[contains,contains]}},fields)).toEqual([]);
  expect(validateDbOperation({kind:'select',model:'users',where:{kind:'compare',field:'age',operator:'contains',value:primitive('text')}},fields)).toContain('Database contains for "age" requires text field and text value');
  expect(validateDbOperation({kind:'update',model:'users',values:{name:primitive('text')},where:contains},fields)).toContain('Database text contains predicate is only valid in a select');
 });
 it('validates recursive three-predicate workspace, owner, and cursor reads',()=>{
  const taskFields={workspaceId:primitive('integer'),ownerAuthId:primitive('text'),id:primitive('integer')};
  expect(validateDbOperation({kind:'select',model:'Task',where:{kind:'and',items:[
   {kind:'compare',field:'workspaceId',operator:'=',value:primitive('integer')},
   {kind:'compare',field:'ownerAuthId',operator:'=',value:primitive('text')},
   {kind:'compare',field:'id',operator:'>',value:primitive('integer')},
  ]}},taskFields)).toEqual([]);
 });
 it('allows only a sole wildcard select projection',()=>{
  expect(validateDbOperation({kind:'select',model:'users',fields:['*']},fields)).toEqual([]);
  expect(validateDbOperation({kind:'select',model:'users',fields:['*','id']},fields)).toContain('Database wildcard projection is only valid as the sole select field');
  expect(validateDbOperation({kind:'insert',model:'users',fields:['*'],values:{id:primitive('id')}},fields)).toContain('Database wildcard projection is only valid as the sole select field');
 });
});
