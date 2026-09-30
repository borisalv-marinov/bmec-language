import {formatType,isSameType} from '../types/type-ref.js';
import type {DbSchema} from './ir.js';

/** Backend-neutral schema migration planning. Planning is pure; execution belongs to an adapter. */
export interface SchemaField { name:string; type:string; required?:boolean; default?:unknown }
export interface SchemaModel { name:string; fields:SchemaField[] }
export type MigrationChange =
  | {kind:'add_model'; model:string; destructive:false}
  | {kind:'add_field'; model:string; field:string; type:string; destructive:boolean}
  | {kind:'remove_model'; model:string; destructive:true}
  | {kind:'remove_field'; model:string; field:string; from:string; destructive:true}
  | {kind:'alter_field'; model:string; field:string; from:string; to:string; destructive:true};
export interface MigrationPlan { changes:MigrationChange[]; requiresReview:boolean }

export function planMigration(previous:readonly SchemaModel[], current:readonly SchemaModel[]):MigrationPlan {
  const before=new Map(previous.map(model=>[model.name,model]));
  const after=new Map(current.map(model=>[model.name,model]));
  const changes:MigrationChange[]=[];
  for(const model of current){
    const prior=before.get(model.name);
    if(!prior){changes.push({kind:'add_model',model:model.name,destructive:false});continue;}
    const oldFields=new Map(prior.fields.map(field=>[field.name,field]));
    const newFields=new Map(model.fields.map(field=>[field.name,field]));
    for(const field of model.fields)if(!oldFields.has(field.name))changes.push({kind:'add_field',model:model.name,field:field.name,type:field.type,destructive:Boolean(field.required&&!('default' in field))});
    for(const field of prior.fields)if(!newFields.has(field.name))changes.push({kind:'remove_field',model:model.name,field:field.name,from:field.type,destructive:true});
    for(const field of model.fields){const old=oldFields.get(field.name);if(old&&old.type!==field.type)changes.push({kind:'alter_field',model:model.name,field:field.name,from:old.type,to:field.type,destructive:true});}
  }
  for(const model of previous)if(!after.has(model.name))changes.push({kind:'remove_model',model:model.name,destructive:true});
  changes.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {changes,requiresReview:changes.some(change=>change.destructive)};
}

export function requireMigrationReview(plan:MigrationPlan,reviewed=false):void {
  if(plan.requiresReview&&!reviewed)throw new Error('PIPE-MIG-002: destructive migration requires an explicit reviewed migration path');
}

export type DbSchemaMigrationChange=
 | {kind:'add_model';modelId:string;model:string;destructive:false}
 | {kind:'remove_model';modelId:string;model:string;destructive:true}
 | {kind:'add_field';modelId:string;model:string;fieldId:string;field:string;type:string;destructive:boolean}
 | {kind:'remove_field';modelId:string;model:string;fieldId:string;field:string;from:string;destructive:true}
 | {kind:'alter_field';modelId:string;model:string;fieldId:string;field:string;from:string;to:string;destructive:true}
 | {kind:'add_unique_constraint';modelId:string;model:string;fields:string[];destructive:true}
 | {kind:'remove_unique_constraint';modelId:string;model:string;fields:string[];destructive:true}
 | {kind:'add_index';modelId:string;model:string;name:string;fields:string[];destructive:false}
 | {kind:'remove_index';modelId:string;model:string;name:string;fields:string[];destructive:true}
 | {kind:'alter_index';modelId:string;model:string;name:string;from:string[];to:string[];destructive:true}
 | {kind:'add_foreign_key';modelId:string;model:string;field:string;targetModelId:string;targetField:string;destructive:true}
 | {kind:'remove_foreign_key';modelId:string;model:string;field:string;targetModelId:string;targetField:string;destructive:true};
export interface DbSchemaMigrationPlan {changes:DbSchemaMigrationChange[];requiresReview:boolean}

