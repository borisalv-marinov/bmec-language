import {describe,expect,it} from 'vitest';
import {planMigration,requireMigrationReview} from '../src/db/migrations.js';

describe('deterministic migration planning',()=>{
 it('classifies additive changes without requiring review',()=>{
  const plan=planMigration([{name:'users',fields:[{name:'name',type:'text'}]}],[{name:'users',fields:[{name:'name',type:'text'},{name:'active',type:'boolean',default:false}]}]);
  expect(plan.requiresReview).toBe(false);expect(plan.changes).toEqual([{kind:'add_field',model:'users',field:'active',type:'boolean',destructive:false}]);
  expect(()=>requireMigrationReview(plan)).not.toThrow();
 });
 it('flags removals, type changes, and required additions',()=>{
  const plan=planMigration([{name:'users',fields:[{name:'name',type:'text'},{name:'old',type:'text'}]}],[{name:'users',fields:[{name:'name',type:'integer'},{name:'required',type:'text',required:true}]}]);
  expect(plan.requiresReview).toBe(true);expect(plan.changes.map(x=>x.kind)).toEqual(['add_field','alter_field','remove_field']);expect(()=>requireMigrationReview(plan)).toThrow('PIPE-MIG-002');expect(()=>requireMigrationReview(plan,true)).not.toThrow();
 });
});
