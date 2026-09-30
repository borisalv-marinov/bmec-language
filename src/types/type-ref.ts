/** Canonical semantic types. These contain no host-language or transport concepts. */
import type {SymbolId, FunctionId, InterfaceId} from '../identity.js';
export type PrimitiveName = 'text'|'integer'|'number'|'money'|'boolean'|'date'|'datetime'|'id';
export type CapabilityName = 'http'|'database'|'environment'|'time'|'random'|'secureRandom'|'filesystem'|'email';
export interface PrimitiveType { readonly kind:'primitive'; readonly name:PrimitiveName }
export interface NoneType { readonly kind:'none' }
export interface OptionalType { readonly kind:'optional'; readonly inner:TypeRef }
export interface ListType { readonly kind:'list'; readonly element:TypeRef }
export interface RecordType { readonly kind:'record'; readonly symbol:SymbolId; readonly name:string; readonly typeArguments?:readonly TypeRef[] }
export interface ModelType { readonly kind:'model'; readonly symbol:SymbolId; readonly name:string }
export interface ResultType { readonly kind:'result'; readonly ok:TypeRef; readonly error:TypeRef }
export interface TaskType { readonly kind:'task'; readonly result:TypeRef }
export interface CapabilityType { readonly kind:'capability'; readonly name:CapabilityName }
export interface SecretType { readonly kind:'secret'; readonly inner:TypeRef }
export interface UploadType { readonly kind:'upload' }
export interface EnumVariantType { readonly name:string; readonly payload?:TypeRef }
export interface EnumType { readonly kind:'enum'; readonly symbol:SymbolId; readonly name:string; readonly variants:readonly EnumVariantType[]; readonly typeArguments?:readonly TypeRef[] }
export interface FunctionType { readonly kind:'function'; readonly parameters:readonly TypeRef[]; readonly returns:TypeRef }
export interface TypeParameterRef { readonly kind:'typeParameter'; readonly owner:FunctionId; readonly ordinal:number; readonly name:string; readonly constraints?:readonly InterfaceId[] }
export type TypeRef = PrimitiveType|NoneType|OptionalType|ListType|RecordType|ModelType|ResultType|TaskType|CapabilityType|SecretType|UploadType|EnumType|FunctionType|TypeParameterRef;

export const primitive=(name:PrimitiveName):PrimitiveType=>({kind:'primitive',name});
export const noneType=():NoneType=>({kind:'none'});
export const optionalType=(inner:TypeRef):OptionalType=>({kind:'optional',inner});
export const listType=(element:TypeRef):ListType=>({kind:'list',element});
export const recordType=(name:string,symbol:SymbolId,typeArguments?:readonly TypeRef[]):RecordType=>({kind:'record',name,symbol,...(typeArguments?.length?{typeArguments}: {})});
export const modelType=(name:string,symbol:SymbolId):ModelType=>({kind:'model',name,symbol});
export const resultType=(ok:TypeRef,error:TypeRef):ResultType=>({kind:'result',ok,error});
export const taskType=(result:TypeRef):TaskType=>({kind:'task',result});
export const capabilityType=(name:CapabilityName):CapabilityType=>({kind:'capability',name});
export const secretType=(inner:TypeRef):SecretType=>({kind:'secret',inner});
export const uploadType=():UploadType=>({kind:'upload'});
export const enumType=(name:string,symbol:SymbolId,variants:readonly EnumVariantType[],typeArguments?:readonly TypeRef[]):EnumType=>({kind:'enum',name,symbol,variants,...(typeArguments?.length?{typeArguments}: {})});
export const functionType=(parameters:readonly TypeRef[],returns:TypeRef):FunctionType=>({kind:'function',parameters,returns});
export const typeParameter=(owner:FunctionId,ordinal:number,name:string,constraints?:readonly InterfaceId[]):TypeParameterRef=>({kind:'typeParameter',owner,ordinal,name,...(constraints?.length?{constraints}:{})});

/** Replace owned type parameters without losing the structure of a semantic type. */
export function substituteType(type:TypeRef, substitutions:ReadonlyMap<string,TypeRef>):TypeRef {
  const key=(p:TypeParameterRef)=>`${p.owner}:${p.ordinal}`;
  switch(type.kind){
    case 'typeParameter': return substitutions.get(key(type))??type;
    case 'optional': return optionalType(substituteType(type.inner,substitutions));
    case 'list': return listType(substituteType(type.element,substitutions));
    case 'result': return resultType(substituteType(type.ok,substitutions),substituteType(type.error,substitutions));
    case 'task': return taskType(substituteType(type.result,substitutions));
    case 'capability': return type;
    case 'secret': return secretType(substituteType(type.inner,substitutions));
    case 'upload': return type;
    case 'function': return functionType(type.parameters.map(x=>substituteType(x,substitutions)),substituteType(type.returns,substitutions));
    case 'record': return recordType(type.name,type.symbol,type.typeArguments?.map(x=>substituteType(x,substitutions)));
    case 'model': return type;
    case 'enum': return enumType(type.name,type.symbol,type.variants.map(v=>({name:v.name,payload:v.payload?substituteType(v.payload,substitutions):undefined})),type.typeArguments?.map(x=>substituteType(x,substitutions)));
    default: return type;
  }
}

