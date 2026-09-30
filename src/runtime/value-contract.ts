import {formatType,isSameType,typeRefFromUnknown,type TypeRef} from '../types/type-ref.js';

export const VALUE_CONTRACT_VERSION=1;
export type SemanticValue =
  | {kind:'integer';value:bigint}
  | {kind:'number';value:number}
  | {kind:'money';minor:bigint;scale:2}
  | {kind:'boolean';value:boolean}
  | {kind:'text';value:string}
  | {kind:'date'|'datetime'|'id';value:string}
  | {kind:'none'}
  | {kind:'optional';inner:SemanticValue|null}
  | {kind:'list';elementType:TypeRef;items:SemanticValue[]}
  | {kind:'record'|'model';type:TypeRef;fields:Record<string,SemanticValue>}
  | {kind:'result';state:'ok';value:SemanticValue}
  | {kind:'result';state:'err';error:SemanticValue}
  | {kind:'enum';type:TypeRef;variant:string;payload?:SemanticValue};

export type WireValue =
  | {version:1;kind:'integer';value:string}
  | {version:1;kind:'number';value:number}
  | {version:1;kind:'money';minor:string;scale:2}
  | {version:1;kind:'boolean';value:boolean}
  | {version:1;kind:'text';value:string}
  | {version:1;kind:'date'|'datetime'|'id';value:string}
  | {version:1;kind:'none'}
  | {version:1;kind:'optional';present:boolean;value?:WireValue}
  | {version:1;kind:'list';elementType:TypeRef;items:WireValue[]}
  | {version:1;kind:'record'|'model';type:TypeRef;fields:Record<string,WireValue>}
  | {version:1;kind:'result';state:'ok';value:WireValue}
  | {version:1;kind:'result';state:'err';error:WireValue}
  | {version:1;kind:'enum';type:TypeRef;variant:string;payload?:WireValue};

const fail=(message:string):never=>{throw new Error(`PIPE-CONTRACT-001: ${message}`)};
const int=(value:string)=>{if(!/^-?(0|[1-9]\d*)$/.test(value))fail('integer must be a canonical decimal string');const n=BigInt(value);if(n<-(2n**63n)||n>2n**63n-1n)fail('integer outside signed int64 range');return n};
const type=(v:unknown):TypeRef=>{const t=typeRefFromUnknown(v);return t??fail('invalid TypeRef')};
const validDate=(value:string)=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!m)return false;const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));return d.getUTCFullYear()===Number(m[1])&&d.getUTCMonth()===Number(m[2])-1&&d.getUTCDate()===Number(m[3]);};
const validDateTime=(value:string)=>{const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);return Boolean(m&&validDate(m[1])&&Number(m[2])<24&&Number(m[3])<60&&Number(m[4])<60)};

