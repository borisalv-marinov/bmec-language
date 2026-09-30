import type {Program,Declaration,FunctionDeclaration,InterfaceDeclaration,ImplDeclaration} from '../ast/ast.js';
import {interfaceId,interfaceMethodId,implId,moduleId,symbolId,type FunctionId,type InterfaceId,type InterfaceMethodId,type ImplId,type ModuleId,type SymbolId} from '../identity.js';
import {enumType,modelType,primitive,recordType,type TypeRef} from '../types/type-ref.js';

export interface IndexedModule {readonly id:ModuleId;readonly file:string;readonly declarations:readonly SymbolId[]}
export interface IndexedInterface {readonly id:InterfaceId;readonly declaration:InterfaceDeclaration;readonly module:ModuleId;readonly methods:ReadonlyMap<string,InterfaceMethodId>}
export interface IndexedImpl {readonly id:ImplId;readonly declaration:ImplDeclaration;readonly module:ModuleId;readonly interfaceId:InterfaceId|undefined;readonly typeName:string;readonly type:TypeRef|undefined;readonly methodFunctions:ReadonlyMap<string,FunctionId>}
export interface DeclarationIndex {readonly modules:ReadonlyMap<ModuleId,IndexedModule>;readonly declarations:ReadonlyMap<SymbolId,Declaration>;readonly declarationSymbols:ReadonlyMap<object,SymbolId>;readonly interfaces:ReadonlyMap<InterfaceId,IndexedInterface>;readonly interfaceMethods:ReadonlyMap<InterfaceMethodId,{interfaceId:InterfaceId;name:string}>;readonly impls:ReadonlyMap<ImplId,IndexedImpl>;readonly functions:ReadonlyMap<FunctionId,FunctionDeclaration>}
export interface DeclarationIndexOptions {readonly resolveImplInterface?: (declaration:ImplDeclaration, interfaces:ReadonlyMap<InterfaceId,IndexedInterface>)=>InterfaceId|undefined; readonly moduleIdForFile?: (file:string)=>ModuleId}

/** Build an immutable, canonical declaration index before body analysis. */
export function buildDeclarationIndex(program:Program,functionIds?:ReadonlyMap<FunctionDeclaration,FunctionId>,options:DeclarationIndexOptions={}):DeclarationIndex {
 const modules=new Map<ModuleId,IndexedModule>(),declarations=new Map<SymbolId,Declaration>(),declarationSymbols=new Map<object,SymbolId>(),interfaces=new Map<InterfaceId,IndexedInterface>(),interfaceMethods=new Map<InterfaceMethodId,{interfaceId:InterfaceId;name:string}>(),impls=new Map<ImplId,IndexedImpl>(),functions=new Map<FunctionId,FunctionDeclaration>();
 const byName=new Map<string,InterfaceId>();const globalByName=new Map<string,InterfaceId|undefined>();const moduleDecls=new Map<ModuleId,SymbolId[]>();
 const moduleFor=(file:string)=>options.moduleIdForFile?.(file)??moduleId(file);
 for(const declaration of program.declarations){const file=declaration.span.start.file,mod=moduleFor(file),ordinal=moduleDecls.get(mod)?.length??0;const sid=symbolId(`${mod}:${declaration.kind}:${ordinal}`);declarations.set(sid,declaration);declarationSymbols.set(declaration,sid);const list=moduleDecls.get(mod)??[];list.push(sid);moduleDecls.set(mod,list);if(declaration.kind==='InterfaceDeclaration'){const iid=interfaceId(`${mod}::interface::${ordinal}`);const methods=new Map<string,InterfaceMethodId>();declaration.methods.forEach((method,methodOrdinal)=>{const mid=interfaceMethodId(`${iid}::method::${methodOrdinal}`);methods.set(method.name,mid);interfaceMethods.set(mid,{interfaceId:iid,name:method.name});});interfaces.set(iid,{id:iid,declaration,module:mod,methods});byName.set(`${mod}:${declaration.name}`,iid);}if(declaration.kind==='FunctionDeclaration'){const fid=functionIds?.get(declaration);if(fid)functions.set(fid,declaration);}}
 for(const indexed of interfaces.values()){const prior=globalByName.get(indexed.declaration.name);globalByName.set(indexed.declaration.name,prior===undefined&&globalByName.has(indexed.declaration.name)?undefined:(prior??indexed.id));}
 for(const declaration of program.declarations)if(declaration.kind==='ImplDeclaration'){const mod=moduleFor(declaration.span.start.file),iid=options.resolveImplInterface?.(declaration,interfaces)??byName.get(`${mod}:${declaration.interfaceName}`)??globalByName.get(declaration.interfaceName),ordinal=moduleDecls.get(mod)?.findIndex(sid=>declarations.get(sid)===declaration)??0,id=implId(`${mod}::impl::${ordinal}`),methodFunctions=new Map<string,FunctionId>();declaration.methods.forEach(method=>{const fid=functionIds?.get(method);if(fid){methodFunctions.set(method.name,fid);functions.set(fid,method);}});const type=concreteType(declaration.typeName,mod,moduleDecls.get(mod)??[],declarations);impls.set(id,{id,declaration,module:mod,interfaceId:iid,typeName:declaration.typeName,type,methodFunctions});}
 for(const [mod,ids] of moduleDecls)modules.set(mod,{id:mod,file:String(mod),declarations:ids});
 return {modules,declarations,declarationSymbols,interfaces,interfaceMethods,impls,functions};
}
function declarationName(declaration:Declaration):string{return declaration.kind==='StyleDeclaration'?declaration.name??'style':'name' in declaration?declaration.name:declaration.kind==='ApiDeclaration'?declaration.route:declaration.kind}
function concreteType(name:string,module:ModuleId,ids:readonly SymbolId[],declarations:ReadonlyMap<SymbolId,Declaration>):TypeRef|undefined {
 const entry=ids.map((sid,i)=>({sid,i,d:declarations.get(sid)})).find(x=>x.d&&'name' in x.d&&x.d.name===name);
 const d=entry?.d;
 if(d?.kind==='ModelDeclaration')return modelType(d.name,symbolId(`${module}:${d.kind}:${entry!.i}`));
 if(d?.kind==='RecordDeclaration')return recordType(d.name,symbolId(`${module}:${d.kind}:${entry!.i}`));
 if(d?.kind==='EnumDeclaration')return enumType(d.name,symbolId(`${module}:${d.kind}:${entry!.i}`),d.variants.map(v=>({name:v.name,payload:v.payload?primitive('text'):undefined})));
 return (['text','integer','number','money','boolean','date','datetime','id'] as string[]).includes(name)?primitive(name as any):undefined;
}
