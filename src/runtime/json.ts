import {deserializeValue,serializeValue,type SemanticValue} from './value-contract.js';
import {isSameType,type TypeRef} from '../types/type-ref.js';
import type {SymbolId} from '../identity.js';

export type JsonRecordSchemas=Record<string,{symbol:SymbolId;kind:'record'|'model';fields:Record<string,TypeRef>}>;

/** Lossless JSON boundary for PIPE semantic values. Host JSON never receives
 * bigint or money objects directly; those are represented by the wire contract. */
export function encodeJson(value:SemanticValue):string{return JSON.stringify(serializeValue(value));}
export function decodeJson(source:string):SemanticValue{let raw:unknown;try{raw=JSON.parse(source)}catch{throw new Error('PIPE-JSON-001: invalid JSON')}return deserializeValue(raw);}
export function roundTripJson(value:SemanticValue):SemanticValue{return decodeJson(encodeJson(value));}
export function decodeJsonAs<T extends SemanticValue=SemanticValue>(source:string,expected:TypeRef,schemas:JsonRecordSchemas={}):T{let raw:unknown;try{raw=JSON.parse(source)}catch{throw new Error('PIPE-JSON-001: invalid JSON')}if(isWireValue(raw)){try{const value=deserializeValue(raw);if(matches(value,expected))return value as T}catch{/* A standard JSON record can contain the same field names as a wire value. */}}return decodePlainJson(raw,expected,schemas) as T;}
export function matchesJsonType(value:SemanticValue,expected:TypeRef):boolean{return matches(value,expected)}
function isWireValue(value:unknown):value is Record<string,unknown>{return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&'version'in value&&'kind'in value)}
function mismatch(expected:TypeRef):never{throw new Error(`PIPE-JSON-002: decoded value does not match ${expected.kind==='primitive'?expected.name:expected.kind}`)}
function bindType(type:TypeRef,args:readonly TypeRef[]=[]):TypeRef{if(type.kind==='typeParameter')return args[type.ordinal]??type;if(type.kind==='optional')return {...type,inner:bindType(type.inner,args)};if(type.kind==='list')return {...type,element:bindType(type.element,args)};if(type.kind==='result')return {...type,ok:bindType(type.ok,args),error:bindType(type.error,args)};if(type.kind==='task')return {...type,result:bindType(type.result,args)};if(type.kind==='secret')return {...type,inner:bindType(type.inner,args)};if(type.kind==='record'&&type.typeArguments)return {...type,typeArguments:type.typeArguments.map(item=>bindType(item,args))};if(type.kind==='enum'&&type.typeArguments)return {...type,typeArguments:type.typeArguments.map(item=>bindType(item,args))};if(type.kind==='function')return {...type,parameters:type.parameters.map(item=>bindType(item,args)),returns:bindType(type.returns,args)};return type}
function decodePlainJson(value:unknown,expected:TypeRef,schemas:JsonRecordSchemas):SemanticValue{
 if(expected.kind==='none'){if(value===null)return {kind:'none'};return mismatch(expected)}
 if(expected.kind==='optional'){if(value===null)return {kind:'none'};return decodePlainJson(value,expected.inner,schemas)}
 if(expected.kind==='primitive'){
  if(expected.name==='text'&&typeof value==='string')return {kind:'text',value};
  if(expected.name==='boolean'&&typeof value==='boolean')return {kind:'boolean',value};
  if(expected.name==='integer'&&typeof value==='number'&&Number.isSafeInteger(value))return {kind:'integer',value:BigInt(value)};
  if(expected.name==='number'&&typeof value==='number'&&Number.isFinite(value))return {kind:'number',value};
  if(expected.name==='money'&&typeof value==='number'&&Number.isFinite(value)){const minor=Math.round(value*100);if(Number.isSafeInteger(minor)&&minor/100===value)return {kind:'money',minor:BigInt(minor),scale:2}}
  if(expected.name==='date'&&typeof value==='string')return {kind:'date',value};
  if(expected.name==='datetime'&&typeof value==='string')return {kind:'datetime',value};
  if(expected.name==='id'&&typeof value==='string')return {kind:'id',value};
  return mismatch(expected);
 }
 if(expected.kind==='list'){if(!Array.isArray(value))return mismatch(expected);return {kind:'list',elementType:expected.element,items:value.map(item=>decodePlainJson(item,expected.element,schemas))}}
 if(expected.kind==='record'||expected.kind==='model'){
  if(expected.kind==='model'&&typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return {kind:'model',type:expected,fields:{id:{kind:'integer',value:BigInt(value)}}};
  if(!value||typeof value!=='object'||Array.isArray(value))return mismatch(expected);
  const schema=schemas[expected.name];if(!schema||schema.symbol!==expected.symbol||schema.kind!==expected.kind)return mismatch(expected);
  const raw=value as Record<string,unknown>,fields:Record<string,SemanticValue>=Object.create(null) as Record<string,SemanticValue>;
  const knownFields=new Set(Object.keys(schema.fields));
  if(expected.kind==='model'&&!knownFields.has('id')&&Object.prototype.hasOwnProperty.call(raw,'id')){
   const id=raw.id;if(typeof id!=='number'||!Number.isSafeInteger(id)||id<0)return mismatch(expected);
   fields.id={kind:'integer',value:BigInt(id)};knownFields.add('id');
  }
  for(const [name,declared] of Object.entries(schema.fields)){const fieldType=bindType(declared,expected.kind==='record'?expected.typeArguments:undefined);if(!Object.prototype.hasOwnProperty.call(raw,name)){if(fieldType.kind==='optional'){fields[name]={kind:'none'};continue}return mismatch(expected)}fields[name]=decodePlainJson(raw[name],fieldType,schemas)}
  if(Object.keys(raw).some(name=>!knownFields.has(name)))return mismatch(expected);
  return {kind:expected.kind,type:expected,fields};
 }
 if(expected.kind==='result'&&value&&typeof value==='object'&&!Array.isArray(value)){const raw=value as Record<string,unknown>;if(raw.state==='ok'&&Object.keys(raw).length===2&&Object.prototype.hasOwnProperty.call(raw,'value'))return {kind:'result',state:'ok',value:decodePlainJson(raw.value,expected.ok,schemas)};if(raw.state==='err'&&Object.keys(raw).length===2&&Object.prototype.hasOwnProperty.call(raw,'error'))return {kind:'result',state:'err',error:decodePlainJson(raw.error,expected.error,schemas)};return mismatch(expected)}
 if(expected.kind==='enum'){
  if(typeof value==='string'){if(expected.variants.some(variant=>variant.name===value))return {kind:'enum',type:expected,variant:value};return mismatch(expected)}
  if(value&&typeof value==='object'&&!Array.isArray(value)){const raw=value as Record<string,unknown>,variant=expected.variants.find(item=>item.name===raw.variant);if(variant&&Object.keys(raw).every(key=>key==='variant'||key==='payload')&&(variant.payload?Object.prototype.hasOwnProperty.call(raw,'payload'):raw.payload===undefined))return {kind:'enum',type:expected,variant:variant.name,...(variant.payload?{payload:decodePlainJson(raw.payload,variant.payload,schemas)}:{})}}
  return mismatch(expected);
 }
 return mismatch(expected);
}
function matches(value:SemanticValue,expected:TypeRef):boolean{
 if(expected.kind==='typeParameter')return true;
 if(expected.kind==='optional')return value.kind==='none'||value.kind==='optional'&&value.inner!==null&&matches(value.inner,expected.inner);
 if(expected.kind==='list')return value.kind==='list'&&value.items.every(item=>matches(item,expected.element));
 if(expected.kind==='result')return value.kind==='result'&&(value.state==='ok'?matches(value.value,expected.ok):matches(value.error,expected.error));
 if(expected.kind==='record'||expected.kind==='model')return (value.kind==='record'||value.kind==='model')&&isSameType(value.type,expected);
 if(expected.kind==='enum')return value.kind==='enum'&&isSameType(value.type,expected);
 if(expected.kind==='none')return value.kind==='none';
 if(expected.kind==='primitive')return value.kind===expected.name;
 return false;
}
