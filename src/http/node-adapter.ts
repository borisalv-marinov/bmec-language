import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';
import type {HttpProgram} from './ir.js';
import type {ProjectIR} from '../ir/ir.js';
import {HttpRouter, type HttpContext, type HttpRequest, type HttpResponse} from './runtime.js';
import {CapabilityToken, type CapabilityKind} from '../runtime/capabilities.js';
import {executeAsyncValue, publicValue, DateValue, DateTimeValue, IdValue, Money, ListValue, RecordValue, ResultValue, VariantValue, NoneValue, PIPE_NONE, UploadValue} from '../core/interpreter.js';
import type {Value} from '../core/interpreter.js';
import {formatType,primitive, type TypeRef} from '../types/type-ref.js';
import type {SemanticValue} from '../runtime/value-contract.js';
import type {JsonRecordSchemas} from '../runtime/json.js';
import type {DbAdapter} from '../db/adapter.js';
import type {DbOperation,DbSchema} from '../db/ir.js';
import type {Principal} from '../runtime/authorization.js';
import {parseMultipart,type MultipartForm} from './multipart.js';
import type {RateLimitStore} from './rate-limit.js';
export {parseMultipart} from './multipart.js';

const readOnlyDatabaseAdapter=(adapter:DbAdapter):DbAdapter=>({
 execute<T>(operation:DbOperation,values:unknown[]=[]){if(['insert','update','delete','decrement'].includes(operation.kind))return Promise.reject(new Error('PIPE-NET-008: safe HTTP methods cannot mutate database state'));return adapter.execute<T>(operation,values);},
 transaction<T>(work:(adapter:DbAdapter)=>Promise<T>){return adapter.transaction(transaction=>work(readOnlyDatabaseAdapter(transaction)));},
});

export interface NodeHttpHandle {
  url: string;
  close(): Promise<void>;
}

export interface HttpLogEvent {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  outcome: 'response' | 'application_error' | 'adapter_error';
}

export interface NodeHttpOptions {
  host?: string;
  port?: number;
  maxBodyBytes?: number;
  maxHeaderBytes?: number;
  requireOriginForUnsafe?: boolean;
  requireJsonContentType?: boolean;
  contentSecurityPolicy?: string;
  strictTransportSecurity?: string;
  rateLimit?: {store:RateLimitStore;limit:number;windowMs:number};
  /** Extra browser origins accepted behind a trusted proxy or separate UI host. */
  allowedOrigins?: readonly string[];
  jsonRecordSchemas?: JsonRecordSchemas;
  suppliedCapabilities?: ReadonlySet<CapabilityKind>;
  capabilityTokens?: ReadonlyMap<CapabilityKind, CapabilityToken>;
  database?: {adapter: DbAdapter; schema: DbSchema};
  publicDirectory?: string;
  filesystemRoot?: string;
  email?: (message:{to:string;subject:string;body:string})=>Promise<void>|void;
  configureRouter?: (router: HttpRouter) => void;
  logger?: (event: HttpLogEvent) => void;
  /** Enable the host-owned liveness and readiness endpoints. */
  operations?: {readiness: () => boolean | Promise<boolean>};
  /** Keep legacy runtime diagnostics while sharing the typed router. */
  runtimeCompatibility?: boolean;
}

const jsonHeaders = {'content-type': 'application/json; charset=utf-8'};

async function readBody(request: IncomingMessage, limit: number): Promise<string | Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new Error('PIPE-NET-001: request body is too large');
    }
    chunks.push(buffer);
  }
  const body=Buffer.concat(chunks);
  if(body.length===0)return undefined;
  const contentType=String(request.headers['content-type']??'');
  return contentType.toLowerCase().startsWith('multipart/form-data')?body:body.toString('utf8');
}

function requestFromNode(request: IncomingMessage, body: string | Buffer | undefined, limit:number): HttpRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  const contentType=String(request.headers['content-type']??'');
  const multipart=Buffer.isBuffer(body)&&contentType.toLowerCase().startsWith('multipart/form-data')?parseMultipart(body,contentType,{maxFileBytes:limit}):undefined;
  return {
    method: request.method ?? 'GET',
    url: request.url ?? '/',
    headers,
    remoteAddress:request.socket.remoteAddress,
    body:multipart??body,
    ...(multipart?{multipart}:{}),
  };
}