export function serializeValue(value:SemanticValue):WireValue {
 switch(value.kind){
  case 'integer':int(value.value.toString());return {version:1,kind:'integer',value:value.value.toString()};
  case 'number':if(!Number.isFinite(value.value))fail('number must be finite');return {version:1,kind:'number',value:value.value};
  case 'money':if(value.scale!==2)fail('money scale must be 2');return {version:1,kind:'money',minor:int(value.minor.toString()).toString(),scale:2};
  case 'boolean':case 'text':return {version:1,kind:value.kind,value:value.value} as WireValue;
  case 'date':if(!validDate(value.value))fail('date value is invalid');return {version:1,kind:'date',value:value.value};
  case 'datetime':if(!validDateTime(value.value))fail('datetime value is invalid');return {version:1,kind:'datetime',value:value.value};
  case 'id':if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.value))fail('id value is invalid');return {version:1,kind:'id',value:value.value};
  case 'none':return {version:1,kind:'none'};
  case 'optional':return value.inner===null?{version:1,kind:'optional',present:false}:{version:1,kind:'optional',present:true,value:serializeValue(value.inner)};
  case 'list':return {version:1,kind:'list',elementType:value.elementType,items:value.items.map(serializeValue)};
  case 'record':case 'model':return {version:1,kind:value.kind,type:value.type,fields:Object.fromEntries(Object.entries(value.fields).map(([k,v])=>[k,serializeValue(v)]))};
  case 'result':return value.state==='ok'?{version:1,kind:'result',state:'ok',value:serializeValue(value.value)}:{version:1,kind:'result',state:'err',error:serializeValue(value.error)};
  case 'enum':if(!value.variant)return fail('enum variant is required');return value.payload===undefined?{version:1,kind:'enum',type:value.type,variant:value.variant}:{version:1,kind:'enum',type:value.type,variant:value.variant,payload:serializeValue(value.payload)};
 }
}
export function deserializeValue(raw:unknown):SemanticValue {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('serialized value must be an object');
 const v=raw as any;if(v.version!==1||typeof v.kind!=='string')fail('missing or unsupported value version');
 switch(v.kind){
  case 'integer':if(typeof v.value!=='string')fail('integer value must be a string');return {kind:'integer',value:int(v.value)};
  case 'number':if(typeof v.value!=='number'||!Number.isFinite(v.value))fail('number must be finite');return {kind:'number',value:v.value};
  case 'money':if(typeof v.minor!=='string'||v.scale!==2)fail('money requires minor string and scale 2');return {kind:'money',minor:int(v.minor),scale:2};
  case 'boolean':if(typeof v.value!=='boolean')fail('boolean value is invalid');return {kind:'boolean',value:v.value};
  case 'text':if(typeof v.value!=='string')fail('text value is invalid');return {kind:'text',value:v.value};
  case 'date':if(typeof v.value!=='string'||!validDate(v.value))fail('date value is invalid');return {kind:'date',value:v.value};
  case 'datetime':if(typeof v.value!=='string'||!validDateTime(v.value))fail('datetime value is invalid');return {kind:'datetime',value:v.value};
  case 'id':if(typeof v.value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v.value))fail('id value is invalid');return {kind:'id',value:v.value};
  case 'none':if(Object.keys(v).length!==2)fail('none has unknown fields');return {kind:'none'};
  case 'optional':if(v.present===false&&v.value===undefined)return {kind:'optional',inner:null};if(v.present===true&&v.value!==undefined)return {kind:'optional',inner:deserializeValue(v.value)};fail('optional must be present or absent');
  case 'list':if(!v.elementType||!Array.isArray(v.items))fail('list contract is invalid');return {kind:'list',elementType:type(v.elementType),items:v.items.map(deserializeValue)};
  case 'record':case 'model':if(!v.type||!v.fields||typeof v.fields!=='object'||Array.isArray(v.fields))fail('record/model contract is invalid');return {kind:v.kind,type:type(v.type),fields:Object.fromEntries(Object.entries(v.fields).map(([k,x])=>[k,deserializeValue(x)]))};
  case 'result':if(v.state==='ok'&&v.value!==undefined)return {kind:'result',state:'ok',value:deserializeValue(v.value)};if(v.state==='err'&&v.error!==undefined)return {kind:'result',state:'err',error:deserializeValue(v.error)};fail('result must contain exactly one valid variant');
  case 'enum':if(!v.type||typeof v.variant!=='string')fail('enum contract is invalid');return v.payload===undefined?{kind:'enum',type:type(v.type),variant:v.variant}:{kind:'enum',type:type(v.type),variant:v.variant,payload:deserializeValue(v.payload)};
  default:fail('unknown semantic value kind');
 }
 return fail('unreachable value variant');
}
export function roundTripValue(value:SemanticValue):SemanticValue{return deserializeValue(serializeValue(value));}
export function sameValue(a:SemanticValue,b:SemanticValue):boolean {
 if((a.kind==='date'||a.kind==='datetime'||a.kind==='id')&&b.kind===a.kind)return a.value===b.value;
 if(a.kind!==b.kind)return false;if(a.kind==='integer'&&b.kind==='integer')return a.value===b.value;if(a.kind==='number'&&b.kind==='number')return Object.is(a.value,b.value);if(a.kind==='money'&&b.kind==='money')return a.minor===b.minor&&a.scale===b.scale;if(a.kind==='boolean'&&b.kind==='boolean'||a.kind==='text'&&b.kind==='text')return a.value===b.value;if(a.kind==='none'&&b.kind==='none')return true;if(a.kind==='optional'&&b.kind==='optional')return a.inner===null?b.inner===null:b.inner!==null&&sameValue(a.inner,b.inner);if(a.kind==='list'&&b.kind==='list')return isSameType(a.elementType,b.elementType)&&a.items.length===b.items.length&&a.items.every((x,i)=>sameValue(x,b.items[i]));if((a.kind==='record'||a.kind==='model')&&(b.kind===a.kind))return isSameType(a.type,b.type)&&Object.keys(a.fields).length===Object.keys(b.fields).length&&Object.keys(a.fields).every(k=>b.fields[k]&&sameValue(a.fields[k],b.fields[k]));if(a.kind==='result'&&b.kind==='result'){if(a.state!==b.state)return false;return a.state==='ok'?sameValue(a.value,(b as Extract<SemanticValue,{kind:'result';state:'ok'}>).value):sameValue(a.error,(b as Extract<SemanticValue,{kind:'result';state:'err'}>).error)}return false;
}
/** Total ordering for the ordered primitive value contracts. */
export function compareValue(a:SemanticValue,b:SemanticValue):-1|0|1 {
 if(a.kind!==b.kind)fail('cannot compare values of different kinds');
 if(a.kind==='integer'&&b.kind==='integer')return a.value===b.value?0:a.value<b.value?-1:1;
 if((a.kind==='date'||a.kind==='datetime'||a.kind==='id')&&b.kind===a.kind){const av=a.value,bv=b.value;return av===bv?0:av<bv?-1:1}
 if(a.kind==='number'&&b.kind==='number'){if(Object.is(a.value,b.value))return 0;return a.value<b.value?-1:1}
 if(a.kind==='money'&&b.kind==='money')return a.minor===b.minor?0:a.minor<b.minor?-1:1;
 if(a.kind==='text'&&b.kind==='text')return a.value===b.value?0:a.value<b.value?-1:1;
 return fail(`values of kind ${a.kind} are not ordered`);
}