export function formatType(t:TypeRef):string {
  switch(t.kind){
    case 'primitive': return t.name;
    case 'none': return 'none';
    case 'optional': return `${formatType(t.inner)}?`;
    case 'list': return `list<${formatType(t.element)}>`;
    case 'record': return t.typeArguments?.length?`${t.name}<${t.typeArguments.map(formatType).join(',')}>`:t.name;
    case 'model': return t.name;
    case 'result': return `result<${formatType(t.ok)},${formatType(t.error)}>`;
    case 'task': return `task<${formatType(t.result)}>`;
    case 'capability': return `capability<${t.name}>`;
    case 'secret': return `secret<${formatType(t.inner)}>`;
    case 'upload': return 'upload';
    case 'enum': return t.typeArguments?.length?`${t.name}<${t.typeArguments.map(formatType).join(',')}>`:t.name;
    case 'function': return `(${t.parameters.map(formatType).join(',')}) -> ${formatType(t.returns)}`;
    case 'typeParameter': return t.name;
  }
}
export function isSameType(a:TypeRef,b:TypeRef):boolean {
  if(a.kind!==b.kind)return false;
  switch(a.kind){
    case 'primitive': return b.kind==='primitive'&&a.name===b.name;
    case 'none': return true;
    case 'optional': return b.kind==='optional'&&isSameType(a.inner,b.inner);
    case 'list': return b.kind==='list'&&isSameType(a.element,b.element);
    case 'record': return b.kind==='record'&&a.symbol===b.symbol&&(!a.typeArguments&&!b.typeArguments||Boolean(a.typeArguments&&b.typeArguments&&a.typeArguments.length===b.typeArguments.length&&a.typeArguments.every((x,i)=>isSameType(x,b.typeArguments![i]))));
    case 'model': return b.kind==='model'&&a.symbol===b.symbol;
    case 'result': return b.kind==='result'&&isSameType(a.ok,b.ok)&&isSameType(a.error,b.error);
    case 'task': return b.kind==='task'&&isSameType(a.result,b.result);
    case 'capability': return b.kind==='capability'&&a.name===b.name;
    case 'secret': return b.kind==='secret'&&isSameType(a.inner,b.inner);
    case 'upload': return b.kind==='upload';
    case 'enum': return b.kind==='enum'&&a.symbol===b.symbol&&(!a.typeArguments&&!b.typeArguments||Boolean(a.typeArguments&&b.typeArguments&&a.typeArguments.length===b.typeArguments.length&&a.typeArguments.every((x,i)=>isSameType(x,b.typeArguments![i]))));
    case 'function': return b.kind==='function'&&a.parameters.length===b.parameters.length&&a.parameters.every((x,i)=>isSameType(x,b.parameters[i]))&&isSameType(a.returns,b.returns);
    case 'typeParameter': return b.kind==='typeParameter'&&a.owner===b.owner&&a.ordinal===b.ordinal;
  }
}
export function isOptional(t:TypeRef):t is OptionalType{return t.kind==='optional'}
export function unwrapOptional(t:TypeRef):TypeRef{return t.kind==='optional'?t.inner:t}
export function asListElement(t:TypeRef):TypeRef|undefined{return t.kind==='list'?t.element:undefined}
export function isNumeric(t:TypeRef):boolean{return t.kind==='primitive'&&['integer','number','money'].includes(t.name)}
/** Assignment is intentionally distinct from equality: none inhabits any optional type. */
export function isAssignable(actual:TypeRef,expected:TypeRef):boolean {
  return actual.kind==='none' ? expected.kind==='optional' : actual.kind==='typeParameter' || expected.kind==='typeParameter' || isSameType(actual,expected) || (expected.kind==='optional'&&isSameType(actual,expected.inner));
}