function writeResponse(response: ServerResponse, result: HttpResponse, requestId?: string, policyHeaders:Readonly<Record<string,string>>={}): void {
  const headers: Record<string, string> = {...jsonHeaders, ...result.headers, ...securityHeaders, ...policyHeaders};
  if (requestId) headers['x-request-id'] = requestId;
  response.writeHead(result.status, headers);
  if (result.status === 204 || result.body === undefined) {
    response.end();
    return;
  }
  const contentType = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
  response.end(contentType.toLowerCase().startsWith('application/json') ? JSON.stringify(result.body) : String(result.body));
}

function safePublicFile(rootPath:string,name:string):string|undefined {
  try {
    const root=realpathSync(rootPath),parts=name.split('/');
    if(!parts.length||parts.some(part=>!part||part==='.'||part==='..'))return undefined;
    let current=root;
    for(const part of parts){current=resolve(current,part);if(lstatSync(current).isSymbolicLink())return undefined;}
    const canonical=realpathSync(current),rel=relative(root,canonical);
    if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||!lstatSync(canonical).isFile())return undefined;
    return canonical;
  } catch { return undefined; }
}

const securityHeaders:Record<string,string>={'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'DENY','permissions-policy':'camera=(), microphone=(), geolocation=()'};

/** Node transport adapter. BMEC routing, validation, policies, and contracts
 * remain owned by HttpRouter; Node only supplies bytes and socket lifecycle. */
export async function startNodeHttp(program: HttpProgram, configure?: (router: HttpRouter) => void, options: NodeHttpOptions = {}): Promise<NodeHttpHandle> {
  const allowedOrigins=new Set<string>();
  for(const origin of options.allowedOrigins??[]){let parsed:URL;try{parsed=new URL(origin)}catch{throw new Error('PIPE-NET-005: allowed origins must be canonical HTTP(S) origins')}if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)throw new Error('PIPE-NET-005: allowed origins must be canonical HTTP(S) origins');allowedOrigins.add(origin)}
  const router = new HttpRouter(program, options.suppliedCapabilities, options.jsonRecordSchemas);
  configure?.(router);
  const limit = options.maxBodyBytes ?? 1_000_000;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('PIPE-NET-002: invalid body limit');
  const headerLimit=options.maxHeaderBytes??16_384;
  if(!Number.isSafeInteger(headerLimit)||headerLimit<1024||headerLimit>65536)throw new Error('PIPE-NET-006: invalid header limit');
  for(const value of [options.contentSecurityPolicy,options.strictTransportSecurity])if(value!==undefined&&(/[\r\n]/.test(value)||!value.trim()))throw new Error('PIPE-NET-007: invalid security header value');
  const host = options.host ?? '127.0.0.1';
  const policyHeaders={...(options.contentSecurityPolicy?{'content-security-policy':options.contentSecurityPolicy}:{}),...(options.strictTransportSecurity?{'strict-transport-security':options.strictTransportSecurity}:{})};
  const server: Server = createServer({maxHeaderSize:headerLimit},async (request, response) => {
    const requestId = randomUUID();
    const started = performance.now();
    const path = new URL(request.url ?? '/', 'http://pipe.local').pathname;
    const safePath=path.split('/').map(segment=>segment.length>=24||/^[a-f0-9-]{24,}$/i.test(segment)?':redacted':segment).join('/');
    const log = (status: number, outcome: HttpLogEvent['outcome']) => options.logger?.({requestId, method: request.method ?? 'GET', path:safePath, status, durationMs: Math.max(0, Math.round(performance.now() - started)), outcome});
    try {
      if(options.operations&&(path==='/healthz'||path==='/readyz')){
        if(path==='/readyz'&&options.rateLimit){const result=await options.rateLimit.store.consume(`http:${request.socket.remoteAddress??'unknown'}`,options.rateLimit.limit,options.rateLimit.windowMs);if(!result.allowed){const denied={status:429,headers:{'retry-after':String(result.retryAfterSeconds),'cache-control':'no-store'},body:{error:'rate_limited'}};writeResponse(response,denied,requestId,policyHeaders);log(429,'response');return}}
        const ready=path==='/healthz'?true:await Promise.resolve().then(options.operations.readiness).catch(()=>false);
        const status=ready?200:503;
        writeResponse(response,{status,headers:{'cache-control':'no-store'},body:{status:ready?'ok':'unavailable'}},requestId,policyHeaders);
        log(status,'response');
        return;
      }
      if(options.rateLimit){const result=await options.rateLimit.store.consume(`http:${request.socket.remoteAddress??'unknown'}`,options.rateLimit.limit,options.rateLimit.windowMs);if(!result.allowed){const denied={status:429,headers:{'retry-after':String(result.retryAfterSeconds),'cache-control':'no-store'},body:{error:'rate_limited'}};writeResponse(response,denied,requestId,policyHeaders);log(429,'response');return}}
      const method=(request.method??'GET').toUpperCase(),origin=request.headers.origin;
      if(origin!==undefined&&!['GET','HEAD','OPTIONS'].includes(method)){
        let canonicalOrigin:string|undefined;try{const parsed=new URL(origin);if(['http:','https:'].includes(parsed.protocol)&&parsed.origin===origin)canonicalOrigin=parsed.origin}catch{}
        let requestOrigin:string|undefined;try{const protocol='encrypted' in request.socket&&request.socket.encrypted?'https:':'http:';if(request.headers.host)requestOrigin=new URL(`${protocol}//${request.headers.host}`).origin}catch{}
        if(!canonicalOrigin||canonicalOrigin!==requestOrigin&&!allowedOrigins.has(canonicalOrigin)){const denied={status:403,headers:{'content-type':'application/json'},body:{error:'untrusted_origin'}};writeResponse(response,denied,requestId,policyHeaders);log(403,'response');return}
      }
      if(options.requireOriginForUnsafe&&origin===undefined&&!['GET','HEAD','OPTIONS'].includes(method)&&!/^Bearer\s+[^\s]+$/i.test(String(request.headers.authorization??''))){const denied={status:403,headers:{},body:{error:'origin_required'}};writeResponse(response,denied,requestId,policyHeaders);log(403,'response');return}
      if (options.publicDirectory && (request.method === 'GET' || request.method === 'HEAD')) {
        const pathname = new URL(request.url ?? '/', 'http://pipe.local').pathname;
        const name = pathname === '/' ? 'index.html' : pathname.slice(1);
        const target=safePublicFile(options.publicDirectory,name);
        const publicNames = new Set(['index.html', 'app.js', 'pipe-release.json']);
        if (publicNames.has(name) && target) {
          const contentType = target.endsWith('.html') ? 'text/html; charset=utf-8' : target.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json; charset=utf-8';
          response.writeHead(200, {...securityHeaders,...policyHeaders,'content-type': contentType,'x-request-id':requestId});
          response.end(request.method === 'HEAD' ? undefined : readFileSync(target));
          log(200, 'response');
          return;
        }
      }
      const body = await readBody(request, limit);
      if(options.requireJsonContentType&&body!==undefined){const contentType=String(request.headers['content-type']??'').split(';',1)[0]!.trim().toLowerCase();if(contentType!=='application/json'&&!contentType.endsWith('+json')&&!contentType.startsWith('multipart/form-data')){const denied={status:415,headers:{},body:{error:'unsupported_media_type'}};writeResponse(response,denied,requestId,policyHeaders);log(415,'response');return}}
      const result = await router.dispatch(requestFromNode(request, body, limit));
      if(options.runtimeCompatibility&&result.status===404&&result.body&&typeof result.body==='object'&&(result.body as any).error==='not_found') {
        const message='Route not found';
        writeResponse(response,{...result,body:{error:{code:'PIPE-NET-004',kind:'route_not_found',message}}},requestId,policyHeaders);
      } else if(options.runtimeCompatibility&&result.status===400&&result.body&&typeof result.body==='object'&&String((result.body as any).error??'').includes('path_param')) {
        const message='Record id must be a non-negative integer';
        writeResponse(response,{...result,body:{error:message,diagnostic:{code:'PIPE-VAL-001',kind:'invalid_value',message}}},requestId,policyHeaders);
      } else {
        writeResponse(response, result, requestId,policyHeaders);
      }
      log(result.status, result.errorKind === 'application' ? 'application_error' : 'response');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PIPE-NET-003: request failed';
      const status = message.startsWith('PIPE-NET-001') ? 413 : 500;
      const diagnosticMessage=status===413?'Request body is too large':'Runtime failure';
      writeResponse(response, {status, headers: {}, body: options.runtimeCompatibility&&status===413?{error:'request_too_large',diagnostic:{code:'PIPE-NET-001',kind:'request_too_large',message:diagnosticMessage}}:{error: status === 413 ? 'request_too_large' : 'internal_error'}, errorKind: 'adapter'}, requestId,policyHeaders);
      log(status, 'adapter_error');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('PIPE-NET-004: server did not expose a TCP address');
  }
  let closePromise:Promise<void>|undefined;
  return {
    url: `http://${host}:${address.port}`,
    close: () => closePromise??=(new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))),
  };
}

