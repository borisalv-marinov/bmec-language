import {describe,expect,it} from 'vitest';
import {planDbSchemaMigration,requireDbSchemaMigrationReview} from '../src/db/migrations.js';
import {type DbSchema} from '../src/db/ir.js';
import {primitive} from '../src/types/type-ref.js';

const base:DbSchema={version:1,models:[{id:'DB-ITEM',name:'Item',fields:[{id:'F-ID',name:'id',type:primitive('integer'),primaryKey:true},{id:'F-NAME',name:'name',type:primitive('text')}]}]};
describe('canonical database schema migration planning',()=>{
  it('classifies optional additive fields as safe and deterministic',()=>{
    const next:DbSchema={...base,models:[{...base.models[0]!,fields:[...base.models[0]!.fields,{id:'F-DESC',name:'description',type:primitive('text')}]}]};
    const plan=planDbSchemaMigration(base,next);
    expect(plan).toEqual({changes:[{kind:'add_field',modelId:'DB-ITEM',model:'Item',fieldId:'F-DESC',field:'description',type:'text',destructive:false}],requiresReview:false});
    expect(()=>requireDbSchemaMigrationReview(plan)).not.toThrow();
  });
  it('requires review for type, removal, and constraint changes',()=>{
    const next:DbSchema={version:1,models:[{id:'DB-ITEM',name:'Item',fields:[{id:'F-ID',name:'id',type:primitive('integer'),primaryKey:true},{id:'F-NAME',name:'name',type:primitive('integer')}],uniqueConstraints:[['name']]}]};
    const plan=planDbSchemaMigration(base,next);
    expect(plan.requiresReview).toBe(true);
    expect(plan.changes.map(change=>change.kind)).toEqual(['add_unique_constraint','alter_field']);
    expect(()=>requireDbSchemaMigrationReview(plan)).toThrow('PIPE-MIG-002');
    expect(()=>requireDbSchemaMigrationReview(plan,true)).not.toThrow();
  });
  it('treats new indexes as safe and index removal or redefinition as destructive',()=>{
    const indexed:DbSchema={version:1,models:[{...base.models[0]!,indexes:[{name:'item_name',fields:['name']}]}]};
    const added=planDbSchemaMigration(base,indexed);
    expect(added).toEqual({changes:[{kind:'add_index',modelId:'DB-ITEM',model:'Item',name:'item_name',fields:['name'],destructive:false}],requiresReview:false});
    const removed=planDbSchemaMigration(indexed,base);
    expect(removed.requiresReview).toBe(true);expect(removed.changes[0]?.kind).toBe('remove_index');
    const changed:DbSchema={...indexed,models:[{...indexed.models[0]!,fields:[...indexed.models[0]!.fields,{id:'F-TAG',name:'tag',type:primitive('text')}],indexes:[{name:'item_name',fields:['tag']}]}]};
    expect(planDbSchemaMigration(indexed,changed).changes.some(change=>change.kind==='alter_index'&&change.destructive)).toBe(true);
  });
});