/** Parse is used only at the AST -> semantic boundary. No later pass should call it. */
export function parseTypeRef(source:string,resolveNamed:(name:string,args?:readonly TypeRef[])=>TypeRef|undefined):TypeRef|undefined {
  let i=0;
  const skip=()=>{while(/\s/.test(source[i]??''))i++};
  const parse=():TypeRef|undefined=>{
    skip(); if(source[i]==='('){i++;const parameters:TypeRef[]=[];skip();while(source[i]!==')'){const parameter=parse();if(!parameter)return undefined;parameters.push(parameter);skip();if(source[i]===','){i++;skip()}else if(source[i]!==')')return undefined}i++;skip();if(source.slice(i,i+2)!=='->')return undefined;i+=2;const returns=parse();return returns?functionType(parameters,returns):undefined}
    skip(); const start=i; while(/[A-Za-z0-9_-]/.test(source[i]??''))i++;
    const name=source.slice(start,i); if(!name)return undefined;
    let out:TypeRef|undefined; const genericArgs:TypeRef[]=[]; skip(); if(name!=='list'&&name!=='result'&&name!=='task'&&source[i]==='<'){i++;skip();while(source[i]!=='>'){const arg=parse();if(!arg)return undefined;genericArgs.push(arg);skip();if(source[i]===','){i++;skip()}else if(source[i]!=='>' )return undefined}i++;}
    if(name==='list'){
      skip(); if(source[i++]!=='<')return undefined; const inner=parse(); skip(); if(source[i++]!=='>'||!inner)return undefined; out=listType(inner);
    } else if(name==='result'){
      skip(); if(source[i++]!=='<')return undefined; const ok=parse(); skip(); if(source[i++]!==',')return undefined; const err=parse(); skip(); if(source[i++]!=='>'||!ok||!err)return undefined; out=resultType(ok,err);
    } else if(name==='task'){
      skip(); if(source[i++]!=='<')return undefined; const result=parse(); skip(); if(source[i++]!=='>'||!result)return undefined; out=taskType(result);
    } else if(name==='capability'&&genericArgs.length===1&&genericArgs[0]?.kind==='capability') out=genericArgs[0];
    else if(name==='capability') out=undefined;
    else if(name==='secret'&&genericArgs.length===1) out=secretType(genericArgs[0]!);
    else if(name==='secret') out=undefined;
    else if(name==='upload'&&genericArgs.length===0) out=uploadType();
    else if((['http','database','environment','time','random','secureRandom','filesystem','email'] as string[]).includes(name)) out=capabilityType(name as CapabilityName);
    else out=resolveNamed(name,genericArgs) ?? ((['text','integer','number','money','boolean','date','datetime','id'] as string[]).includes(name) ? primitive(name as PrimitiveName) : undefined);
    skip(); if(source[i]==='?'){i++;if(out)out=optionalType(out)}
    return out;
  };
  const value=parse(); skip(); return value&&i===source.length?value:undefined;
}

export function typeRefFromUnknown(value:unknown):TypeRef|undefined {
  if(!value||typeof value!=='object')return undefined;
  const v=value as Record<string,unknown>;
  if(v.kind==='primitive'&&typeof v.name==='string'&&['text','integer','number','money','boolean','date','datetime','id'].includes(v.name))return primitive(v.name as PrimitiveName);
  if(v.kind==='none')return noneType();
  if(v.kind==='optional'){const inner=typeRefFromUnknown(v.inner);return inner?optionalType(inner):undefined}
  if(v.kind==='list'){const e=typeRefFromUnknown(v.element);return e?listType(e):undefined}
  if((v.kind==='record'||v.kind==='model')&&typeof v.symbol==='string'&&typeof v.name==='string'){const args=Array.isArray(v.typeArguments)?v.typeArguments.map(typeRefFromUnknown):undefined;if(args&&!args.every(Boolean))return undefined;return v.kind==='record'?recordType(v.name,v.symbol as SymbolId,args as TypeRef[]|undefined):modelType(v.name,v.symbol as SymbolId);}
  if(v.kind==='result'){const ok=typeRefFromUnknown(v.ok),error=typeRefFromUnknown(v.error);return ok&&error?resultType(ok,error):undefined}
  if(v.kind==='task'){const result=typeRefFromUnknown(v.result);return result?taskType(result):undefined}
  if(v.kind==='capability'&&['http','database','environment','time','random','secureRandom','filesystem','email'].includes(String(v.name)))return capabilityType(v.name as CapabilityName);
  if(v.kind==='secret'){const inner=typeRefFromUnknown(v.inner);return inner?secretType(inner):undefined}
  if(v.kind==='upload')return uploadType();
  if(v.kind==='enum'&&typeof v.symbol==='string'&&typeof v.name==='string'&&Array.isArray(v.variants)){const variants=v.variants.map((x:any)=>({name:x.name,payload:x.payload?typeRefFromUnknown(x.payload):undefined}));const args=Array.isArray(v.typeArguments)?v.typeArguments.map(typeRefFromUnknown):undefined;if(args&&!args.every(Boolean))return undefined;if(variants.every(x=>x.name&&(!x.payload||x.payload)))return enumType(v.name,v.symbol as SymbolId,variants,args as TypeRef[]|undefined)}
  if(v.kind==='function'&&Array.isArray(v.parameters)){const parameters=v.parameters.map(typeRefFromUnknown),returns=typeRefFromUnknown(v.returns);if(parameters.every(Boolean)&&returns)return functionType(parameters as TypeRef[],returns)}
  if(v.kind==='typeParameter'&&typeof v.owner==='string'&&typeof v.ordinal==='number'&&typeof v.name==='string'){const constraints=Array.isArray(v.constraints)&&v.constraints.every(x=>typeof x==='string')?v.constraints as InterfaceId[]:undefined;return typeParameter(v.owner as FunctionId,v.ordinal,v.name,constraints);}
  return undefined;
}