function runtimeValue(type: TypeRef, value: unknown): unknown {
  if (type.kind === 'optional') return value === undefined ? PIPE_NONE : runtimeValue(type.inner, value);
  if (type.kind === 'primitive') {
    if (type.name === 'integer') return BigInt(String(value));
    if (type.name === 'number') return Number(value);
    if (type.name === 'boolean') return value === 'true' || value === true || value === 1 || value === 1n;
    if (type.name === 'date') return new DateValue(String(value));
    if (type.name === 'datetime') return new DateTimeValue(String(value));
    if (type.name === 'id') return new IdValue(String(value));
    if (type.name === 'money') return new Money(BigInt(String(value)));
    return String(value);
  }
  if (type.kind === 'list' && Array.isArray(value)) return new ListValue(value.map(item => runtimeValue(type.element, item)) as never[]);
  if (type.kind === 'record' || type.kind === 'model') { if (type.kind === 'model' && (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value))) return new RecordValue(new Map([['id', BigInt(String(value))]])); return value instanceof RecordValue ? value : new RecordValue(new Map(Object.entries((value ?? {}) as object)) as Map<string, Value>); }
  if (type.kind === 'result') return value instanceof ResultValue ? value : value;
  if (type.kind === 'enum') return value instanceof VariantValue ? value : value;
  return value;
}