/** Compare canonical DB schemas without consulting or mutating an adapter. */
export function planDbSchemaMigration(previous:DbSchema,current:DbSchema):DbSchemaMigrationPlan{
 const before=new Map(previous.models.map(model=>[model.id,model])),after=new Map(current.models.map(model=>[model.id,model]));
 const changes:DbSchemaMigrationChange[]=[];
 for(const model of current.models){const old=before.get(model.id);if(!old){changes.push({kind:'add_model',modelId:model.id,model:model.name,destructive:false});continue;}const oldFields=new Map(old.fields.map(field=>[field.id,field])),newFields=new Map(model.fields.map(field=>[field.id,field]));
  for(const field of model.fields){const prior=oldFields.get(field.id);if(!prior)changes.push({kind:'add_field',modelId:model.id,model:model.name,fieldId:field.id,field:field.name,type:formatType(field.type),destructive:Boolean(field.required&&field.default===undefined)});else if(!isSameType(prior.type,field.type))changes.push({kind:'alter_field',modelId:model.id,model:model.name,fieldId:field.id,field:field.name,from:formatType(prior.type),to:formatType(field.type),destructive:true});}
  for(const field of old.fields)if(!newFields.has(field.id))changes.push({kind:'remove_field',modelId:model.id,model:model.name,fieldId:field.id,field:field.name,from:formatType(field.type),destructive:true});
  const key=(fields:string[])=>JSON.stringify([...fields]);const oldUnique=new Set((old.uniqueConstraints??[]).map(key)),newUnique=new Set((model.uniqueConstraints??[]).map(key));
  for(const fields of model.uniqueConstraints??[])if(!oldUnique.has(key(fields)))changes.push({kind:'add_unique_constraint',modelId:model.id,model:model.name,fields:[...fields],destructive:true});
  for(const fields of old.uniqueConstraints??[])if(!newUnique.has(key(fields)))changes.push({kind:'remove_unique_constraint',modelId:model.id,model:model.name,fields:[...fields],destructive:true});
  const oldIndexes=new Map((old.indexes??[]).map(index=>[index.name,index.fields])),newIndexes=new Map((model.indexes??[]).map(index=>[index.name,index.fields]));
  for(const index of model.indexes??[]){const prior=oldIndexes.get(index.name);if(!prior)changes.push({kind:'add_index',modelId:model.id,model:model.name,name:index.name,fields:[...index.fields],destructive:false});else if(key(prior)!==key(index.fields))changes.push({kind:'alter_index',modelId:model.id,model:model.name,name:index.name,from:[...prior],to:[...index.fields],destructive:true});}
  for(const index of old.indexes??[])if(!newIndexes.has(index.name))changes.push({kind:'remove_index',modelId:model.id,model:model.name,name:index.name,fields:[...index.fields],destructive:true});
  const fk=(value:{field:string;references:{modelId:string;field:string}})=>JSON.stringify(value);const oldFks=new Set((old.foreignKeys??[]).map(fk)),newFks=new Set((model.foreignKeys??[]).map(fk));
  for(const value of model.foreignKeys??[])if(!oldFks.has(fk(value)))changes.push({kind:'add_foreign_key',modelId:model.id,model:model.name,field:value.field,targetModelId:value.references.modelId,targetField:value.references.field,destructive:true});
  for(const value of old.foreignKeys??[])if(!newFks.has(fk(value)))changes.push({kind:'remove_foreign_key',modelId:model.id,model:model.name,field:value.field,targetModelId:value.references.modelId,targetField:value.references.field,destructive:true});
 }
 for(const model of previous.models)if(!after.has(model.id))changes.push({kind:'remove_model',modelId:model.id,model:model.name,destructive:true});
 changes.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));return {changes,requiresReview:changes.some(change=>change.destructive)};
}

export function requireDbSchemaMigrationReview(plan:DbSchemaMigrationPlan,reviewed=false):void {if(plan.requiresReview&&!reviewed)throw new Error('PIPE-MIG-002: destructive database schema migration requires explicit review');}
