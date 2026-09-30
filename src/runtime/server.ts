import type {ProjectIR} from '../ir/ir.js';
import {PipeDatabase, RuntimeError, RuntimeValidationError, RuntimeMediaTypeError} from './database.js';
import {generate} from '../generator/generate.js';
import Database from 'better-sqlite3';
import {Pool, TypeOverrides} from 'pg';
import {sqliteAdapter} from '../db/adapter.js';
import {postgresPoolAdapter} from '../db/postgres.js';
import {startNodeHttpSource} from '../http/node-adapter.js';
import type {NodeHttpHandle} from '../http/node-adapter.js';
import type {HttpLogEvent} from '../http/node-adapter.js';
import {AuthService,MemoryUserStore,SessionStore} from './auth.js';
import type {SessionRepository,UserStore} from './auth.js';
import {PostgresSessionStore,PostgresUserStore,SqliteSessionStore,SqliteUserStore} from './auth-stores.js';
import {migratePostgresSchema} from './postgres-migration.js';
import {MemoryRateLimitStore,PostgresRateLimitStore,SqliteRateLimitStore} from '../http/rate-limit.js';
import {authenticatedSession,rolePolicy} from '../http/auth-policy.js';
import {registerAuthHandlers} from '../http/auth-handlers.js';
import {principalFromRequest} from './auth-http.js';
import {issueCapability, type CapabilityKind} from './capabilities.js';
import {bundleBrowserArtifact} from '../release/browser-bundle.js';
import type {HttpRoute} from '../http/ir.js';
import {primitive} from '../types/type-ref.js';

/** `database` is the synchronous SQLite compatibility handle. It is absent
 * when PostgreSQL is the selected runtime backend. */
export interface RuntimeHandle { url:string; close():Promise<void>; database?:PipeDatabase; }
export interface RuntimeAuthUser {id:string;password:string;role:string}
/** Host-owned durable credentials may be injected without exposing hashes or
 * session internals to BMEC source or browser artifacts. */
export interface RuntimeOptions {host?:string;authUsers?:readonly RuntimeAuthUser[];authUserStore?:UserStore;sessionStore?:SessionRepository;securityMode?:'development'|'production';maxBodyBytes?:number;maxHeaderBytes?:number;contentSecurityPolicy?:string;email?: (message:{to:string;subject:string;body:string})=>Promise<void>|void;defaultPolicy?:'none'|'authenticated'|`role:${string}`;postgresUrl?:string;allowedOrigins?:readonly string[];requestRateLimit?:{limit:number;windowMs:number};logger?:(event:HttpLogEvent)=>void}

function postgresDateTimeValue(value:string):string {
  const match=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-])(\d{2})(?::?(\d{2}))?$/.exec(value);
  if(!match)throw new Error('PIPE-DB-002: PostgreSQL returned an unsupported datetime value');
  const offset=`${match[4]}${match[5]}:${match[6]??'00'}`;
  const epoch=Date.parse(`${match[1]}T${match[2]}${offset}`);
  if(!Number.isFinite(epoch))throw new Error('PIPE-DB-002: PostgreSQL returned an invalid datetime value');
  return `${new Date(epoch).toISOString().slice(0,19)}${match[3]?`.${match[3]}`:''}Z`;
}