function principalFieldValue(type:TypeRef,value:string|number|boolean|undefined):Value {
  if(type.kind==='optional')return value===undefined?new NoneValue():principalFieldValue(type.inner,value);
  if(type.kind!=='primitive'||value===undefined)throw new Error('PIPE-AUTHZ-005: principal field is unavailable or has an unsupported type');
  if(type.name==='text'&&typeof value==='string')return value;
  if(type.name==='boolean'&&typeof value==='boolean')return value;
  if(type.name==='integer'&&typeof value==='number'&&Number.isSafeInteger(value))return BigInt(value);
  if(type.name==='number'&&typeof value==='number'&&Number.isFinite(value))return value;
  throw new Error('PIPE-AUTHZ-005: principal field value does not match its declared type');
}

function principalRecordValue(type:Extract<TypeRef,{kind:'record'}>,principal:Principal,schemas:CoreSchemaMap|undefined):RecordValue {
  const schema=schemas?.[type.name];if(!schema)throw new Error(`PIPE-AUTHZ-005: principal record schema is unavailable for ${type.name}`);
  const fields=new Map<string,Value>();
  for(const [name,fieldType] of Object.entries(schema.fields))fields.set(name,principalFieldValue(fieldType,name==='id'?principal.id:principal.attributes[name]));
  return new RecordValue(fields,type);
}

function multipartRecordValue(type: Extract<TypeRef,{kind:'record'|'model'}>, form: MultipartForm, schemas: CoreSchemaMap): RecordValue {
  const schema=schemas[type.name];
  if(!schema) throw new Error(`PIPE-MULTIPART-007: multipart body schema is unavailable for ${type.name}`);
  const fields=new Map<string,Value>();
  for(const [fieldName,fieldType] of Object.entries(schema.fields)){
    const field={name:fieldName,type:fieldType};
    const files=form.files.filter(file=>file.fieldName===field.name);
    const values=form.fields[field.name]??[];
    const bind=(target:TypeRef, raw:unknown):Value=>{
      if(target.kind==='upload'){
        const file=files[0];
        if(!file) throw new Error(`PIPE-MULTIPART-007: multipart upload field "${field.name}" is required`);
        return new UploadValue(file.filename,file.mediaType,file.size,file.data);
      }
      if(target.kind==='list'){
        if(target.element.kind==='upload') return new ListValue(files.map(file=>new UploadValue(file.filename,file.mediaType,file.size,file.data)),target.element);
        return new ListValue((Array.isArray(raw)?raw:[]).map(item=>runtimeValue(target.element,item) as Value),target.element);
      }
      return runtimeValue(target,raw) as Value;
    };
    if(fieldType.kind==='optional'){
      const present=fieldType.inner.kind==='upload'||(fieldType.inner.kind==='list'&&fieldType.inner.element.kind==='upload')?files.length>0:values.length>0;
      fields.set(field.name,present?bind(fieldType.inner,fieldType.inner.kind==='list'?values:values[0]):new NoneValue());
    } else if(fieldType.kind==='list') fields.set(field.name,bind(fieldType,fieldType.element.kind==='upload'?files:values));
    else fields.set(field.name,bind(fieldType,fieldType.kind==='upload'?files[0]:values[0]));
  }
  return new RecordValue(fields,type);
}

