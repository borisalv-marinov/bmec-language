import {isAssignable,isSameType,primitive,typeRefFromUnknown,type TypeRef} from '../types/type-ref.js';
export interface DbField { id:string; name:string; type:TypeRef; required?:boolean; unique?:boolean; primaryKey?:boolean; default?:unknown }
export interface DbForeignKey { field:string; references:{modelId:string;field:string} }
export interface DbIndex { name:string; fields:string[] }
export interface DbModel { id:string; name:string; fields:DbField[]; typeSymbol?:string; uniqueConstraints?:string[][]; foreignKeys?:DbForeignKey[]; indexes?:DbIndex[] }
export interface DbSchema { version:1; models:DbModel[] }

/** Validate the backend-neutral database schema before any adapter sees it. */
export function validateDbSchema(schema:DbSchema):string[]{
 const errors:string[]=[];
 if(!schema||typeof schema!=='object'||schema.version!==1||!Array.isArray(schema.models))return ['Invalid database schema'];
 const modelIds=new Set<string>(),modelNames=new Set<string>(),indexNames=new Set<string>();
 for(const model of schema.models){
  if(!model||typeof model!=='object'){errors.push('Invalid database model');continue;}
  if(!model||typeof model!=='object'||typeof model.id!=='string'||!model.id||modelIds.has(model.id))errors.push(`Invalid or duplicate database model id "${String(model?.id)}"`);else modelIds.add(model.id);
  if(typeof model?.name!=='string'||!model.name||modelNames.has(model.name))errors.push(`Invalid or duplicate database model name "${String(model?.name)}"`);else modelNames.add(model.name);
  if(model.typeSymbol!==undefined&&(typeof model.typeSymbol!=='string'||!model.typeSymbol))errors.push(`Invalid database model TypeRef symbol on "${String(model?.name)}"`);
  if(!Array.isArray(model?.fields)||!model.fields.length){errors.push(`Database model "${String(model?.name)}" must have fields`);continue;}
  const fields=new Map<string,DbField>();
  for(const field of model.fields){
   const type=typeRefFromUnknown(field?.type);
   if(!field||typeof field!=='object'||typeof field.id!=='string'||!field.id||typeof field.name!=='string'||!field.name||fields.has(field.name)||!type)errors.push(`Invalid database field "${String(field?.name)}" in "${String(model?.name)}"`);else fields.set(field.name,{...field,type});
  }
  const primary=model.fields.filter(field=>field?.primaryKey);
  if(primary.length>1)errors.push(`Database model "${String(model?.name)}" has multiple primary keys`);
  if(primary.length===1&&!fields.has(primary[0]!.name))errors.push(`Database primary key "${String(primary[0]!.name)}" is invalid`);
  if(model.uniqueConstraints!==undefined&&!Array.isArray(model.uniqueConstraints))errors.push(`Invalid database unique constraints on "${String(model?.name)}"`);
  for(const unique of Array.isArray(model.uniqueConstraints)?model.uniqueConstraints:[]){if(!Array.isArray(unique)||!unique.length||new Set(unique).size!==unique.length||unique.some(field=>typeof field!=='string'||!fields.has(field)))errors.push(`Invalid database unique constraint on "${String(model?.name)}"`);}
  if(model.indexes!==undefined&&!Array.isArray(model.indexes))errors.push(`Invalid database indexes on "${String(model?.name)}"`);
  for(const index of Array.isArray(model.indexes)?model.indexes:[]){if(!index||typeof index.name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(index.name)||!Array.isArray(index.fields)||!index.fields.length||new Set(index.fields).size!==index.fields.length||index.fields.some(field=>typeof field!=='string'||!fields.has(field)))errors.push(`Invalid database index on "${String(model?.name)}"`);else if(indexNames.has(index.name))errors.push(`Duplicate database index name "${index.name}"`);else indexNames.add(index.name);}
  if(model.foreignKeys!==undefined&&!Array.isArray(model.foreignKeys))errors.push(`Invalid database foreign keys on "${String(model?.name)}"`);
  for(const foreign of Array.isArray(model.foreignKeys)?model.foreignKeys:[]){if(!foreign||typeof foreign!=='object'||!fields.has(foreign.field)||typeof foreign.references?.modelId!=='string'||typeof foreign.references?.field!=='string')errors.push(`Invalid database foreign key on "${String(model?.name)}.${String(foreign?.field)}"`);}
 }
 for(const model of schema.models){for(const foreign of Array.isArray(model?.foreignKeys)?model.foreignKeys:[]){if(!foreign||typeof foreign!=='object'||!foreign.references||typeof foreign.references.modelId!=='string'||typeof foreign.references.field!=='string'||!Array.isArray(model.fields))continue;const target=schema.models.find(candidate=>candidate&&candidate.id===foreign.references.modelId);if(!target){errors.push(`Database foreign key references unknown model "${foreign.references.modelId}"`);continue;}if(!Array.isArray(target.fields)){errors.push(`Database foreign key target model "${target.name}" has invalid fields`);continue;}const local=model.fields.find(field=>field.name===foreign.field),remote=target.fields.find(field=>field.name===foreign.references.field),localType=local?.type.kind==='optional'?local.type.inner:local?.type;if(!remote)errors.push(`Database foreign key references unknown field "${foreign.references.modelId}.${foreign.references.field}"`);else if(local&&!isSameType(local.type,remote.type)&&!(localType?.kind==='model'&&localType.symbol===(target.typeSymbol??target.id)&&remote.primaryKey))errors.push(`Database foreign key types differ for "${model.name}.${foreign.field}" and "${target.name}.${remote.name}"`);}}
 return errors;
}

