import type {Program,Declaration,ModelDeclaration,RecordDeclaration,EnumDeclaration,FunctionDeclaration,Statement,InterfaceDeclaration,ImplDeclaration} from '../ast/ast.js';
import {diagnostic,type Diagnostic} from '../diagnostics/diagnostics.js';
import {analyzeFunctions,specializeGenericCallTypes,type AnalysisOptions,type CoreFunction} from '../core/analysis.js';
import {parseTypeRef,recordType,enumType,typeParameter,type TypeRef} from '../types/type-ref.js';
import {symbolId,functionId,type FunctionId,type SymbolId} from '../identity.js';
import type {DeclarationIndex} from './declaration-index.js';
import {buildDeclarationIndex} from './declaration-index.js';
import {validationRules,validationRuleAliases} from '../ui/validation-rules.js';

const scalarTypes=new Set(['text','number','integer','boolean','money','date','datetime','id','upload']);
const baseType=(t:string)=>t.endsWith('?')?t.slice(0,-1):t;
const knownType=(t:string,known:Set<string>):boolean=>scalarTypes.has(t)||known.has(t)||(t.endsWith('?')&&knownType(baseType(t),known))||(t.startsWith('list<')&&t.endsWith('>')&&knownType(t.slice(5,-1),known))||(/^[A-Za-z][A-Za-z0-9_-]*<.*>$/.test(t)&&known.has(t.slice(0,t.indexOf('<'))));

export interface SemanticContext { models?:ModelDeclaration[]; records?:RecordDeclaration[]; enums?:EnumDeclaration[]; functions?:FunctionDeclaration[]; interfaces?:InterfaceDeclaration[]; impls?:ImplDeclaration[]; functionIds?:Map<FunctionDeclaration,FunctionId>; symbolForDeclaration?: (declaration:{span:{start:{file:string}};name:string})=>SymbolId; lambdaPrefix?:string; index?:DeclarationIndex; resolveInterfaceId?: (name:string,file:string)=>import('../identity.js').InterfaceId|undefined }
export interface SemanticProgram { diagnostics:Diagnostic[]; functions:CoreFunction[]; typeRefs:Map<object,TypeRef>; resolveType:(source:string)=>TypeRef|undefined; functionIds?:Map<FunctionDeclaration,FunctionId>; index?:DeclarationIndex }

function declarationTypes(p:Program,context:SemanticContext){
  const declarations=[...(context.models??[]),...(context.records??[]),...(context.enums??[]),...p.declarations.filter((x):x is ModelDeclaration|RecordDeclaration|EnumDeclaration=>x.kind==='ModelDeclaration'||x.kind==='RecordDeclaration'||x.kind==='EnumDeclaration')];
  const named=new Map<string,ModelDeclaration|RecordDeclaration|EnumDeclaration>();for(const d of declarations)named.set(d.name,d);
  const identity=(d:{span:{start:{file:string}};name:string})=>context.index?.declarationSymbols.get(d as Declaration)??context.symbolForDeclaration?.(d)??symbolId(`${d.span.start.file}::${d.name}`);
  const resolveNamed=(name:string,args:readonly TypeRef[]=[]):TypeRef|undefined=>{const d=named.get(name);if(!d)return undefined;if(d.kind==='ModelDeclaration')return {kind:'model',name,symbol:identity(d)};if(d.kind==='RecordDeclaration')return recordType(name,identity(d),args);return enumType(name,identity(d),d.variants.map(v=>({name:v.name,payload:v.payload?resolveType(v.payload):undefined})),args)};
  const resolveType=(source:string)=>parseTypeRef(source,resolveNamed);
  const refs=new Map<object,TypeRef>();const remember=(node:object,source:string)=>{const type=resolveType(source);if(type)refs.set(node,type);return type};
  const declarationOwner=(d:{span:{start:{file:string}};name:string})=>functionId(`TYPE:${identity(d)}`);
  const declarationType=(d:RecordDeclaration|EnumDeclaration,text:string)=>{const generic=new Map(d.typeParameters.map((name,i)=>[name,typeParameter(declarationOwner(d),i,name)]));return generic.get(text)??parseTypeRef(text,(name,args)=>generic.get(name)??resolveNamed(name,args));};
  for(const d of declarations){if(d.kind==='ModelDeclaration'||d.kind==='RecordDeclaration')for(const f of d.fields){const type=d.kind==='RecordDeclaration'?declarationType(d,f.type):resolveType(f.type);if(type)refs.set(f,type)}else for(const v of d.variants)if(v.payload){const type=declarationType(d,v.payload);if(type)refs.set(v,type)}}
  for(const d of p.declarations)if(d.kind==='FunctionDeclaration'){for(const parameter of d.parameters)remember(parameter,parameter.type);remember(d,d.returnType);walkStatements(d.body,statement=>{if(statement.kind==='LetStatement'&&statement.declaredType)remember(statement,statement.declaredType)})}
  return {resolveType,refs,identity};
}