type CoreSchemaMap=Record<string,{fields:Record<string,TypeRef>}>;

function semanticRuntimeValue(value: SemanticValue): unknown {
  switch (value.kind) {
    case 'integer': return value.value;
    case 'number': case 'text': case 'boolean': return value.value;
    case 'money': return new Money(value.minor);
    case 'date': return new DateValue(value.value);
    case 'datetime': return new DateTimeValue(value.value);
    case 'id': return new IdValue(value.value);
    case 'none': return new NoneValue();
    case 'optional': return value.inner === null ? new NoneValue() : semanticRuntimeValue(value.inner);
    case 'list': return new ListValue(value.items.map(semanticRuntimeValue) as never[], value.elementType);
    case 'record': case 'model': return new RecordValue(new Map(Object.entries(value.fields).map(([key, item]) => [key, semanticRuntimeValue(item) as Value])), value.type);
    case 'result': return new ResultValue(value.state, semanticRuntimeValue(value.state === 'ok' ? value.value : value.error) as never);
    case 'enum': return new VariantValue(formatType(value.type), value.variant, value.payload === undefined ? undefined : semanticRuntimeValue(value.payload) as never);
  }
}

function databaseParameterValue(value: Value): unknown {
  if (value instanceof NoneValue) return null;
  if (value instanceof RecordValue) { const id=value.fields.get('id'); if (id !== undefined) return databaseParameterValue(id); throw new Error('PIPE-DB-002: source API model references require an id field'); }
  if (value instanceof Money) return value.minor;
  if (value instanceof DateValue || value instanceof DateTimeValue || value instanceof IdValue) return value.value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  throw new Error('PIPE-DB-002: source API values must be scalar, optional, or null');
}

/** Start a real HTTP server whose route handlers are compiled BMEC functions.
 * The adapter injects only explicitly supplied opaque capabilities. */
