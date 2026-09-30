import {afterEach,describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {parseAsync} from '../src/parser/async.js';
import {sourceHttpProgram} from '../src/ir/ir.js';
import {startNodeHttp,startNodeHttpSource,type NodeHttpHandle} from '../src/http/node-adapter.js';
import {validateSerializedIR} from '../src/ir/validate.js';
import {issueCapability} from '../src/runtime/capabilities.js';
import Database from 'better-sqlite3';
import {sqliteAdapter} from '../src/db/adapter.js';
import {ensureSqliteSchema} from '../src/db/sqlite.js';
import {serializeValue} from '../src/runtime/value-contract.js';

describe('PIPE source HTTP lowering',()=>{
  const handles:NodeHttpHandle[]=[];
  afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();});
  it('lowers a source API declaration into typed HTTP IR and serves it over TCP',async()=>{
    const source='app Tasks\nmodel Task { title text required }\napi /tasks from Task';
    const compiled=compile(source,'tasks.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const program=compiled.ir!.http!;
    expect(program.routes[0]).toMatchObject({method:'GET',path:'/tasks',responseBody:{kind:'list',element:{kind:'model',name:'Task'} }});
    const handle=await startNodeHttp(program,router=>router.register(program.routes[0]!.handlerId,()=>({status:200,headers:{},body:[{title:'from-pipe'}]})),{suppliedCapabilities:new Set(['database'])});
    handles.push(handle);
    const response=await fetch(`${handle.url}/tasks`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{title:'from-pipe'}]);
  });
  it('applies a declared API authorization policy to every generated CRUD route',()=>{
    const compiled=compile('app Tasks\nmodel Task { title text required }\napi /tasks from Task requiring authenticated','tasks-policy.pipe');
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.ir!.apis).toEqual([expect.objectContaining({route:'/tasks',model:'Task',policyId:'authenticated'})]);
    expect(compiled.ir!.http!.routes).toHaveLength(5);
    expect(compiled.ir!.http!.routes.map(route=>({method:route.method,path:route.path,policyId:route.policyId}))).toEqual([
      {method:'GET',path:'/tasks',policyId:'authenticated'},
      {method:'POST',path:'/tasks',policyId:'authenticated'},
      {method:'GET',path:'/tasks/:id',policyId:'authenticated'},
      {method:'PUT',path:'/tasks/:id',policyId:'authenticated'},
      {method:'DELETE',path:'/tasks/:id',policyId:'authenticated'},
    ]);
  });
  it('inherits the API authorization policy when a custom collection handler replaces a generated route',()=>{
    const compiled=compile('app Tasks\nmodel Task { title text required }\napi /tasks from Task requiring role manager\nfunction list() -> list<Task> { return [] }\nserve GET /tasks with list','tasks-policy-override.pipe');
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.ir!.http!.routes.find(route=>route.method==='GET'&&route.path==='/tasks')).toMatchObject({policyId:'role:manager'});
  });
  it('denies source model APIs when the database capability is absent',async()=>{
    const compiled=compile('app Tasks\nmodel Task { title text required }\napi /tasks from Task','tasks-capability.pipe');
    const route=compiled.ir!.http!.routes[0]!;
    const handle=await startNodeHttp(compiled.ir!.http!,router=>router.register(route.handlerId,()=>({status:200,headers:{},body:[]})));
    handles.push(handle);
    const response=await fetch(`${handle.url}/tasks`);
    expect(response.status).toBe(500);expect(await response.json()).toMatchObject({error:'missing_capability',capability:'database'});
  });
  it('does not emit a route for an unresolved source API model',()=>{
    expect(sourceHttpProgram(parseAsync('app Bad\napi /missing from Missing')).routes).toEqual([]);
  });
  it('resolves a source HTTP handler through its canonical function identity and return TypeRef',async()=>{
    const source='app Health\nfunction health() -> text { return "ok" }\nhttp GET /health -> health';
    const compiled=compile(source,'health.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const route=compiled.ir!.http!.routes[0]!;
    expect(route).toMatchObject({method:'GET',path:'/health',handlerId:'FUNC-001',responseBody:{kind:'primitive',name:'text'}});
    const handle=await startNodeHttp({routes:[route]},router=>router.register(route.handlerId,()=>({status:200,headers:{},body:'ok'})));
    handles.push(handle);
    expect(await (await fetch(`${handle.url}/health`)).text()).toBe('"ok"');
  });
  it('validates serialized HTTP sections at the IR boundary',()=>{
    const result=compile('app Health\nfunction health() -> text { return "ok" }');
    const ir=JSON.parse(JSON.stringify(result.ir));
    ir.http={routes:[{id:'bad',method:'GET',path:'/bad/:id',pathParams:[],query:[],headers:[],status:200,handlerId:'missing'}]};
    expect(validateSerializedIR(ir).valid).toBe(false);
    expect(validateSerializedIR(ir).errors.some(error=>error.includes('path parameters'))).toBe(true);
  });
  it('preserves async source handler results in the HTTP contract',async()=>{
    const source='app AsyncHealth\nasync function health() -> task<text> { return "ok" }\nhttp GET /health -> health';
    const compiled=compile(source,'async-health.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const route=compiled.ir!.http!.routes[0]!;
    expect(route.responseBody).toEqual({kind:'primitive',name:'text'});
    const handle=await startNodeHttp({routes:[route]},router=>router.register(route.handlerId,async()=>({status:200,headers:{},body:'ok'})));
    handles.push(handle);
    expect((await fetch(`${handle.url}/health`)).status).toBe(200);
  });
  it('executes the compiled BMEC source handler over real TCP',async()=>{
    const compiled=compile('app SourceRuntime\nasync function value(q text) -> task<text> { return q }\nasync function greet(id id, q text) -> task<text> { return await value(q) }\nhttp GET /greet/:id -> greet','source-runtime.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const handle=await startNodeHttpSource(compiled.ir!);
    handles.push(handle);
    const response=await fetch(`${handle.url}/greet/user_1?q=hello`);
    expect(response.status).toBe(200);
    expect(await response.json()).toBe('hello');
  });
  it('executes a source database handler through real HTTP and SQLite',async()=>{
    const compiled=compile('app SourceDb\nmodel Item { name text required }\nasync function list(db capability<database>) -> task<list<Item>> { return await databaseSelect(db, "Item") }\nhttp GET /items requires database -> list','source-db.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Item" (name) VALUES (?)').run('over-http');
    const handle=await startNodeHttpSource(compiled.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    handles.push(handle);const response=await fetch(`${handle.url}/items`);expect(response.status).toBe(200);expect(await response.json()).toEqual([{id:1,name:'over-http'}]);client.close();
  });
  it('decodes database enum text consistently through source handlers',async()=>{
    const compiled=compile('app EnumDb\nenum Status { Pending Done }\nmodel Item { status Status required }\nasync function list(db capability<database>) -> task<list<Item>> { return await databaseSelect(db, "Item") }\nhttp GET /items requires database -> list','source-db-enum.pipe');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Item" (status) VALUES (?)').run('Pending');
    const handle=await startNodeHttpSource(compiled.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});handles.push(handle);
    expect(await (await fetch(`${handle.url}/items`)).json()).toEqual([{id:1,status:{type:'Status',variant:'Pending'}}]);client.close();
  });
  it('rejects a source database HTTP handler without the database capability',async()=>{
    const compiled=compile('app SourceDbDenied\nmodel Item { name text required }\nasync function list(db capability<database>) -> task<list<Item>> { return await databaseSelect(db, "Item") }\nhttp GET /items requires database -> list','source-db-denied.pipe');
    expect(compiled.diagnostics).toEqual([]);const handle=await startNodeHttpSource(compiled.ir!);handles.push(handle);
    expect((await fetch(`${handle.url}/items`)).status).toBe(500);
  });
  it('executes source insert, update, and delete handlers through real HTTP',async()=>{
    const compiled=compile('app SourceDbCrud\nmodel Item { name text required }\nasync function add(db capability<database>, body Item) -> task<integer> { return await databaseInsert(db, "Item", body) }\nasync function change(db capability<database>, id integer, body Item) -> task<integer> { return await databaseUpdate(db, "Item", id, body) }\nasync function remove(db capability<database>, id integer) -> task<integer> { return await databaseDelete(db, "Item", id) }\nhttp POST /items requires database -> add\nhttp PATCH /items/:id requires database -> change\nhttp DELETE /items/:id requires database -> remove','source-db-crud.pipe');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    const add=compiled.ir!.functions.find(fn=>fn.name==='add')!;const bodyType=add.parameters.find(parameter=>parameter.name==='body')!.typeRef;
    const body=serializeValue({kind:'model',type:bodyType,fields:{name:{kind:'text',value:'http-crud'}}});
    const handle=await startNodeHttpSource(compiled.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});handles.push(handle);
    expect((await (await fetch(`${handle.url}/items`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json())).toBe(1);
    expect((await (await fetch(`${handle.url}/items/1`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(serializeValue({kind:'model',type:bodyType,fields:{name:{kind:'text',value:'http-updated'}}}))})).json())).toBe(1);
    expect((await (await fetch(`${handle.url}/items/1`,{method:'DELETE'})).json())).toBe(1);expect(client.prepare('SELECT count(*) AS count FROM "Item"').get()).toEqual({count:0});client.close();
  });
  it('executes generated source model CRUD without a hand-written HTTP handler',async()=>{
    const compiled=compile('app Store\nmodel Item { name text required }\napi /items from Item','generated-source-crud.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');
    ensureSqliteSchema(client,compiled.ir!.db!);
    const create=compiled.ir!.http!.routes.find(route=>route.method==='POST')!;
    const update=compiled.ir!.http!.routes.find(route=>route.method==='PUT')!;
    const body=(name:string)=>serializeValue({kind:'model',type:create.requestBody!,fields:{name:{kind:'text',value:name}}});
    const handle=await startNodeHttpSource(compiled.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    handles.push(handle);
    try {
      const created=await fetch(`${handle.url}/items`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body('generated'))});
      expect(created.status).toBe(201);expect(await created.json()).toBe(1);
      const read=await fetch(`${handle.url}/items/1`);
      expect(read.status).toBe(200);expect(await read.json()).toEqual({id:1,name:'generated'});
      const changed=await fetch(`${handle.url}/items/1`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body('updated'))});
      expect(changed.status).toBe(200);expect(await changed.json()).toBe(1);
      const removed=await fetch(`${handle.url}/items/1`,{method:'DELETE'});
      expect(removed.status).toBe(200);expect(await removed.json()).toBe(1);
      expect(await (await fetch(`${handle.url}/items`)).json()).toEqual([]);
    } finally { client.close(); }
  });
  it('decodes ordinary JSON model bodies on generated source API routes',async()=>{
    const compiled=compile('app PlainJsonApi\nmodel Task { title text required }\napi /tasks from Task','plain-json-api.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    const handle=await startNodeHttpSource(compiled.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});handles.push(handle);
    try {
      const created=await fetch(`${handle.url}/tasks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'ordinary-json'})});
      expect(created.status).toBe(201);expect(await created.json()).toBe(1);
      expect(await (await fetch(`${handle.url}/tasks`)).json()).toEqual([{id:1,title:'ordinary-json'}]);
      const updated=await fetch(`${handle.url}/tasks/1`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:'updated-json'})});
      expect(updated.status).toBe(200);expect(await updated.json()).toBe(1);
      expect(await (await fetch(`${handle.url}/tasks/1`)).json()).toEqual({id:1,title:'updated-json'});
    } finally { client.close(); }
  });
  it('round-trips relation fields through typed model references and foreign keys',async()=>{
    const compiled=compile('app Relations\nmodel User { name text required }\nmodel Task { title text required owner User required }\napi /users from User\napi /tasks from Task','source-relation-crud.pipe');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    const handle=await startNodeHttpSource(compiled.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});handles.push(handle);
    const user=await fetch(`${handle.url}/users`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,kind:'model',type:compiled.ir!.models.find(model=>model.name==='User')!.typeRef,fields:{name:{version:1,kind:'text',value:'Ada'}}})});expect(user.status).toBe(201);
    const userId=(await user.json()) as number;
    const taskType=compiled.ir!.models.find(model=>model.name==='Task')!.typeRef!,userType=compiled.ir!.models.find(model=>model.name==='User')!.typeRef!;
    const body={version:1,kind:'model',type:taskType,fields:{title:{version:1,kind:'text',value:'typed relation'},owner:{version:1,kind:'model',type:userType,fields:{id:{version:1,kind:'integer',value:String(userId)}}}}};
    const created=await fetch(`${handle.url}/tasks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});expect(created.status).toBe(201);
    const rows=await (await fetch(`${handle.url}/tasks`)).json();expect(rows).toEqual([{id:1,title:'typed relation',owner:{id:userId}}]);client.close();
  });
  it('injects only an explicitly supplied capability into a compiled source handler',async()=>{
    const compiled=compile('app SourceCapability\nfunction secure(env capability<environment>) -> text { return "ok" }\nhttp GET /secure requires environment -> secure','source-capability.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const denied=await startNodeHttpSource(compiled.ir!);
    handles.push(denied);
    expect((await fetch(`${denied.url}/secure`)).status).toBe(500);
    await denied.close(); handles.pop();
    const allowed=await startNodeHttpSource(compiled.ir!,{capabilityTokens:new Map([['environment',issueCapability('environment')]])});
    handles.push(allowed);
    expect((await fetch(`${allowed.url}/secure`)).status).toBe(200);
  });
  it('passes a typed JSON body into the compiled source handler',async()=>{
    const compiled=compile('app SourceBody\nfunction echo(body text) -> text { return body }\nhttp POST /echo -> echo','source-body.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const handle=await startNodeHttpSource(compiled.ir!);
    handles.push(handle);
    const response=await fetch(`${handle.url}/echo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,kind:'text',value:'from-source'})});
    expect(response.status).toBe(200);
    expect(await response.json()).toBe('from-source');
  });
  it('preserves a source Result error through the real HTTP boundary',async()=>{
    const compiled=compile('app SourceResult\nfunction fail() -> result<text,text> { return err("denied") }\nhttp GET /fail -> fail','source-result.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const handle=await startNodeHttpSource(compiled.ir!);
    handles.push(handle);
    const response=await fetch(`${handle.url}/fail`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({state:'err',error:'denied'});
  });
  it('derives typed path and query parameters from a source handler signature',async()=>{
    const source='app Search\nfunction search(id id, q text) -> text { return q }\nhttp GET /search/:id -> search';
    const compiled=compile(source,'search.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const route=compiled.ir!.http!.routes[0]!;
    expect(route.pathParams).toEqual([{name:'id',type:{kind:'primitive',name:'id'},required:true}]);
    expect(route.query).toEqual([{name:'q',type:{kind:'primitive',name:'text'},required:true}]);
    const handle=await startNodeHttp({routes:[route]},router=>router.register(route.handlerId,(_request,params)=>({status:200,headers:{},body:`${params.id}:${params.q}`})));
    handles.push(handle);
    expect(await (await fetch(`${handle.url}/search/user_1?q=pipe`)).text()).toBe('"user_1:pipe"');
    expect((await fetch(`${handle.url}/search/user_1`)).status).toBe(400);
    expect((await fetch(`${handle.url}/search/not%20valid?q=pipe`)).status).toBe(400);
  });
  it('lowers optional source parameters to optional query fields',async()=>{
    const source='app SearchOptional\nfunction search(q text?) -> text { return "ok" }\nhttp GET /search -> search';
    const compiled=compile(source,'search-optional.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const route=compiled.ir!.http!.routes[0]!;
    expect(route.query).toEqual([{name:'q',type:{kind:'optional',inner:{kind:'primitive',name:'text'}},required:false}]);
    const handle=await startNodeHttp({routes:[route]},router=>router.register(route.handlerId,(_request,params)=>({status:200,headers:{},body:params.q??'all'})));
    handles.push(handle);
    expect(await (await fetch(`${handle.url}/search`)).text()).toBe('"all"');
    expect(await (await fetch(`${handle.url}/search?q=pipe`)).text()).toBe('"pipe"');
  });
  it('lowers typed source headers and binds them by name over real TCP',async()=>{
    const source='app HeaderSearch\nfunction search(token text, q text) -> text { return token + ":" + q }\nhttp GET /search headers token -> search';
    const compiled=compile(source,'header-search.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const route=compiled.ir!.http!.routes[0]!;
    expect(route.headers).toEqual([{name:'token',type:{kind:'primitive',name:'text'},required:true}]);
    expect(route.query).toEqual([{name:'q',type:{kind:'primitive',name:'text'},required:true}]);
    const handle=await startNodeHttpSource(compiled.ir!);
    handles.push(handle);
    expect(await (await fetch(`${handle.url}/search?q=pipe`,{headers:{token:'secret'}})).text()).toBe('"secret:pipe"');
    expect((await fetch(`${handle.url}/search?q=pipe`,{headers:{token:'bad value'}})).status).toBe(200);
    expect((await fetch(`${handle.url}/search?q=pipe`)).status).toBe(400);
    expect(compile('app Invalid\nfunction search(q text) -> text { return q }\nhttp GET /search headers token -> search','invalid-header.pipe').diagnostics.map(error=>error.code)).toContain('PIPE-HTTP-004');
  });
  it('derives and enforces a typed source POST body over the real transport',async()=>{
    const source='app Echo\nfunction create(body text) -> text { return body }\nhttp POST /echo returns 201 -> create';
    const compiled=compile(source,'echo.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const route=compiled.ir!.http!.routes[0]!;
    expect(route.requestBody).toEqual({kind:'primitive',name:'text'});
    expect(route.status).toBe(201);
    const handle=await startNodeHttp({routes:[route]},router=>router.register(route.handlerId,(_request)=>({status:201,headers:{},body:'accepted'})));
    handles.push(handle);
    const valid=await fetch(`${handle.url}/echo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,kind:'text',value:'hello'})});
    expect(valid.status).toBe(201);
    const invalid=await fetch(`${handle.url}/echo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:'hello'})});
    expect(invalid.status).toBe(400);
  });
  it('allows an omitted body when the source handler declares an optional body',async()=>{
    const compiled=compile('app OptionalBody\nfunction ping(body text?) -> text { return "ok" }\nhttp POST /ping -> ping','optional-body.pipe');
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.ir!.http!.routes[0]!.requestBody).toEqual({kind:'optional',inner:{kind:'primitive',name:'text'}});
    const handle=await startNodeHttpSource(compiled.ir!);
    handles.push(handle);
    const response=await fetch(`${handle.url}/ping`,{method:'POST'});
    expect(response.status).toBe(200);
    expect(await response.json()).toBe('ok');
  });
  it('lowers and accepts declared source-route error statuses',async()=>{
    const source='app Health\nfunction health() -> text { return "nope" }\nhttp GET /health returns 200 errors 418, 404 -> health';
    const compiled=compile(source,'health-errors.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const route=compiled.ir!.http!.routes[0]!;
    expect(route).toMatchObject({status:200,errorStatuses:[418,404]});
    const handle=await startNodeHttp({routes:[route]},router=>router.register(route.handlerId,()=>({status:418,headers:{},body:'teapot'})));
    handles.push(handle);
    expect((await fetch(`${handle.url}/health`)).status).toBe(418);
  });
  it('lowers source route capabilities and rejects missing adapter injection',async()=>{
    const source='app Secure\nfunction secure() -> text { return "ok" }\nhttp GET /secure requires environment -> secure';
    const compiled=compile(source,'secure.pipe');
    expect(compiled.diagnostics).toEqual([]);
    const route=compiled.ir!.http!.routes[0]!;
    expect(route.capabilities).toEqual(['environment']);
    const handle=await startNodeHttp({routes:[route]},router=>router.register(route.handlerId,()=>({status:200,headers:{},body:'ok'})));
    handles.push(handle);
    expect((await fetch(`${handle.url}/secure`)).status).toBe(500);
  });
});