export function dbSchemaFromProjectModels(models:readonly {id:string;name:string;typeRef?:TypeRef;fields:readonly {id:string;name:string;typeRef?:TypeRef;type:string;required?:boolean;unique?:boolean;default?:unknown}[]}[],indexes:readonly {name:string;model:string;fields:readonly string[]}[]=[]):DbSchema {
 return {version:1,models:models.map(model=>{const fields=model.fields.map(field=>({id:field.id,name:field.name,type:field.typeRef??typeRefFromUnknown({kind:'primitive',name:field.type})??primitive('text'),required:field.required,unique:field.unique,primaryKey:field.name==='id',default:field.default}));if(!fields.some(field=>field.name==='id'))fields.unshift({id:`${model.id}:id`,name:'id',type:primitive('integer'),required:true,unique:false,primaryKey:true,default:undefined});const foreignKeys=model.fields.flatMap(field=>{const type=field.typeRef?.kind==='optional'?field.typeRef.inner:field.typeRef;if(type?.kind!=='model')return[];const target=models.find(candidate=>candidate.typeRef?.kind==='model'&&candidate.typeRef.symbol===type.symbol);return target?[{field:field.name,references:{modelId:target.id,field:'id'}}]:[]});const modelIndexes=indexes.filter(index=>index.model===model.name).map(index=>({name:index.name,fields:[...index.fields]}));return {id:model.id,name:model.name,...(model.typeRef?.kind==='model'?{typeSymbol:model.typeRef.symbol}:{}),fields,...(foreignKeys.length?{foreignKeys}:{}),...(modelIndexes.length?{indexes:modelIndexes}:{})};})};
}
export type DbOperation={kind:'select'|'count'|'insert'|'update'|'delete';model:string;modelId?:string;fields?:string[];values?:Record<string,TypeRef>;where?:DbPredicate;orderBy?:{field:string;descending?:boolean};limit?:number;returningId?:boolean;conflictField?:string}|{kind:'decrement';model:string;modelId?:string;field:string;amountType:TypeRef;where:DbPredicate;fields?:string[];values?:Record<string,TypeRef>;orderBy?:{field:string;descending?:boolean};limit?:number;returningId?:boolean;conflictField?:string};
export type DbPredicate={kind:'and'|'or';items:DbPredicate[]}|{kind:'compare';field:string;operator:'='|'!='|'<'|'<='|'>'|'>='|'contains';value:TypeRef};
export interface DbTransaction {operations:DbOperation[];mode:'read'|'write'}
export function validateDbOperation(operation:DbOperation,fields:Record<string,TypeRef>,uniqueFields:ReadonlySet<string>=new Set()):string[]{
 const errors:string[]=[];if(!operation.model.trim())errors.push('Database model is required');
 const selected=operation.fields??Object.keys(operation.values??{});if(operation.fields?.includes('*')){if(operation.kind!=='select'||operation.fields.length!==1)errors.push('Database wildcard projection is only valid as the sole select field');}for(const field of selected)if(field!=='*'&&!fields[field])errors.push(`Unknown database field "${field}"`);
 for(const field of Object.keys(operation.values??{}))if(fields[field]&&operation.values?.[field]&&!isAssignable(operation.values[field]!,fields[field]!))errors.push(`Database value for "${field}" has an incompatible type`);
 if(operation.orderBy&&!fields[operation.orderBy.field])errors.push(`Unknown database field "${operation.orderBy.field}"`);
 if(operation.kind==='count'&&(operation.fields!==undefined||operation.values!==undefined||operation.orderBy!==undefined||operation.limit!==undefined||operation.returningId!==undefined))errors.push('Database count only accepts a model and optional predicate');
 if(operation.limit!==undefined&&(!Number.isInteger(operation.limit)||operation.limit<0))errors.push('Database limit must be a non-negative integer');
 const predicate=(value:DbPredicate):void=>{if(value.kind==='compare'){const field=fields[value.field];if(!field)errors.push(`Unknown database field "${value.field}"`);else if(value.operator==='contains'){if(operation.kind!=='select')errors.push('Database text contains predicate is only valid in a select');if(!isSameType(field,primitive('text'))||!isSameType(value.value,primitive('text')))errors.push(`Database contains for "${value.field}" requires text field and text value`);}else if(!isAssignable(value.value,field))errors.push(`Database comparison for "${value.field}" has an incompatible type`);}else{if(!value.items.length)errors.push('Database predicate groups must not be empty');value.items.forEach(predicate)}};
 if(operation.kind==='decrement'){const field=fields[operation.field];if(!field)errors.push(`Unknown database field "${operation.field}"`);else if(!isSameType(field,primitive('integer')))errors.push('Database decrement requires an integer field');if(!isSameType(operation.amountType,primitive('integer')))errors.push('Database decrement amount must be an integer');if(!operation.where)errors.push('Database decrement requires a predicate');}
 if(operation.conflictField!==undefined){if(operation.kind!=='insert')errors.push('Database conflict handling is only valid on inserts');else{if(!fields[operation.conflictField])errors.push(`Unknown database field "${operation.conflictField}"`);else if(!uniqueFields.has(operation.conflictField))errors.push(`Database conflict field "${operation.conflictField}" must be unique`);if(!operation.returningId)errors.push('Database conflict-safe insert must return its generated ID');}}
 if(operation.where)predicate(operation.where);return errors;
}

/** Resolve a typed operation against canonical schema identity before lowering. */
export function validateDbOperationAgainstSchema(operation:DbOperation,schema:DbSchema):string[]{
 const errors=validateDbSchema(schema);if(errors.length)return errors.map(error=>`Schema: ${error}`);
 if(typeof operation.modelId!=='string'||!operation.modelId)errors.push('Database operation requires a canonical modelId');
 const model=schema.models.find(candidate=>candidate.id===operation.modelId);
 if(!model){errors.push(`Unknown database model identity "${String(operation.modelId)}"`);return errors;}
 if(operation.model!==model.name)errors.push(`Database operation model name does not match modelId "${model.id}"`);
 const fields=Object.fromEntries(model.fields.map(field=>[field.name,field.type]));
 const uniqueFields=new Set([...model.fields.filter(field=>field.unique||field.primaryKey).map(field=>field.name),...(model.uniqueConstraints??[]).filter(constraint=>constraint.length===1).map(constraint=>constraint[0]!)]);
 return [...errors,...validateDbOperation(operation,fields,uniqueFields)];
}