export async function startNodeHttpSource(ir: ProjectIR, options: NodeHttpOptions = {}): Promise<NodeHttpHandle> {
  const tokens = options.capabilityTokens ?? new Map<CapabilityKind, CapabilityToken>();
  const supplied = new Set(options.suppliedCapabilities ?? []);
  for (const kind of tokens.keys()) supplied.add(kind);
  const sourceProgram = ir.http ?? {routes: []};
  const program = {routes:sourceProgram.routes.map(route=>route.method==='GET'&&route.status!==405?{...route,errorStatuses:[...new Set([...(route.errorStatuses??[]),405])]}:route)};
  return startNodeHttp(program, router => {
    for (const route of program.routes) {
      const sourceApi = route.handlerId.match(/^SOURCE-API-(\d+):(get|create|read|update|delete)$/);
      if (sourceApi) {
        const api = ir.apis[Number(sourceApi[1]) - 1];
        const model = api && ir.db?.models.find(candidate => candidate.name === api.model);
        if (model && options.database) {
          router.register(route.handlerId, async (request, params) => {
            const operation = sourceApi[2];
            const select = async (where?: {kind:'compare';field:string;operator:'=';value:TypeRef}, values:unknown[] = []) => {
              const result = await options.database!.adapter.execute<Record<string, unknown>>({kind:'select',model:model.name,modelId:model.id,fields:model.fields.map(field=>field.name),where},values);
              return result.rows.map(row => Object.fromEntries(model.fields.flatMap(field => { const raw=row[field.name]; return raw===undefined||raw===null?[]:[[field.name,publicValue(runtimeValue(field.type,raw) as Value)]]; })));
            };
            if (operation === 'get') return {status: route.status, headers: {}, body: await select()};
            const id = params.id === undefined ? undefined : BigInt(params.id);
            const where = id === undefined ? undefined : {kind:'compare' as const,field:'id',operator:'=' as const,value:primitive('integer')};
            if (operation === 'read') { const rows=await select(where,[id]); return rows.length?{status:route.status,headers:{},body:rows[0]}:{status:404,headers:{},body:{error:'not_found'}}; }
            if (operation === 'delete') { const result=await options.database!.adapter.execute({kind:'delete',model:model.name,modelId:model.id,where},[id]); return result.rowCount?{status:route.status,headers:{},body:result.rowCount}:{status:404,headers:{},body:{error:'not_found'}}; }
            const body=request.body as SemanticValue|undefined;
            const record=body&&typeof body==='object'&&('kind' in body)?semanticRuntimeValue(body):undefined;
            if (!(record instanceof RecordValue)) throw new Error('PIPE-DB-002: source API model body is required');
            const values:Record<string,TypeRef>={}, parameters:unknown[]=[];
            for (const field of model.fields) { const value=record.fields.get(field.name); if (value!==undefined && field.name!=='id') { values[field.name]=field.type; parameters.push(databaseParameterValue(value)); } }
            if (operation === 'create') { const result=await options.database!.adapter.execute({kind:'insert',model:model.name,modelId:model.id,values},parameters); return {status:route.status,headers:{},body:result.rowCount}; }
            if (!Object.keys(values).length) throw new Error('PIPE-DB-002: source API update requires a non-primary-key value');
            parameters.push(id); const result=await options.database!.adapter.execute({kind:'update',model:model.name,modelId:model.id,values,where},parameters); return result.rowCount?{status:route.status,headers:{},body:result.rowCount}:{status:404,headers:{},body:{error:'not_found'}};
          });
        }
        continue;
      }
      const fn = ir.functions.find(candidate => String(candidate.id) === route.handlerId);
      if (!fn) continue;
      router.register(route.handlerId, async (request, params, context:HttpContext) => {
        const sourceRoute=sourceProgram.routes.find(candidate=>candidate.handlerId===route.handlerId)??route;
        const args = fn.parameters.map(parameter => {
          if(route.principalParam===parameter.name){
            if(parameter.typeRef.kind!=='record'||!context.principal)throw new Error('PIPE-AUTH-002: authenticated principal required');
            return principalRecordValue(parameter.typeRef,context.principal,fn.recordSchemas as CoreSchemaMap|undefined);
          }
          if (parameter.typeRef.kind === 'capability') return tokens.get(parameter.typeRef.name);
          if (parameter.name === 'body' && route.requestBody?.kind==='upload') {
            const file=request.multipart?.files[0];
            if(!file) throw new Error('PIPE-UPLOAD-002: multipart upload file is required');
            return new UploadValue(file.filename,file.mediaType,file.size,file.data);
          }
          if (parameter.name === 'body' && route.requestBody?.kind==='list' && route.requestBody.element.kind==='upload') {
            return (request.multipart?.files??[]).map(file=>new UploadValue(file.filename,file.mediaType,file.size,file.data));
          }
          if (parameter.name === 'body' && request.multipart && route.requestBody && (route.requestBody.kind==='record'||route.requestBody.kind==='model')) {
            return multipartRecordValue(route.requestBody,request.multipart,(fn.recordSchemas??{}) as unknown as CoreSchemaMap);
          }
          if (parameter.name === 'body' && route.requestBody !== undefined) {
            return request.body && typeof request.body === 'object' && 'kind' in request.body
              ? semanticRuntimeValue(request.body as SemanticValue)
              : runtimeValue(parameter.typeRef, request.body);
          }
          return runtimeValue(parameter.typeRef, params[parameter.name] ?? params[`header:${parameter.name}`]);
        });
         const database=route.method==='GET'&&options.database?{...options.database,adapter:readOnlyDatabaseAdapter(options.database.adapter)}:options.database;
         const result = await executeAsyncValue(ir.functions, String(fn.id), args, {database,filesystemRoot: options.filesystemRoot,email: options.email,safeHttpMethod:route.method==='GET'});
        const status=result instanceof ResultValue&&result.state==='err'&&sourceRoute.errorStatuses?.length?sourceRoute.errorStatuses[0]!:sourceRoute.status;
        return {status, headers: {}, body: publicValue(result)};
      });
    }
    options.configureRouter?.(router);
  }, {...options, suppliedCapabilities: supplied, jsonRecordSchemas: sourceJsonSchemas(ir, options.jsonRecordSchemas)});
}

function sourceJsonSchemas(ir:ProjectIR,extra:JsonRecordSchemas={}):JsonRecordSchemas {
  const schemas:JsonRecordSchemas={...extra};
  for(const model of ir.models){
    const type=model.typeRef;
    if(type?.kind!=='model')continue;
    schemas[model.name]={symbol:type.symbol,kind:'model',fields:Object.fromEntries(model.fields.flatMap(field=>field.typeRef?[[field.name,field.typeRef]]:[]))};
  }
  for(const fn of ir.functions)Object.assign(schemas,fn.recordSchemas??{});
  return schemas;
}