export function analyzeProgram(p:Program,context:SemanticContext={}):SemanticProgram{
  const index=context.index??buildDeclarationIndex(p,context.functionIds);
  const interfaceDecls=[...(context.interfaces??[]),...p.declarations.filter((d):d is InterfaceDeclaration=>d.kind==='InterfaceDeclaration')];
  const interfaceNames=new Set<string>();const implKeys=new Set<string>();
  for(const iface of interfaceDecls){if(interfaceNames.has(iface.name)){} interfaceNames.add(iface.name);}
  for(const impl of [...(context.impls??[]),...p.declarations.filter((d):d is ImplDeclaration=>d.kind==='ImplDeclaration')]){const key=impl.interfaceName+'::'+impl.typeName;if(implKeys.has(key)){}implKeys.add(key);}
  // Interface declarations are compile-time contracts; implementations are lowered to ordinary functions.
  const implFunctions=p.declarations.filter((d):d is any=>d.kind==='ImplDeclaration').flatMap(d=>d.methods);
  // Impl methods are analysed as functions but never inserted into the source AST.
  // This keeps repeated/project analysis idempotent.
  const ds:Diagnostic[]=[];const models=new Map<string,ModelDeclaration>((context.models??[]).map(x=>[x.name,x]));const records=new Map<string,RecordDeclaration>((context.records??[]).map(x=>[x.name,x]));const enums=new Map<string,EnumDeclaration>((context.enums??[]).map(x=>[x.name,x]));const pages=new Set<string>();let apps=0;
  const known=new Set<string>([...models.keys(),...records.keys(),...enums.keys(),...p.declarations.filter(x=>x.kind==='ModelDeclaration'||x.kind==='RecordDeclaration'||x.kind==='EnumDeclaration').map(x=>x.name),...p.declarations.filter((x):x is RecordDeclaration|EnumDeclaration=>x.kind==='RecordDeclaration'||x.kind==='EnumDeclaration').flatMap(x=>x.typeParameters)]);
  for(const d of p.declarations){
    if(d.kind==='AppDeclaration'&&++apps>1)ds.push(diagnostic('PIPE-REF-002','Only one app declaration is allowed',d.span));
    if(d.kind==='AppDeclaration'&&d.metadata?.description!==undefined&&!d.metadata.description.trim())ds.push(diagnostic('PIPE-APP-001','App description must not be empty',d.metadataSpans?.description??d.span,{kind:'invalid_app_metadata',received:d.metadata.description}));
    if(d.kind==='AppDeclaration'&&d.metadata?.canonical){let valid=false;try{const url=new URL(d.metadata.canonical);valid=(url.protocol==='http:'||url.protocol==='https:')&&Boolean(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{}if(!valid)ds.push(diagnostic('PIPE-APP-002','Canonical URL must be an absolute http(s) URL without credentials, query, or fragment',d.metadataSpans?.canonical??d.span,{kind:'invalid_canonical_url',received:d.metadata.canonical}));}
    if(d.kind==='ModelDeclaration'){if(models.has(d.name))ds.push(diagnostic('PIPE-MODEL-001',`Duplicate model "${d.name}"`,d.span,{kind:'duplicate_model',received:d.name}));models.set(d.name,d);const fields=new Set<string>();for(const f of d.fields){if(fields.has(f.name))ds.push(diagnostic('PIPE-MODEL-002',`Duplicate field "${f.name}"`,f.span,{kind:'duplicate_field',path:`model.${d.name}.field`}));fields.add(f.name);if(!knownType(f.type,known)&&!p.declarations.some(x=>(x.kind==='ModelDeclaration'||x.kind==='RecordDeclaration')&&x.name===f.type))ds.push(diagnostic('PIPE-TYPE-001',`Unknown type "${f.type}"`,f.span,{kind:'unknown_type',received:f.type,suggestions:[...scalarTypes]}));for(const m of f.modifiers)if(m.kind==='default'&&!validDefault(f.type,m.value))ds.push(diagnostic('PIPE-TYPE-002',`Invalid default for ${f.type}`,f.span,{kind:'invalid_default',received:String(m.value)}));}}
    if(d.kind==='RecordDeclaration'){if(records.has(d.name)||models.has(d.name))ds.push(diagnostic('PIPE-TYPE-017',`Duplicate record type "${d.name}"`,d.span,{kind:'duplicate_record_type',received:d.name}));records.set(d.name,d);known.add(d.name);const fields=new Set<string>();for(const f of d.fields){if(fields.has(f.name))ds.push(diagnostic('PIPE-MODEL-002',`Duplicate field "${f.name}"`,f.span,{kind:'duplicate_field',path:`type.${d.name}.field`}));fields.add(f.name);if(!knownType(f.type,known)&&!p.declarations.some(x=>(x.kind==='ModelDeclaration'||x.kind==='RecordDeclaration')&&x.name===f.type))ds.push(diagnostic('PIPE-TYPE-001',`Unknown type "${f.type}"`,f.span,{kind:'unknown_type',received:f.type}))}}
    if(d.kind==='EnumDeclaration'){if(enums.has(d.name)||records.has(d.name)||models.has(d.name))ds.push(diagnostic('PIPE-TYPE-019',`Duplicate enum type "${d.name}"`,d.span,{kind:'duplicate_enum_type',received:d.name}));enums.set(d.name,d);known.add(d.name);const variants=new Set<string>();for(const v of d.variants){if(variants.has(v.name))ds.push(diagnostic('PIPE-TYPE-020',`Duplicate enum variant "${v.name}"`,v.span,{kind:'duplicate_enum_variant',received:v.name}));variants.add(v.name);if(v.payload&&!knownType(v.payload,known))ds.push(diagnostic('PIPE-TYPE-001',`Unknown enum payload type "${v.payload}"`,v.span,{kind:'unknown_type',received:v.payload}))}}
  }
  const indexNames=new Set<string>(),indexDefinitions=new Set<string>();
  for(const declaration of p.declarations)if(declaration.kind==='IndexDeclaration'){
    const model=p.declarations.find(candidate=>candidate.kind==='ModelDeclaration'&&candidate.name===declaration.model);
    if(!model||model.kind!=='ModelDeclaration'){ds.push(diagnostic('PIPE-DB-IR-001',`Index "${declaration.name}" references unknown model "${declaration.model}"`,declaration.span,{kind:'unknown_index_model',received:declaration.model}));continue;}
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(declaration.name))ds.push(diagnostic('PIPE-DB-IR-001',`Index name "${declaration.name}" must be a SQL identifier`,declaration.span,{kind:'invalid_index_name',received:declaration.name}));
    if(indexNames.has(declaration.name))ds.push(diagnostic('PIPE-DB-IR-001',`Duplicate index name "${declaration.name}"`,declaration.span,{kind:'duplicate_index_name',received:declaration.name}));indexNames.add(declaration.name);
    if(!declaration.fields.length||new Set(declaration.fields).size!==declaration.fields.length)ds.push(diagnostic('PIPE-DB-IR-001',`Index "${declaration.name}" must list unique fields`,declaration.span,{kind:'invalid_index_fields',received:declaration.fields.join(', ')}));
    const definition=JSON.stringify([model.name,declaration.fields]);if(indexDefinitions.has(definition))ds.push(diagnostic('PIPE-DB-IR-001',`Index "${declaration.name}" duplicates an existing index definition`,declaration.span,{kind:'duplicate_index_definition',received:declaration.model}));indexDefinitions.add(definition);
    for(const field of declaration.fields)if(!model.fields.some(candidate=>candidate.name===field))ds.push(diagnostic('PIPE-DB-IR-001',`Index "${declaration.name}" references unknown field "${model.name}.${field}"`,declaration.span,{kind:'unknown_index_field',received:field}));
  }  for(const d of p.declarations)if(d.kind==='PageDeclaration'){if(pages.has(d.name))ds.push(diagnostic('PIPE-REF-003',`Duplicate page "${d.name}"`,d.span,{kind:'duplicate_page',received:d.name}));pages.add(d.name);const names=new Set<string>();const events=new Set<string>();for(const c of d.statements){if(c.kind==='CrudStatement'&&!models.has(c.model))ds.push(diagnostic('PIPE-REF-001',`Unknown model "${c.model}"`,c.span,{node:`page.${d.name}`,path:`page.${d.name}.crud`,kind:'unknown_reference',received:c.model}));if(c.kind!=='CrudStatement'&&c.kind!=='PageListDeclaration'&&c.kind!=='PageUseStyleDeclaration'&&c.kind!=='PageLinkDeclaration'&&c.kind!=='PageFeedbackDeclaration'&&c.kind!=='PageDialogDeclaration'&&names.has(c.name))ds.push(diagnostic('PIPE-UI-001',`Duplicate page member "${c.name}"`,c.span,{kind:'duplicate_page_member',received:c.name}));if(c.kind!=='CrudStatement'&&c.kind!=='PageListDeclaration'&&c.kind!=='PageUseStyleDeclaration'&&c.kind!=='PageLinkDeclaration'&&c.kind!=='PageFeedbackDeclaration'&&c.kind!=='PageDialogDeclaration')names.add(c.name);if(c.kind==='PageEventDeclaration')events.add(c.name);if(c.kind==='PageStateDeclaration'&&!knownType(c.type,known)||c.kind==='PageInputDeclaration'&&!knownType(c.type,known))ds.push(diagnostic('PIPE-TYP-001',`Unknown page type "${c.type}"`,c.span,{kind:'unknown_type',received:c.type}));if(c.kind==='PageInputDeclaration'&&c.event&&!events.has(c.event))ds.push(diagnostic('PIPE-UI-002',`Unknown page input event "${c.event}"`,c.span,{kind:'unknown_page_event',received:c.event}));}}
  for (const page of p.declarations) if (page.kind === 'PageDeclaration') {
    const states = page.statements.filter((item): item is import('../ast/ast.js').PageStateDeclaration => item.kind === 'PageStateDeclaration');
    const browserJsonType = (type: string, visiting = new Set<string>()): boolean => {
      if (type.endsWith('?')) return browserJsonType(type.slice(0, -1), visiting);
      if (type.startsWith('list<') && type.endsWith('>')) return browserJsonType(type.slice(5, -1), visiting);
      if (scalarTypes.has(type)) return type !== 'upload';
      if (enums.has(type)) return true;
      const declaration = models.get(type) ?? records.get(type);
      if (!declaration) return false;
      if (visiting.has(type)) return true;
      const next = new Set(visiting); next.add(type);
      return declaration.fields.every(field => browserJsonType(field.type, next));
    };
    for (const state of states) {
      if (state.persisted && state.source) ds.push(diagnostic('PIPE-UI-020', `Page state "${state.name}" cannot combine browser persistence with a remote GET source`, state.span, { kind: 'persisted_remote_state', received: state.name }));
      if (state.persisted && !browserJsonType(state.type)) ds.push(diagnostic('PIPE-UI-020', `Page state "${state.name}" has a type that cannot be stored as validated browser JSON`, state.span, { kind: 'non_json_persisted_state', received: state.type }));
    }
    for (const event of page.statements) if (event.kind === 'PageEventDeclaration' && event.stateUpdate) {
      const state = states.find(candidate => candidate.name === event.stateUpdate!.state);
      const parameter = event.parameters.find(candidate => candidate.name === event.stateUpdate!.parameter);
      const elementType = state?.type.startsWith('list<') && state.type.endsWith('>') ? state.type.slice(5, -1) : undefined;
      const projection = event.stateUpdate.projection;
      if (event.action) ds.push(diagnostic('PIPE-UI-021', `Event "${event.name}" cannot combine a browser state update with a server action`, event.span, { kind: 'mixed_ui_event_effects', received: event.name }));
      if (!state || !elementType || !parameter || (!projection && parameter.type !== elementType)) ds.push(diagnostic('PIPE-UI-021', `Event "${event.name}" must name a list state and a parameter whose type matches its list item`, event.span, { kind: 'invalid_ui_state_update', received: event.stateUpdate.state, expected: elementType }));
      if (projection) {
        const target = models.get(projection.typeName) ?? records.get(projection.typeName);
        const targetFields = target?.fields ?? [];
        const provided = new Map(projection.fields.map(field => [field.name, field]));
        let valid = event.stateUpdate.operation === 'append' && projection.typeName === elementType && Boolean(target) && Boolean(parameter);
        if (provided.size !== projection.fields.length || provided.size !== targetFields.length || targetFields.some(field => !provided.has(field.name))) valid = false;
        for (const field of projection.fields) {
          const declaration = targetFields.find(candidate => candidate.name === field.name);
          if (!declaration) { valid = false; continue; }
          const value = field.value;
          let actualType: string | undefined;
          if (value.kind === 'FieldAccessExpression' && value.object.kind === 'IdentifierExpression' && value.object.name === event.stateUpdate.parameter) {
            const source = models.get(parameter?.type ?? '') ?? records.get(parameter?.type ?? '');
            actualType = source?.fields.find(candidate => candidate.name === value.field)?.type ?? (value.field === 'id' && models.has(parameter?.type ?? '') ? 'integer' : undefined);
          } else if (value.kind === 'IdentifierExpression' && (value.name === 'true' || value.name === 'false')) actualType = 'boolean';
          else if (value.kind === 'LiteralExpression') actualType = value.valueType;
          if (!actualType || actualType !== declaration.type && baseType(declaration.type) !== actualType && !(actualType === 'number' && declaration.type === 'integer' && value.kind === 'LiteralExpression' && Number.isInteger(value.value))) valid = false;
        }
        if (!valid) ds.push(diagnostic('PIPE-UI-023', `Event "${event.name}" has an invalid typed append projection`, projection.span, { kind: 'invalid_ui_state_projection', received: projection.typeName, expected: elementType }));
      }
      if (event.stateUpdate.field) {
        const declaration = models.get(elementType ?? '') ?? records.get(elementType ?? '');
        const fieldType = declaration?.fields.find(field => field.name === event.stateUpdate!.field)?.type;
        if (!fieldType || (fieldType !== 'integer' && fieldType !== 'number')) ds.push(diagnostic('PIPE-UI-021', `State update field "${event.stateUpdate.field}" must be a numeric field on the list item`, event.span, { kind: 'invalid_ui_state_update_field', received: event.stateUpdate.field, expected: 'integer or number' }));
      } else if (event.stateUpdate.operation === 'increment' || event.stateUpdate.operation === 'decrement') ds.push(diagnostic('PIPE-UI-021', `Event "${event.name}" must name the numeric field it updates`, event.span, { kind: 'missing_ui_state_update_field', received: event.name }));
      const rowButtons = page.statements.filter((statement): statement is import('../ast/ast.js').PageListDeclaration => statement.kind === 'PageListDeclaration').flatMap(list => {
        const component = p.declarations.find(candidate => candidate.kind === 'ComponentDeclaration' && candidate.name === list.component);
        return component?.kind === 'ComponentDeclaration' ? component.children.filter((child): child is import('../ast/ast.js').ComponentButtonDeclaration => child.kind === 'ComponentButtonDeclaration' && child.event === event.name && child.arguments !== undefined).map(button => ({ list, button })) : [];
      });
      const bound = rowButtons.some(({ list, button }) => {
        const argument = button.arguments?.length === 1 ? button.arguments[0] : undefined;
        if (!argument || argument.name !== event.stateUpdate!.parameter) return false;
        const parameter = event.parameters.find(candidate => candidate.name === argument.name);
        const [receiver, fieldName, extra] = argument.path.split('.');
        if (!parameter || receiver !== list.item || extra) return false;
        if (!fieldName) return parameter.type === (states.find(candidate => candidate.name === list.source)?.type.replace(/^list<|>$/g, '') ?? '');
        const source = states.find(candidate => candidate.name === list.source);
        const sourceType = source?.type.startsWith('list<') ? source.type.slice(5, -1) : '';
        const declaration = models.get(sourceType) ?? records.get(sourceType);
        return (declaration?.fields.find(field => field.name === fieldName)?.type ?? (fieldName === 'id' && models.has(sourceType) ? 'integer' : undefined)) === parameter.type;
      });
      if (!bound) ds.push(diagnostic('PIPE-UI-019', `State update event "${event.name}" must be bound to its typed list item from a repeated-row button`, event.span, { kind: 'missing_state_update_binding', received: event.name }));
    }
    for (const event of page.statements) if (event.kind === 'PageEventDeclaration' && event.successUpdate) {
      const state = states.find(candidate => candidate.name === event.successUpdate!.state);
      const isList = Boolean(state?.type.startsWith('list<') && state.type.endsWith('>'));
      if (!event.action || !state?.persisted || !isList || Boolean(state?.source))
        ds.push(diagnostic('PIPE-UI-024', `Event "${event.name}" may clear only a persisted list state after a typed HTTP action succeeds`, event.span, { kind: 'invalid_ui_success_update', received: event.successUpdate.state, expected: 'persisted list state and HTTP action' }));
    }
    const aggregateComponents = page.statements.flatMap(statement => statement.kind === 'PageUseDeclaration' ? [statement.component] : statement.kind === 'PageListDeclaration' ? [statement.component] : []);
    for (const componentName of aggregateComponents) {
      const component = p.declarations.find(candidate => candidate.kind === 'ComponentDeclaration' && candidate.name === componentName);
      if (component?.kind !== 'ComponentDeclaration') continue;
      for (const aggregate of component.children.filter((child): child is import('../ast/ast.js').ComponentAggregateDeclaration => child.kind === 'ComponentAggregateDeclaration')) {
        const source = states.find(candidate => candidate.name === aggregate.source);
        const itemType = source?.type.startsWith('list<') && source.type.endsWith('>') ? source.type.slice(5, -1) : undefined;
        const declaration = itemType ? models.get(itemType) ?? records.get(itemType) : undefined;
        const fieldType = (name: string) => { const type = declaration?.fields.find(field => field.name === name)?.type; return type ? baseType(type) : undefined; };
        const numeric = (name: string) => ['integer', 'number'].includes(fieldType(name) ?? '');
        const monetaryValue = fieldType(aggregate.field) === 'money';
        if (!source || !declaration || (!numeric(aggregate.field) && !monetaryValue) || (aggregate.multiplier && !numeric(aggregate.multiplier))) ds.push(diagnostic('PIPE-UI-022', `Total display must use numeric or money fields from a list state, such as "${aggregate.source}.${aggregate.field}"`, aggregate.span, { kind: 'invalid_ui_total', received: aggregate.source, expected: 'list with numeric or money fields' }));
      }
    }
  }
  for (const page of p.declarations) if (page.kind === 'PageDeclaration' && page.route) {
    const parameters = [...page.route.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
    const valid = page.route.startsWith('/') && !page.route.includes('?') && !/\/\//.test(page.route) && !page.route.split('/').slice(1).some(segment => !segment || (segment.startsWith(':') ? !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(segment) : !/^[A-Za-z0-9_-]+$/.test(segment))) && new Set(parameters).size === parameters.length;
    if (!valid) ds.push(diagnostic('PIPE-UI-017', `Page route "${page.route}" must use non-empty path segments and unique :parameter segments`, page.span, { kind: 'invalid_page_route', received: page.route }));
  }
  for(const page of p.declarations)if(page.kind==='PageDeclaration')for(const crud of page.statements)if(crud.kind==='CrudStatement'&&crud.excludedFields?.length){const model=models.get(crud.model);if(!model)continue;const seen=new Set<string>();for(const name of crud.excludedFields){if(seen.has(name)){ds.push(diagnostic('PIPE-UI-016',`CRUD field "${name}" is excluded more than once`,crud.span,{kind:'duplicate_crud_exclusion',received:name}));continue;}seen.add(name);const field=model.fields.find(candidate=>candidate.name===name);if(!field){ds.push(diagnostic('PIPE-UI-014',`Unknown field "${name}" on model "${crud.model}"`,crud.span,{kind:'unknown_crud_exclusion',received:name,suggestions:model.fields.map(candidate=>candidate.name)}));continue;}if(field.modifiers.some(modifier=>modifier.kind==='required'))ds.push(diagnostic('PIPE-UI-015',`Required field "${name}" cannot be excluded from generated CRUD`,crud.span,{kind:'required_crud_exclusion',received:name}));}}
  const routes=new Set<string>();for(const d of p.declarations)if(d.kind==='ApiDeclaration'){if(routes.has(d.route))ds.push(diagnostic('PIPE-API-001',`Duplicate API route "${d.route}"`,d.span,{kind:'duplicate_api_route',received:d.route}));routes.add(d.route);if(!models.has(d.model))ds.push(diagnostic('PIPE-API-002',`Unknown model "${d.model}"`,d.span,{kind:'unknown_reference',path:`api.${d.route}.model`,received:d.model}))}
  for(const d of p.declarations)if(d.kind==='HttpDeclaration'&&d.headers?.length){const fn=p.declarations.find(x=>x.kind==='FunctionDeclaration'&&x.name===d.handler);const names=new Set(fn?.kind==='FunctionDeclaration'?fn.parameters.map(parameter=>parameter.name):[]);const seen=new Set<string>();for(const name of d.headers){if(seen.has(name))ds.push(diagnostic('PIPE-HTTP-004',`Duplicate HTTP header parameter "${name}"`,d.span,{kind:'duplicate_header',received:name}));else if(!names.has(name))ds.push(diagnostic('PIPE-HTTP-004',`HTTP header "${name}" is not a parameter of handler "${d.handler}"`,d.span,{kind:'unknown_header_parameter',received:name,suggestions:[`Add a typed "${name}" parameter to ${d.handler}`]}));seen.add(name);}}
  const listModel = (type: string) => { const element = type.startsWith('list<') && type.endsWith('>') ? type.slice(5,-1) : ''; return p.declarations.find(candidate => (candidate.kind === 'ModelDeclaration' || candidate.kind === 'RecordDeclaration') && candidate.name === element); };
  const routeFieldType = (model: typeof p.declarations[number] | undefined, fieldName: string): string | undefined => model?.kind === 'ModelDeclaration' && fieldName === 'id' ? 'integer' : model?.kind === 'ModelDeclaration' || model?.kind === 'RecordDeclaration' ? model.fields.find(field => field.name === fieldName)?.type : undefined;
  for (const page of p.declarations) {
    if (page.kind !== 'PageDeclaration') continue;
    for (const state of page.statements) {
      if (state.kind !== 'PageStateDeclaration' || !state.source) continue;
      const path = state.source.path;
      let responseType: string | undefined;
      const api = p.declarations.find(declaration => declaration.kind === 'ApiDeclaration' && declaration.route === path);
      if (api?.kind === 'ApiDeclaration') responseType = `list<${api.model}>`;
      const route = p.declarations.find(declaration => declaration.kind === 'HttpDeclaration' && declaration.method === 'GET' && declaration.path === path);
      const sourceParameters = [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
      if (route?.kind === 'HttpDeclaration') {
        const handler = p.declarations.find(declaration => declaration.kind === 'FunctionDeclaration' && declaration.name === route.handler);
        if (handler?.kind === 'FunctionDeclaration' && handler.parameters.every(parameter => parameter.type.startsWith('capability<') || parameter.type === 'Principal' || sourceParameters.includes(parameter.name) && (parameter.type === 'text' || parameter.type === 'integer')))
          responseType = handler.returnType.startsWith('task<') && handler.returnType.endsWith('>') ? handler.returnType.slice(5, -1) : handler.returnType;
      }
      const placeholders = [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
      const pageParameters = [...(page.route ?? '').matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
      const handler = route?.kind === 'HttpDeclaration' ? p.declarations.find(declaration => declaration.kind === 'FunctionDeclaration' && declaration.name === route.handler) : undefined;
      const pathParametersValid = placeholders.length === 0 || pageParameters.length === placeholders.length && placeholders.every((name, index) => name === pageParameters[index]) && handler?.kind === 'FunctionDeclaration' && handler.parameters.filter(parameter => !parameter.type.startsWith('capability<') && parameter.type !== 'Principal').length === placeholders.length && placeholders.every(name => handler.parameters.some(parameter => parameter.name === name && (parameter.type === routeFieldType(listModel(state.type),name) || parameter.type === 'text' || parameter.type === 'integer')));
      const routePatternValid = path.startsWith('/') && !path.includes('?') && !/\/\//.test(path) && !path.split('/').slice(1).some(segment => !segment || (segment.startsWith(':') ? !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(segment) : !/^[A-Za-z0-9_-]+$/.test(segment))) && new Set(placeholders).size === placeholders.length;
      const valid = state.type.startsWith('list<') && state.type.endsWith('>') && routePatternValid && pathParametersValid && responseType === state.type;
      if (!valid) ds.push(diagnostic('PIPE-UI-011', `Page state source GET ${path} must match this page's route parameters and return exactly ${state.type}`, state.span, {
        kind: 'invalid_page_state_source', received: `${path} -> ${responseType ?? 'no compatible GET route'}`, expected: `GET route matching page parameters -> ${state.type}`,
      }));
      if (state.source.search) {
        const search = state.source.search;
        const searchPlaceholders = [...search.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
        const searchRoute = p.declarations.find(declaration => declaration.kind === 'HttpDeclaration' && declaration.method === 'GET' && declaration.path === search.path);
        const searchHandler = searchRoute?.kind === 'HttpDeclaration' ? p.declarations.find(declaration => declaration.kind === 'FunctionDeclaration' && declaration.name === searchRoute.handler) : undefined;
        const searchReturnType = searchHandler?.kind === 'FunctionDeclaration' ? searchHandler.returnType.startsWith('task<') && searchHandler.returnType.endsWith('>') ? searchHandler.returnType.slice(5, -1) : searchHandler.returnType : undefined;
        const sourceParameters = [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
        const sourceRoute = p.declarations.find(declaration => declaration.kind === 'HttpDeclaration' && declaration.method === 'GET' && declaration.path === path);
        const sourceHandler = sourceRoute?.kind === 'HttpDeclaration' ? p.declarations.find(declaration => declaration.kind === 'FunctionDeclaration' && declaration.name === sourceRoute.handler) : undefined;
        const searchParametersValid = searchHandler?.kind === 'FunctionDeclaration' && searchHandler.parameters.every(parameter => parameter.type.startsWith('capability<') || parameter.type === 'Principal' || parameter.name === search.parameter && parameter.type === 'text' || sourceParameters.includes(parameter.name) && sourceHandler?.kind === 'FunctionDeclaration' && parameter.type === sourceHandler.parameters.find(sourceParameter => sourceParameter.name === parameter.name)?.type) && searchHandler.parameters.some(parameter => parameter.name === search.parameter && parameter.type === 'text');
        const scopeParametersValid = sourceHandler?.kind === 'FunctionDeclaration' && sourceParameters.every(name => searchPlaceholders.includes(name) && searchHandler?.kind === 'FunctionDeclaration' && searchHandler.parameters.some(parameter => parameter.name === name && parameter.type === sourceHandler.parameters.find(sourceParameter => sourceParameter.name === name)?.type));
        const searchOnlyParameters = searchPlaceholders.filter(name => !sourceParameters.includes(name));
        const validSearch = search.method === 'GET' && search.path.startsWith('/') && !search.path.includes('?') && searchPlaceholders.length === sourceParameters.length + 1 && new Set(searchPlaceholders).size === searchPlaceholders.length && searchOnlyParameters.length === 1 && searchOnlyParameters[0] === search.parameter && searchRoute?.kind === 'HttpDeclaration' && !searchRoute.headers?.length && searchParametersValid && scopeParametersValid && searchReturnType === state.type;
        if (!validSearch) ds.push(diagnostic('PIPE-UI-013', `Page state search GET ${search.path} must accept one text search parameter and return exactly ${state.type}`, state.span, {
          kind: 'invalid_page_state_search', received: `${search.path} term ${search.parameter} -> ${searchReturnType ?? 'no compatible GET route'}`, expected: `GET list response ${state.type} with one text path parameter and server capabilities`,
        }));
      }
      const validateCursor = (next: { method: "GET"; path: string; parameter: string; cursorField: string }, searchParameter?: string) => {
        const placeholders = [...next.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
        const nextRoute = p.declarations.find(declaration => declaration.kind === 'HttpDeclaration' && declaration.method === 'GET' && declaration.path === next.path);
        const nextHandler = nextRoute?.kind === 'HttpDeclaration' ? p.declarations.find(declaration => declaration.kind === 'FunctionDeclaration' && declaration.name === nextRoute.handler) : undefined;
        const cursorParameter = nextHandler?.kind === 'FunctionDeclaration' ? nextHandler.parameters.find(parameter => parameter.name === next.parameter) : undefined;
        const cursorTypeName = state.type.startsWith('list<') && state.type.endsWith('>') ? state.type.slice(5, -1) : '';
        const cursorType = p.declarations.find(declaration => (declaration.kind === 'ModelDeclaration' || declaration.kind === 'RecordDeclaration') && declaration.name === cursorTypeName);
        const cursor = cursorType?.kind === 'ModelDeclaration' || cursorType?.kind === 'RecordDeclaration' ? cursorType.fields.find(field => field.name === next.cursorField) : undefined;
        const implicitModelId = cursorType?.kind === 'ModelDeclaration' && next.cursorField === 'id';
        const nextResponseType = nextHandler?.kind === 'FunctionDeclaration' ? nextHandler.returnType.startsWith('task<') && nextHandler.returnType.endsWith('>') ? nextHandler.returnType.slice(5, -1) : nextHandler.returnType : undefined;
        const sourceParameters = [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
        const sourceRoute = p.declarations.find(declaration => declaration.kind === 'HttpDeclaration' && declaration.method === 'GET' && declaration.path === path);
        const sourceHandler = sourceRoute?.kind === 'HttpDeclaration' ? p.declarations.find(declaration => declaration.kind === 'FunctionDeclaration' && declaration.name === sourceRoute.handler) : undefined;
        const allowedParameters = nextHandler?.kind === 'FunctionDeclaration' && nextHandler.parameters.every(parameter => parameter.type.startsWith('capability<') || parameter.type === 'Principal' || parameter.name === next.parameter || parameter.name === searchParameter || sourceParameters.includes(parameter.name));
        const cursorFieldType = implicitModelId ? 'integer' : cursor?.type;
        const supportedCursorType = cursorFieldType === 'text' || cursorFieldType === 'integer';
        const uniqueCursor = implicitModelId || cursor?.modifiers.some(modifier => modifier.kind === 'unique') === true;
        const expectedParameters = sourceParameters.length + (searchParameter ? 1 : 0) + 1;
        const sourceHandlerParamsValid = sourceHandler?.kind === 'FunctionDeclaration' && sourceParameters.every(name => placeholders.includes(name) && nextHandler?.kind === 'FunctionDeclaration' && nextHandler.parameters.some(parameter => parameter.name === name && parameter.type === sourceHandler.parameters.find(sourceParameter => sourceParameter.name === name)?.type));
        const cursorHandlerParamValid = nextHandler?.kind === 'FunctionDeclaration' && nextHandler.parameters.some(parameter => parameter.name === next.parameter && parameter.type === cursorFieldType);
        const searchHandlerParamValid = !searchParameter || nextHandler?.kind === 'FunctionDeclaration' && nextHandler.parameters.some(parameter => parameter.name === searchParameter && parameter.type === 'text');
        const validNext = next.method === 'GET' && next.path.startsWith('/') && !next.path.includes('?') && placeholders.length === expectedParameters && new Set(placeholders).size === placeholders.length && placeholders.includes(next.parameter) && (!searchParameter || placeholders.includes(searchParameter) && searchParameter !== next.parameter) && nextRoute?.kind === 'HttpDeclaration' && !nextRoute.headers?.length && nextHandler?.kind === 'FunctionDeclaration' && allowedParameters && sourceHandlerParamsValid && cursorHandlerParamValid && searchHandlerParamValid && supportedCursorType && cursorParameter?.type === cursorFieldType && uniqueCursor && nextResponseType === state.type;
        if (!validNext) ds.push(diagnostic('PIPE-UI-012', `Page state cursor GET ${next.path} must return ${state.type}, accept only the typed cursor parameters and server capabilities, and use a unique text or integer cursor field`, state.span, {
          kind: 'invalid_page_state_cursor', received: `${next.path} cursor ${next.parameter} by ${next.cursorField}`, expected: `GET list response ${state.type} with a matching cursor parameter${searchParameter ? ' and one text search parameter' : ''} and a unique text or integer cursor field`,
        }));
      };
      if (state.source.next) validateCursor(state.source.next);
      if (state.source.search?.next) validateCursor(state.source.search.next, state.source.search.parameter);
      if (state.source.search && state.source.next && !state.source.search.next) ds.push(diagnostic('PIPE-UI-013', `Search state "${state.name}" with a cursor requires a search-aware cursor GET route`, state.span, {
        kind: 'missing_page_search_cursor', received: state.source.search.path, expected: 'search GET with its own cursor continuation',
      }));
    }
  }
  const types=declarationTypes(p,{...context,index,symbolForDeclaration:context.symbolForDeclaration??((d)=>index.declarationSymbols.get(d)??symbolId(`${d.span.start.file}::${d.name}`))});const localFunctions=[...p.declarations.filter((d):d is FunctionDeclaration=>d.kind==='FunctionDeclaration'),...implFunctions];const localRecords=p.declarations.filter((d):d is RecordDeclaration=>d.kind==='RecordDeclaration');const localEnums=p.declarations.filter((d):d is EnumDeclaration=>d.kind==='EnumDeclaration');const resolveInterfaceId=context.resolveInterfaceId??((name:string,file:string)=>{const local=[...index.interfaces.values()].filter(x=>x.declaration.name===name&&x.declaration.span.start.file===file);if(local.length===1)return local[0]!.id;const global=[...index.interfaces.values()].filter(x=>x.declaration.name===name);return global.length===1?global[0]!.id:undefined});const options:AnalysisOptions={resolveType:types.resolveType,functionIds:context.functionIds,symbolForDeclaration:types.identity,lambdaPrefix:context.lambdaPrefix,resolveInterfaceId};const core=analyzeFunctions(localFunctions,[...localFunctions,...(context.functions??[])],[...models.values(),...records.values(),...localRecords,...localEnums,...enums.values()],options);ds.push(...core.diagnostics);return {diagnostics:ds,functions:core.functions,typeRefs:types.refs,resolveType:types.resolveType,functionIds:context.functionIds,index};
}
export function analyze(p:Program,context:SemanticContext={}):Diagnostic[]{return analyzeProgram(p,context).diagnostics;}
export function analyzeUI(p: Program): Diagnostic[] {
  const validationRepair = (rule: string | undefined): { type: string; value: string } | undefined => {
    const target = validationRuleAliases[rule as keyof typeof validationRuleAliases];
    return target ? { type: "validation", value: `Replace validation rule "${rule}" with "${target}"` } : undefined;
  };
  const known = new Set([
    ...p.declarations.filter((x) => x.kind === "ModelDeclaration" || x.kind === "RecordDeclaration" || x.kind === "EnumDeclaration").map((x) => x.name),
    "text", "number", "integer", "boolean", "money", "date", "datetime", "id",
  ]);
  const rules = new Set<string>(validationRules);
  const components = new Set(p.declarations.filter((x) => x.kind === "ComponentDeclaration").map((x) => x.name));
  const pages = new Set(p.declarations.filter((x) => x.kind === "PageDeclaration").map((x) => x.name));
  const out: Diagnostic[] = [];
  const pageByName = new Map(p.declarations.filter((x): x is import('../ast/ast.js').PageDeclaration => x.kind === 'PageDeclaration').map(page => [page.name, page]));
  const listModel = (type: string) => { const element = type.startsWith('list<') && type.endsWith('>') ? type.slice(5,-1) : ''; return p.declarations.find(candidate => (candidate.kind === 'ModelDeclaration' || candidate.kind === 'RecordDeclaration') && candidate.name === element); };
  const routeFieldType = (model: typeof p.declarations[number] | undefined, fieldName: string): string | undefined => model?.kind === 'ModelDeclaration' && fieldName === 'id' ? 'integer' : model?.kind === 'ModelDeclaration' || model?.kind === 'RecordDeclaration' ? model.fields.find(field => field.name === fieldName)?.type : undefined;
  const validateLink = (child: import('../ast/ast.js').PageLinkDeclaration) => {
    const target = pageByName.get(child.target);
    if (!target) return;
    const required = [...(target.route ?? '').matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
    const given = (child.parameters ?? []).map(parameter => parameter.name);
    if (new Set(given).size !== given.length || required.length !== given.length || required.some(name => !given.includes(name)))
      out.push(diagnostic('PIPE-UI-017', `Link to ${child.target} must supply each route parameter exactly once`, child.span, { kind: 'invalid_route_link_parameters', received: given.join(', '), expected: required.join(', ') }));
    for (const parameter of child.parameters ?? []) if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(parameter.path))
      out.push(diagnostic('PIPE-UI-017', `Route parameter "${parameter.name}" must bind from an item field such as post.slug`, child.span, { kind: 'invalid_route_link_binding', received: parameter.path }));
  };
  const validateComponentLinkFields = (component: import('../ast/ast.js').ComponentDeclaration) => {
    for (const link of component.children.filter((child): child is import('../ast/ast.js').PageLinkDeclaration => child.kind === 'PageLinkDeclaration' && Boolean(child.parameters?.length))) {
      const uses = p.declarations.filter((page): page is import('../ast/ast.js').PageDeclaration => page.kind === 'PageDeclaration').flatMap(page => page.statements.filter((statement): statement is import('../ast/ast.js').PageListDeclaration => statement.kind === 'PageListDeclaration' && statement.component === component.name).map(statement => ({ page, statement })));
      for (const parameter of link.parameters ?? []) {
        const [receiver, fieldName] = parameter.path.split('.');
        const valid = uses.length > 0 && uses.every(({ page, statement }) => {
          const state = page.statements.find(candidate => candidate.kind === 'PageStateDeclaration' && candidate.name === statement.source);
          const element = state?.kind === 'PageStateDeclaration' && state.type.startsWith('list<') ? state.type.slice(5, -1) : '';
          const model = p.declarations.find(candidate => (candidate.kind === 'ModelDeclaration' || candidate.kind === 'RecordDeclaration') && candidate.name === element);
          const fieldType = routeFieldType(model,fieldName ?? '');
          return receiver === statement.item && (fieldType === 'text' || fieldType === 'integer' && fieldName === 'id' && model?.kind === 'ModelDeclaration');
        });
        if (!valid) out.push(diagnostic('PIPE-UI-017', `Route link binding "${parameter.path}" must be a text field on the component's list item`, link.span, { kind: 'invalid_route_link_binding', received: parameter.path }));
      }
    }
  };
  for (const component of p.declarations) {
    if (component.kind !== "ComponentDeclaration") continue;
    validateComponentLinkFields(component);
    for (const child of component.children) {
      if (child.kind === "PageUseDeclaration" && !components.has(child.component))
        out.push(diagnostic("PIPE-UI-003", `Unknown component child "${child.component}"`, child.span, { kind: "unknown_component", received: child.component }));
      if (child.kind === "PageLinkDeclaration" && !pages.has(child.target))
        out.push(diagnostic("PIPE-UI-006", `Unknown navigation page "${child.target}"`, child.span, { kind: "unknown_navigation_page", received: child.target }));
      if (child.kind === "PageLinkDeclaration") validateLink(child);
      if (child.kind !== "PageInputDeclaration") continue;
      if (!known.has(child.type) && !child.type.endsWith("?"))
        out.push(diagnostic("PIPE-TYP-001", `Unknown component input type "${child.type}"`, child.span, { kind: "unknown_type", received: child.type }));
      if (child.validation && !rules.has(child.validation))
        out.push(diagnostic("PIPE-UI-004", `Unknown input validation rule "${child.validation}"`, child.span, {
          kind: "unknown_validation_rule", received: child.validation, expected: validationRules.join(", "),
          suggestions: [`Use one of: ${validationRules.join(", ")}.`], repair: validationRepair(child.validation),
        }));
    }
  }
  for (const page of p.declarations) {
    if (page.kind !== "PageDeclaration") continue;
    const states = new Map(
      page.statements.filter((statement) => statement.kind === "PageStateDeclaration")
        .map((statement) => statement.kind === "PageStateDeclaration" ? [statement.name, statement.type] as const : undefined)
        .filter((entry): entry is readonly [string, string] => Boolean(entry)),
    );
    const routeParameters = [...(page.route ?? '').matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
    if (routeParameters.length) for (const parameter of routeParameters) {
      const lists = page.statements.filter((statement): statement is import('../ast/ast.js').PageListDeclaration => statement.kind === 'PageListDeclaration');
      const valid = lists.length > 0 && lists.every(list => {
        const state = page.statements.find(statement => statement.kind === 'PageStateDeclaration' && statement.name === list.source);
        const stateType = state?.kind === 'PageStateDeclaration' ? state.type : '';
        const element = stateType.startsWith('list<') && stateType.endsWith('>') ? stateType.slice(5, -1) : '';
        const model = p.declarations.find(candidate => (candidate.kind === 'ModelDeclaration' || candidate.kind === 'RecordDeclaration') && candidate.name === element);
        const fieldType = routeFieldType(model,parameter);
        if (fieldType === 'text' || fieldType === 'integer' && parameter === 'id' && model?.kind === 'ModelDeclaration') return true;
        if (state?.kind !== 'PageStateDeclaration' || !state.source) return false;
        const route = p.declarations.find(declaration => declaration.kind === 'HttpDeclaration' && declaration.method === 'GET' && declaration.path === state.source!.path);
        const handler = route?.kind === 'HttpDeclaration' ? p.declarations.find(declaration => declaration.kind === 'FunctionDeclaration' && declaration.name === route.handler) : undefined;
        const parameterType = handler?.kind === 'FunctionDeclaration' ? handler.parameters.find(candidate => candidate.name === parameter)?.type : undefined;
        return [...state.source.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].some(match => match[1] === parameter) && (parameterType === 'text' || parameterType === 'integer');
      });
      if (!valid) out.push(diagnostic('PIPE-UI-017', `Dynamic page parameter "${parameter}" must match a text field in its list state`, page.span, { kind: 'invalid_route_state_binding', received: parameter }));
    }
    const events = new Set<string>();
    for (const child of page.statements) {
      if (child.kind === "PageEventDeclaration") events.add(child.name);
      if ((child.kind === "PageUseDeclaration" || child.kind === "PageListDeclaration") && !(child.kind === "PageListDeclaration" && child.bindingPath) && !components.has(child.component))
        out.push(diagnostic("PIPE-UI-003", `Unknown page component "${child.component}"`, child.span, { kind: "unknown_component", received: child.component }));
      if (child.kind === "PageLinkDeclaration" && !pages.has(child.target))
        out.push(diagnostic("PIPE-UI-006", `Unknown navigation page "${child.target}"`, child.span, { kind: "unknown_navigation_page", received: child.target }));
      if (child.kind === "PageLinkDeclaration") validateLink(child);
      if (child.kind === "PageListDeclaration" && (!states.has(child.source) || !states.get(child.source)!.startsWith("list<")))
        out.push(diagnostic("PIPE-UI-005", `Page list source "${child.source}" must be a declared list state`, child.span, { kind: "invalid_list_source", received: child.source }));
      if (child.kind === "PageListDeclaration" && child.empty !== undefined && !child.empty.trim())
        out.push(diagnostic("PIPE-UI-008", `Page list "${child.source}" empty state needs a message`, child.span, { kind: "empty_list_message" }));
      if (child.kind === "PageListDeclaration" && child.pageSize !== undefined && (!Number.isInteger(child.pageSize) || child.pageSize < 1 || child.pageSize > 100))
        out.push(diagnostic("PIPE-UI-010", `Page-list page size must be an integer from 1 to 100`, child.span, { kind: "invalid_page_size", received: String(child.pageSize), expected: "1..100" }));
      if (child.kind === "PageInputDeclaration" && child.event && !events.has(child.event))
        out.push(diagnostic("PIPE-UI-002", `Unknown page input event "${child.event}"`, child.span, { kind: "unknown_page_event", received: child.event }));
      if (child.kind === "PageInputDeclaration" && child.validation && !rules.has(child.validation))
        out.push(diagnostic("PIPE-UI-004", `Unknown input validation rule "${child.validation}"`, child.span, {
          kind: "unknown_validation_rule", received: child.validation, expected: validationRules.join(", "),
          suggestions: [`Use one of: ${validationRules.join(", ")}.`], repair: validationRepair(child.validation),
        }));
    }
    for (const list of page.statements) {
      if (list.kind !== "PageListDeclaration") continue;
      const component = p.declarations.find((candidate) => candidate.kind === "ComponentDeclaration" && candidate.name === list.component);
      const sourceDeclaration = page.statements.find((statement) => statement.kind === "PageStateDeclaration" && statement.name === list.source);
      const sourceType = sourceDeclaration?.kind === "PageStateDeclaration" ? sourceDeclaration.type : undefined;
      if (sourceDeclaration?.kind === "PageStateDeclaration" && sourceDeclaration.source?.search && !list.filterBy)
        out.push(diagnostic("PIPE-UI-013", `Server-side search state "${list.source}" requires a page-list filter field`, list.span, { kind: "missing_page_search_filter", received: list.source }));
      const elementType = sourceType?.startsWith("list<") && sourceType.endsWith(">") ? sourceType.slice(5, -1) : undefined;
      const typeDeclaration = p.declarations.find((candidate) => (candidate.kind === "ModelDeclaration" || candidate.kind === "RecordDeclaration") && candidate.name === elementType);
      if (!typeDeclaration || (typeDeclaration.kind !== "ModelDeclaration" && typeDeclaration.kind !== "RecordDeclaration")) {
        if (list.filterBy) out.push(diagnostic("PIPE-UI-009", `Filter field "${list.filterBy}" requires a list of records or models`, list.span, { kind: "invalid_list_filter_type", received: elementType ?? "unknown" }));
        continue;
      }
      const fields = new Set(typeDeclaration.fields.map((field) => field.name));
      if (list.filterBy) {
        const filterField = typeDeclaration.fields.find((field) => field.name === list.filterBy);
        if (!filterField)
          out.push(diagnostic("PIPE-UI-009", `Unknown page-list filter field "${list.filterBy}" on item type "${elementType}"`, list.span, { kind: "unknown_list_filter_field", received: list.filterBy, expected: [...fields].join(", ") }));
        else if (filterField.type !== "text")
          out.push(diagnostic("PIPE-UI-009", `Page-list filter field "${list.filterBy}" must have text type`, list.span, { kind: "invalid_list_filter_field_type", received: filterField.type, expected: "text" }));
      }
      if (list.bindingPath) {
        const [receiver, field] = list.bindingPath.split(".");
        if (receiver !== list.item)
          out.push(diagnostic("PIPE-UI-006", `UI binding receiver "${receiver}" is not the page-list item "${list.item}"`, list.span, { kind: "unknown_binding_receiver", received: receiver, expected: list.item }));
        else if (!field || !fields.has(field))
          out.push(diagnostic("PIPE-UI-007", `Unknown bound field "${field ?? ""}" on list item type "${elementType}"`, list.span, { kind: "unknown_binding_field", received: field ?? "", expected: [...fields].join(", ") }));
        continue;
      }
      if (!component || component.kind !== "ComponentDeclaration") continue;
      for (const child of component.children) {
        if (child.kind !== "ComponentBindingDeclaration") continue;
        const [receiver, field] = child.path.split(".");
        if (receiver !== list.item)
          out.push(diagnostic("PIPE-UI-006", `UI binding receiver "${receiver}" is not the page-list item "${list.item}"`, child.span, { kind: "unknown_binding_receiver", received: receiver, expected: list.item }));
        else if (!field || !fields.has(field))
          out.push(diagnostic("PIPE-UI-007", `Unknown bound field "${field ?? ""}" on list item type "${elementType}"`, child.span, { kind: "unknown_binding_field", received: field ?? "", expected: [...fields].join(", ") }));
      }
    }
  }
  const actionRoutes: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; bodyType?: string; pathParams?: { name: string; type: string }[]; unsupportedInputs?: string[]; hasRequiredIdempotencyKey?: boolean }[] = p.declarations.flatMap((declaration) => {
    if (declaration.kind === "HttpDeclaration") {
      const handler = p.declarations.find((candidate) => candidate.kind === "FunctionDeclaration" && candidate.name === declaration.handler);
      const handlerParameters = handler?.kind === "FunctionDeclaration" ? handler.parameters : [];
      const body = handlerParameters.find((parameter) => parameter.name === "body");
      const pathNames = new Set([...declaration.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]!));
      const headerNames = new Set(declaration.headers ?? []);
      const unsupportedInputs = handlerParameters.filter((parameter) => parameter !== body && !pathNames.has(parameter.name) && !headerNames.has(parameter.name) && !parameter.type.startsWith("capability<") && parameter.type !== "Principal" && !parameter.type.endsWith("?")).map((parameter) => parameter.name);
      if (headerNames.size) unsupportedInputs.push(...[...headerNames].filter((name) => name!=='idempotencyKey'&&!handlerParameters.find((parameter) => parameter.name === name)?.type.endsWith("?")));
      const idempotencyParameter=handlerParameters.find(parameter=>parameter.name==='idempotencyKey');
      return [{ method: declaration.method, path: declaration.path, bodyType: body?.type, pathParams: [...declaration.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match=>({name:match[1]!,type:handlerParameters.find(candidate=>candidate.name===match[1])?.type??''})), unsupportedInputs, hasRequiredIdempotencyKey:headerNames.has('idempotencyKey')&&idempotencyParameter?.type==='text' }];
    }
    if (declaration.kind === "ApiDeclaration") return p.declarations.some((candidate) => candidate.kind === "HttpDeclaration" && candidate.method === "POST" && candidate.path === declaration.route) ? [] : [{ method: "POST" as const, path: declaration.route, bodyType: declaration.model, pathParams: [], unsupportedInputs: [], hasRequiredIdempotencyKey:false }];
    return [];
  });
  for (const page of p.declarations) if (page.kind === "PageDeclaration") for (const event of page.statements) {
    if (event.kind !== "PageEventDeclaration" || !event.action) continue;
    const states = page.statements.filter((statement): statement is import('../ast/ast.js').PageStateDeclaration => statement.kind === 'PageStateDeclaration');
    const matches = actionRoutes.filter((route) => route.method === event.action!.method && route.path === event.action!.path);
    if (matches.length !== 1) {
      out.push(diagnostic("PIPE-UI-011", `UI action "${event.name}" must target exactly one declared ${event.action.method} route at "${event.action.path}"`, event.span, { kind: "unresolved_ui_action", received: `${event.action.method} ${event.action.path}` }));
      continue;
    }
    if(event.action.idempotencyKey&&(event.action.method!=='POST'||!matches[0]!.hasRequiredIdempotencyKey)){
      out.push(diagnostic('PIPE-UI-015',`UI action "${event.name}" requests retry-safe submission but the POST route must declare a required text "idempotencyKey" header`,event.span,{kind:'missing_idempotency_header',received:`${event.action.method} ${event.action.path}`}));
      continue;
    }
    if(!event.action.idempotencyKey&&matches[0]!.hasRequiredIdempotencyKey){
      out.push(diagnostic('PIPE-UI-015',`UI action "${event.name}" must declare "with idempotency key" for this route`,event.span,{kind:'missing_idempotency_action',received:`${event.action.method} ${event.action.path}`}));
      continue;
    }
    if (matches[0]!.unsupportedInputs?.length) {
      out.push(diagnostic("PIPE-UI-015", `UI action "${event.name}" cannot supply required route inputs outside its JSON body`, event.span, { kind: "unsupported_ui_route_inputs", received: matches[0]!.unsupportedInputs!.join(", ") }));
      continue;
    }
    const routeParameters=matches[0]!.pathParams??[];
    const routeParameterNames=new Set(routeParameters.map(parameter=>parameter.name));
    const missingRouteParameters=routeParameters.filter(parameter=>!event.parameters.some(candidate=>candidate.name===parameter.name&&candidate.type===parameter.type));
    const extraPathParameters=event.parameters.filter(parameter=>routeParameterNames.has(parameter.name)&&!routeParameters.some(routeParameter=>routeParameter.name===parameter.name&&routeParameter.type===parameter.type));
    if(missingRouteParameters.length||extraPathParameters.length){
      out.push(diagnostic('PIPE-UI-012',`UI action "${event.name}" parameters must include every route parameter with its declared type`,event.span,{kind:'ui_action_path_parameter_mismatch',received:`${event.action.method} ${event.action.path}`,expected:routeParameters.map(parameter=>`${parameter.name}: ${parameter.type}`).join(', ')}));
      continue;
    }
    const bodyType = matches[0]!.bodyType;
    const body = bodyType ? p.declarations.find((candidate) => (candidate.kind === "ModelDeclaration" || candidate.kind === "RecordDeclaration") && candidate.name === bodyType) : undefined;
    const fields = body && (body.kind === "ModelDeclaration" || body.kind === "RecordDeclaration") ? body.fields : undefined;
    const bodyParameters=event.parameters.filter(parameter=>!routeParameterNames.has(parameter.name));
    if (!fields || fields.length !== bodyParameters.length || fields.some((field) => {
      const parameter = bodyParameters.find((candidate) => candidate.name === field.name);
      return !parameter || parameter.type !== field.type;
    })) {
      out.push(diagnostic("PIPE-UI-012", `UI action "${event.name}" parameters must exactly match the declared route body fields and types`, event.span, { kind: "ui_action_body_mismatch", received: `${event.action.method} ${event.action.path}` }));
      continue;
    }
    const uses = page.statements.filter((statement) => statement.kind === "PageUseDeclaration");
    const forms = uses.flatMap((use) => {
      const component = p.declarations.find((candidate) => candidate.kind === "ComponentDeclaration" && candidate.name === use.component);
      return component?.kind === "ComponentDeclaration" && component.form && component.children.some((child) => child.kind === "ComponentButtonDeclaration" && child.event === event.name) ? [component] : [];
    });
    const listContexts = page.statements.filter((statement): statement is import('../ast/ast.js').PageListDeclaration => statement.kind === 'PageListDeclaration');
    const visibleComponents = new Set(page.statements.flatMap(statement => statement.kind === 'PageUseDeclaration' ? [statement.component] : statement.kind === 'PageListDeclaration' ? [statement.component] : []));
    const actionButtons = [...visibleComponents].flatMap(componentName => {
      const component = p.declarations.find(candidate => candidate.kind === 'ComponentDeclaration' && candidate.name === componentName);
      return component?.kind === 'ComponentDeclaration' ? component.children.filter((child): child is import('../ast/ast.js').ComponentButtonDeclaration => child.kind === 'ComponentButtonDeclaration' && child.event === event.name).map(button => ({ componentName, button })) : [];
    });
    const validBindingsFor = (componentName: string, button: import('../ast/ast.js').ComponentButtonDeclaration) => {
      const args = button.arguments ?? [];
      const names = new Set(args.map(argument => argument.name));
      if (names.size !== args.length || args.some(argument => !event.parameters.some(parameter => parameter.name === argument.name))) return false;
      return args.every(argument => {
        const parameter = event.parameters.find(candidate => candidate.name === argument.name);
        if (!parameter) return false;
        const pageState = states.find(candidate => candidate.name === argument.path);
        if (pageState) return pageState.type === parameter.type;
        return listContexts.some(list => {
          if (list.component !== componentName) return false;
          const source = states.find(candidate => candidate.name === list.source);
          const elementType = source?.type.startsWith('list<') && source.type.endsWith('>') ? source.type.slice(5, -1) : undefined;
          const itemType = p.declarations.find(candidate => (candidate.kind === 'ModelDeclaration' || candidate.kind === 'RecordDeclaration') && candidate.name === elementType);
          const [receiver, fieldName, extra] = argument.path.split('.');
          if (receiver !== list.item || extra) return false;
          if (!fieldName) return parameter.type === elementType;
          const field = itemType && (itemType.kind === 'ModelDeclaration' || itemType.kind === 'RecordDeclaration') ? itemType.fields.find(candidate => candidate.name === fieldName) : undefined;
          const fieldType = field?.type ?? (fieldName === 'id' && itemType?.kind === 'ModelDeclaration' ? 'integer' : undefined);
          return fieldType === parameter.type;
        });
      });
    };
    const validActionButtons = actionButtons.filter(({ componentName, button }) => validBindingsFor(componentName, button));
    const completeForm = (form: typeof forms[number], button: import('../ast/ast.js').ComponentButtonDeclaration) => {
      const bound = new Set((button.arguments ?? []).map(argument => argument.name));
      const required = event.parameters.filter(parameter => !bound.has(parameter.name));
      const inputs = form.children.filter((child) => child.kind === 'PageInputDeclaration');
      return inputs.length === required.length && inputs.every(input => required.some(parameter => parameter.name === input.name && parameter.type === input.type));
    };
    const actionHasSource = validActionButtons.some(({ button }) => {
      const bound = new Set((button.arguments ?? []).map(argument => argument.name));
      const remaining = event.parameters.filter(parameter => !bound.has(parameter.name));
      if (remaining.length === 0) return true;
      return forms.some(form => form.children.some(child => child.kind === 'ComponentButtonDeclaration' && child.event === event.name) && completeForm(form, button));
    });
    const invalidBindings = actionButtons.find(({ componentName, button }) => button.arguments?.length && !validBindingsFor(componentName, button));
    if (invalidBindings) out.push(diagnostic('PIPE-UI-019', `UI action "${event.name}" bindings must name event parameters and match a typed page state or repeated-list item`, invalidBindings.button.span, { kind: 'ui_action_binding_mismatch', received: event.name }));
    if (!actionHasSource) out.push(diagnostic("PIPE-UI-014", `UI action "${event.name}" needs typed inputs for its unbound parameters and typed bindings for any values supplied by page state or a repeated-list item`, event.span, { kind: "ui_action_form_mismatch", received: event.name }));
  }
  return out;
}
function validDefault(t:string,x:unknown){t=baseType(t);if(x===undefined)return true;if(t==='boolean')return typeof x==='boolean';if(['number','integer','money'].includes(t))return typeof x==='number';return typeof x==='string'}
function walkStatements(statements:Statement[],visit:(statement:Statement)=>void){for(const statement of statements){visit(statement);if(statement.kind==='IfStatement'){walkStatements(statement.thenBody,visit);if(statement.elseBody)walkStatements(statement.elseBody,visit)}else if(statement.kind==='ForStatement')walkStatements(statement.body,visit)}}
