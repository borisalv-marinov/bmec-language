import type {HttpProgram} from './ir.js';
import type {ProjectIR} from '../ir/ir.js';
import type {TypeRef} from '../types/type-ref.js';

type ClientSchemas=Pick<ProjectIR,'models'|'records'|'enums'>;

/** Derive deterministic client declarations directly from the server HTTP contract. */
export function generateClientBindings(program:HttpProgram, schemas?:ClientSchemas):string {
  const routes=[...program.routes].sort((a,b)=>a.id.localeCompare(b.id));
  const knownNames=new Set([
    ...(schemas?.models??[]).map(type=>type.name),
    ...(schemas?.records??[]).map(type=>type.name),
    ...(schemas?.enums??[]).map(type=>type.name),
  ]);
  const tsName=(name:string)=>safe(name);
  const tsType=(type:TypeRef):string=>{
    switch(type.kind){
      case 'optional': return `${tsType(type.inner)} | undefined`;
      case 'primitive': return type.name==='integer'?'bigint':type.name==='number'?'number':type.name==='boolean'?'boolean':'string';
      case 'list': return `Array<${tsType(type.element)}>`;
      case 'enum': return knownNames.has(type.name)?tsName(type.name):type.variants.length?type.variants.map(variant=>JSON.stringify(variant.name)).join(' | '):'string';
      case 'record':
      case 'model': return knownNames.has(type.name)?tsName(type.name):'Record<string, unknown>';
      default: return 'unknown';
    }
  };
  const fieldName=(name:string,prefix:string)=>prefix+name.replace(/[^A-Za-z0-9_$]/g,'_');
  const schemaDeclarations=[
    ...(schemas?.models??[]).map(type=>`export interface ${tsName(type.name)} { ${type.fields.map(field=>`${safe(field.name)}${field.required===false?'?':''}: ${field.typeRef?tsType(field.typeRef):'unknown'};`).join(' ')} }`),
    ...(schemas?.records??[]).map(type=>`export interface ${tsName(type.name)} { ${type.fields.map(field=>`${safe(field.name)}${field.required===false?'?':''}: ${field.typeRef?tsType(field.typeRef):'unknown'};`).join(' ')} }`),
    ...(schemas?.enums??[]).map(type=>`export type ${tsName(type.name)} = ${type.variants.length?type.variants.map(variant=>JSON.stringify(variant.name)).join(' | '):'string'};`),
  ];
  const bindings=routes.map(route=>{
    const fn=safe(route.id);
    const fields=[
      ...route.pathParams.map(p=>`${p.name}${p.required?'':'?'}:${tsType(p.type)}`),
      ...route.query.map(p=>`${p.name}${p.required?'':'?'}:${tsType(p.type)}`),
      ...route.headers.map(p=>`${fieldName(p.name,'header_')}${p.required?'':'?'}:${tsType(p.type)}`),
      ...(route.requestBody?[`body:${tsType(route.requestBody)}`]:[]),
    ].join('; ');
    const responseType=route.responseBody?tsType(route.responseBody):'unknown';
    let path='`'+route.path.replaceAll('`','\\`')+'`';
    for(const parameter of route.pathParams)path=path.replace(`:${parameter.name}`,`\${encodeURIComponent(String(params.${parameter.name}))}`);
    const query=route.query.map(parameter=>`if(params.${parameter.name} !== undefined) query.set(${JSON.stringify(parameter.name)}, String(params.${parameter.name}));`).join('');
    const headers=route.headers.map(parameter=>`if(params.${fieldName(parameter.name,'header_')} !== undefined) headers[${JSON.stringify(parameter.name)}] = String(params.${fieldName(parameter.name,'header_')});`).join('');
    return `export interface ${fn}Params { ${fields} }\nexport type ${fn}Response = ${responseType};\nexport async function ${fn}(params:${fn}Params, request:(method:${JSON.stringify(route.method)},path:string,body?:unknown,headers?:Record<string,string>)=>Promise<unknown>):Promise<${fn}Response>{ const query=new URLSearchParams(); ${query} const headers:Record<string,string>={}; ${headers} const path=${path}; const suffix=query.toString(); return await request(${JSON.stringify(route.method)},suffix ? path+'?'+suffix : path,${route.requestBody?'params.body':'undefined'},headers) as ${fn}Response; }`;
  });
  return [...schemaDeclarations, ...bindings].join('\n');
}
function safe(id:string):string{return id.replace(/[^A-Za-z0-9_$]/g,'_').replace(/^[^A-Za-z_$]/,'_$&')||'route';}