export async function startRuntime(ir:ProjectIR, outDir:string, dbFile:string, port=3000, options:RuntimeOptions={}):Promise<RuntimeHandle> {
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('PIPE-NET-009: port must be an integer from 0 through 65535');
  if (options.authUsers?.length||options.authUserStore||options.sessionStore||options.securityMode==='production') return startAuthenticatedRuntime(ir,outDir,dbFile,port,options);
  generate(ir,outDir); bundleBrowserArtifact(outDir); const database=new PipeDatabase(ir,dbFile); let sqlite:Database.Database;
  try {sqlite=new Database(dbFile)} catch(error) {database.close();throw error;}
  const routes:HttpRoute[]=[...(ir.http?.routes??[])];
  const aliasRoutes:(HttpRoute&{model:string;operation:string})[]=[];
  const addAlias=(path:string,model:string,operation:string,method:'GET'|'POST'|'PUT'|'DELETE',item=false)=>{
    const fullPath=item?`${path}/:id`:path;
    if(routes.some(route=>route.method===method&&route.path===fullPath)) return;
    const id=`BMEC-COMPAT-${aliasRoutes.length+1}`;
    const policyId=ir.apis.find(api=>api.model===model)?.policyId;
    const route:HttpRoute&{model:string;operation:string}={id,method,path:fullPath,pathParams:item?[{name:'id',type:primitive('integer'),required:true}]:[],query:[],headers:[],status:method==='POST'?201:method==='DELETE'?204:200,errorStatuses:[400,404,409,413,415],handlerId:id,model,operation,...(policyId?{policyId}:{})};
    aliasRoutes.push(route); routes.push(route);
  };
  for(const [index,model] of ir.models.entries()) { const path=`/api/${encodeURIComponent(model.name)}`; addAlias(path,model.name,'list','GET'); addAlias(path,model.name,'create','POST'); addAlias(path,model.name,'read','GET',true); addAlias(path,model.name,'update','PUT',true); addAlias(path,model.name,'delete','DELETE',true); }
  for(const api of ir.apis) { const path=api.route.startsWith('/api/')?api.route:`/api${api.route}`; addAlias(path,api.model,'list','GET'); addAlias(path,api.model,'create','POST'); addAlias(path,api.model,'read','GET',true); addAlias(path,api.model,'update','PUT',true); addAlias(path,api.model,'delete','DELETE',true); }
  const runtimeIR={...ir,http:{...(ir.http??{routes:[]}),routes}};
  const capabilityTokens=new Map<CapabilityKind,ReturnType<typeof issueCapability>>([['database',issueCapability('database')]]);if(routes.some(route=>route.capabilities?.includes('time')))capabilityTokens.set('time',issueCapability('time'));
  let shuttingDown=false;
  let handle:NodeHttpHandle;
  try {handle=await startNodeHttpSource(runtimeIR,{host:options.host,port,publicDirectory:outDir,runtimeCompatibility:true,capabilityTokens,database:{adapter:sqliteAdapter(sqlite,runtimeIR.db!,{safeIntegers:true,tablePrefix:'pipe_'}),schema:runtimeIR.db!},allowedOrigins:options.allowedOrigins,logger:options.logger,operations:{readiness:()=>!shuttingDown&&Number((sqlite.prepare('SELECT 1 AS ready').get() as {ready:number}).ready)===1},configureRouter:router=>{
    for(const policyId of new Set(routes.flatMap(route=>route.policyId?[route.policyId]:[]))) router.registerPolicy(policyId,()=>false);
    for(const route of aliasRoutes) router.register(route.handlerId,async(request,params)=>{ try {
      if((route.operation==='create'||route.operation==='update')&&request.headers?.['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json') throw new RuntimeMediaTypeError();
      const id=params.id===undefined?undefined:Number(params.id);
      let input:Record<string,unknown>={};
      if(route.operation==='create'||route.operation==='update') {
        try { const parsed=typeof request.body==='string'&&request.body?JSON.parse(request.body):{}; if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw new Error(); input=parsed as Record<string,unknown>; }
        catch { throw new RuntimeError('PIPE-VAL-003','invalid_json','Request body must be valid JSON'); }
      }
      if(route.operation==='list') return {status:200,headers:{},body:database.list(route.model)};
      if(route.operation==='create') return {status:201,headers:{},body:database.create(route.model,input)};
      if(id===undefined||!Number.isSafeInteger(id)||id<0) throw new RuntimeValidationError('Record id must be a non-negative integer',{path:'id'});
      if(route.operation==='read') { const found=database.get(route.model,id); return found?{status:200,headers:{},body:found}:{status:404,headers:{},body:{error:'not_found'}}; }
      if(route.operation==='update') return {status:200,headers:{},body:database.update(route.model,id,input)};
      database.delete(route.model,id); return {status:204,headers:{}};
    } catch(error) {
      const known=error instanceof RuntimeError, constraint=error instanceof Error&&error.message.includes('UNIQUE constraint failed');
      const message=known?error.message:constraint?'Value violates a unique constraint':error instanceof Error?error.message:'Runtime failure';
      const status=known?(error.code==='PIPE-DB-003'?404:error.code==='PIPE-NET-003'?415:error.code==='PIPE-NET-001'?413:400):constraint?409:400;
      const diagnostic=known?{code:error.code,kind:error.kind,message,...error.details}:constraint?{code:'PIPE-DB-004',kind:'unique_constraint',message}:{code:'PIPE-VAL-001',kind:'invalid_value',message};
      return {status,headers:{},body:{error:message,diagnostic}};
    }
    });
  }});} catch(error) {sqlite.close();database.close();throw error;}
  let closePromise:Promise<void>|undefined;
  return {url:`http://localhost:${new URL(handle.url).port}`,database,close:()=>closePromise??=(async()=>{shuttingDown=true;try{await handle.close()}finally{sqlite.close();database.close()}})()};
}

async function startAuthenticatedRuntime(ir:ProjectIR,outDir:string,dbFile:string,port:number,options:RuntimeOptions):Promise<RuntimeHandle> {
  const production=options.securityMode==='production';
  if(production&&!options.allowedOrigins?.length)throw new Error('PIPE-AUTH-008: production mode requires BMEC_ALLOWED_ORIGINS for the trusted HTTPS origin');
  for(const origin of options.allowedOrigins??[]){let parsed:URL;try{parsed=new URL(origin)}catch{throw new Error('PIPE-NET-005: allowed origins must be canonical HTTP(S) origins')}if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)throw new Error('PIPE-NET-005: allowed origins must be canonical HTTP(S) origins')}
  if(options.maxBodyBytes!==undefined&&(!Number.isSafeInteger(options.maxBodyBytes)||options.maxBodyBytes<=0))throw new Error('PIPE-NET-002: invalid body limit');
  if(options.maxHeaderBytes!==undefined&&(!Number.isSafeInteger(options.maxHeaderBytes)||options.maxHeaderBytes<1024||options.maxHeaderBytes>65536))throw new Error('PIPE-NET-006: invalid header limit');
  if(options.requestRateLimit!==undefined&&(!Number.isSafeInteger(options.requestRateLimit.limit)||options.requestRateLimit.limit<1||!Number.isSafeInteger(options.requestRateLimit.windowMs)||options.requestRateLimit.windowMs<1))throw new Error('PIPE-NET-010: invalid request rate limit');
  if(options.contentSecurityPolicy!==undefined&&(/[\r\n]/.test(options.contentSecurityPolicy)||!options.contentSecurityPolicy.trim()))throw new Error('PIPE-NET-007: invalid security header value');
  generate(ir,outDir); bundleBrowserArtifact(outDir);
  const authRoutes:any[]=[
    {id:'BMEC-AUTH-REGISTER',method:'POST' as const,path:'/auth/register',pathParams:[],query:[],headers:[],status:201,errorStatuses:[400,409,429],handlerId:'BMEC-AUTH-REGISTER'},
    {id:'BMEC-AUTH-LOGIN',method:'POST' as const,path:'/auth/login',pathParams:[],query:[],headers:[],status:200,errorStatuses:[400,401,429],handlerId:'BMEC-AUTH-LOGIN'},
    {id:'BMEC-AUTH-LOGOUT',method:'POST' as const,path:'/auth/logout',pathParams:[],query:[],headers:[],status:204,errorStatuses:[401,429],handlerId:'BMEC-AUTH-LOGOUT'},
  ];
  const defaultPolicy=options.defaultPolicy??'role:admin';
  const runtimeIR={...ir,http:{...(ir.http??{routes:[]}),routes:[...(ir.http?.routes??[]).map(route=>defaultPolicy==='none'||route.policyId?route:{...route,policyId:defaultPolicy}),...authRoutes]}};
  const postgresTypes=new TypeOverrides();
  postgresTypes.setTypeParser(20,value=>BigInt(value));
  postgresTypes.setTypeParser(1082,value=>value);
  postgresTypes.setTypeParser(1184,postgresDateTimeValue);
  const pool=options.postgresUrl?new Pool({connectionString:options.postgresUrl,types:postgresTypes,max:10,idleTimeoutMillis:10_000,connectionTimeoutMillis:5_000}):undefined;
  let compatibilityDatabase:PipeDatabase|undefined;
  let sqlite:Database.Database|undefined;
  try {
  if(pool) await pool.query('SELECT 1');
  if(pool&&runtimeIR.db)await migratePostgresSchema(pool,runtimeIR.db);
  compatibilityDatabase=pool?undefined:new PipeDatabase(ir,dbFile);
  sqlite=pool?undefined:new Database(dbFile);
  const adapter=pool?postgresPoolAdapter(pool):sqliteAdapter(sqlite!,runtimeIR.db!,{safeIntegers:true,tablePrefix:'pipe_'});
  const users=options.authUserStore??(pool?new PostgresUserStore(pool):production?new SqliteUserStore(sqlite!):new MemoryUserStore());
  const sessions=options.sessionStore??(pool?new PostgresSessionStore(pool):production?new SqliteSessionStore(sqlite!):new SessionStore());
  const rateLimitStore=pool?new PostgresRateLimitStore(pool):production?new SqliteRateLimitStore(sqlite!):new MemoryRateLimitStore();
  if(users instanceof PostgresUserStore)await users.initialize();
  if(sessions instanceof PostgresSessionStore)await sessions.initialize();
  if(rateLimitStore instanceof PostgresRateLimitStore)await rateLimitStore.initialize();
  const auth=new AuthService(users,sessions);
  for (const user of options.authUsers ?? []) if(!await auth.users.get(user.id))await auth.register(user.id,user.password,{role:user.role});
  const capabilityTokens=new Map<CapabilityKind, ReturnType<typeof issueCapability>>([['database', issueCapability('database')]]);
  if(runtimeIR.http?.routes.some(route=>route.capabilities?.includes('time'))) capabilityTokens.set('time',issueCapability('time'));
  if(options.email) capabilityTokens.set('email',issueCapability('email'));
  let shuttingDown=false;
  const requestRateLimit=options.requestRateLimit??{limit:120,windowMs:60000};
  const handle=await startNodeHttpSource(runtimeIR,{host:options.host,port,publicDirectory:outDir,capabilityTokens,database:{adapter,schema:runtimeIR.db!},email:options.email,allowedOrigins:options.allowedOrigins,maxBodyBytes:options.maxBodyBytes,maxHeaderBytes:options.maxHeaderBytes,logger:options.logger,operations:{readiness:async()=>{if(shuttingDown)return false;if(pool){await pool.query('SELECT 1');return true}return Number((sqlite!.prepare('SELECT 1 AS ready').get() as {ready:number}).ready)===1}},rateLimit:{store:rateLimitStore,limit:requestRateLimit.limit,windowMs:requestRateLimit.windowMs},requireOriginForUnsafe:production,requireJsonContentType:production,contentSecurityPolicy:production?(options.contentSecurityPolicy??"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"):undefined,configureRouter:router=>{
    registerAuthHandlers(router,auth,{register:'BMEC-AUTH-REGISTER',login:'BMEC-AUTH-LOGIN',logout:'BMEC-AUTH-LOGOUT'},production,rateLimitStore);
    router.setPrincipalResolver(request=>principalFromRequest(request,auth));
    router.registerPolicy('authenticated',authenticatedSession(auth.sessions));
    for (const route of runtimeIR.http?.routes??[]) if (route.policyId?.startsWith('role:')) router.registerPolicy(route.policyId,rolePolicy(auth,route.policyId.slice(5)));
  }});
  const url=handle.url;
  let closePromise:Promise<void>|undefined;
  return {url,...(compatibilityDatabase?{database:compatibilityDatabase}:{}),close:()=>closePromise??=(async()=>{shuttingDown=true;try{await handle.close()}finally{try{if(pool)await pool.end()}finally{sqlite?.close();compatibilityDatabase?.close()}}})()};
  } catch(error) {
    if(pool)await pool.end().catch(()=>{});
    sqlite?.close();compatibilityDatabase?.close();
    throw error;
  }
}
