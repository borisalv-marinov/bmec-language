import {describe,expect,it} from 'vitest';
import {parse} from '../src/parser/parser.js';
import {compile} from '../src/compiler.js';
import {executeAsyncValue,executeValue,ResultValue,PIPE_NONE} from '../src/core/interpreter.js';
import {formatSource} from '../src/tooling/formatter.js';
import Database from 'better-sqlite3';
import {issueCapability} from '../src/runtime/capabilities.js';
import {sqliteAdapter} from '../src/db/adapter.js';
import {ensureSqliteSchema} from '../src/db/sqlite.js';
import {publicValue} from '../src/core/interpreter.js';
import {startNodeHttpSource} from '../src/http/node-adapter.js';
import {AuthService} from '../src/runtime/auth.js';
import {authenticatedSession,principalAttributePolicy,rolePolicy} from '../src/http/auth-policy.js';
import {postgresPoolAdapter} from '../src/db/postgres.js';

const postgresConnection=process.env.BMEC_POSTGRES_URL;
const maybePostgres=postgresConnection?it:it.skip;

describe('BMEC controlled-English variable syntax',()=>{
 it('lowers let and var declarations using is into existing statements',()=>{
  const source='function main() -> integer { let answer is 40 return answer }';
  const ast=parse(source,'controlled.bmec');
  expect(ast.declarations[0]).toMatchObject({kind:'FunctionDeclaration'});
  expect((ast.declarations[0] as any).body[0]).toMatchObject({kind:'LetStatement',name:'answer'});
  const result=compile(source,'controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'main',[])).toBe(40n);
 });
 it('supports typed controlled-English declarations and preserves deterministic formatting',()=>{
  const source='function main() -> integer { var answer integer is 40 return answer }';
  expect(compile(source,'typed-controlled.bmec').diagnostics).toEqual([]);
  const formatted=formatSource(source);
  expect(formatSource(formatted)).toBe(formatted);
  expect(parse(formatted,'typed-controlled.bmec').declarations).toHaveLength(1);
 });
 it('lowers be declarations through the existing let and var semantics',()=>{
  const source='function main() -> text { let userName be "Alex" return userName }';
  const result=compile(source,'be-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'main',[])).toBe('Alex');
  const formatted=formatSource(source);
  expect(formatSource(formatted)).toBe(formatted);
 });
 it('canonicalizes two-word controlled-English local names without changing core bindings',()=>{
  const source='function main() -> text { let user name be "Alex" return user_name }';
  const result=compile(source,'spaced-binding-controlled.bmec');expect(result.diagnostics).toEqual([]);expect(executeValue(result.ir!.functions,'main',[])).toBe('Alex');expect(formatSource(source)).toContain('let user_name = "Alex"');
 });
 it('rejects malformed controlled-English declarations',()=>{
  const result=compile('function main() -> integer { let answer is }','bad-controlled.bmec');
  expect(result.diagnostics[0]?.kind).toBe('syntax');
 });
 it('lowers otherwise to the existing conditional else branch',()=>{
  const source='function classify(value integer) -> text { if value > 0 { return "positive" } otherwise { return "not positive" } }';
  const result=compile(source,'otherwise-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'classify',[1n])).toBe('positive');
  expect(executeValue(result.ir!.functions,'classify',[0n])).toBe('not positive');
 });
 it('lowers chained otherwise-if branches into nested typed conditionals',()=>{
  const source='function classify(value integer) -> text { if value > 10 { return "high" } otherwise if value > 0 { return "low" } otherwise { return "none" } }';
  const result=compile(source,'otherwise-if-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'classify',[11n])).toBe('high');
  expect(executeValue(result.ir!.functions,'classify',[3n])).toBe('low');
  expect(executeValue(result.ir!.functions,'classify',[-1n])).toBe('none');
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
 });
 it('lowers controlled-English comparison phrases to existing typed operators',()=>{
  const source='function atLeast(age integer) -> boolean { return age is at least 18 } function atMost(age integer) -> boolean { return age is at most 10 } function greater(age integer) -> boolean { return age is greater than 20 } function less(age integer) -> boolean { return age is less than 5 } function equal(age integer) -> boolean { return age is equal to 18 }';
  const result=compile(source,'comparison-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'atLeast',[18n])).toBe(true);
  expect(executeValue(result.ir!.functions,'atMost',[10n])).toBe(true);
  expect(executeValue(result.ir!.functions,'greater',[21n])).toBe(true);
  expect(executeValue(result.ir!.functions,'less',[3n])).toBe(true);
  expect(executeValue(result.ir!.functions,'equal',[18n])).toBe(true);
 });
 it('lowers spaced controlled-English field access into existing typed field access',()=>{
  const source='app People model User { name text required age integer required } function greet(user User) -> text { return user name } function adult(user User) -> boolean { return user age is at least 18 }';
  const result=compile(source,'spaced-field-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'greet',[{name:'Alex',age:20n}])).toBe('Alex');
  expect(executeValue(result.ir!.functions,'adult',[{name:'Alex',age:20n}])).toBe(true);
 });
 it('lowers is true and is false conditions to typed boolean equality',()=>{
  const source='function enabled(active boolean) -> text { if active is true { return "yes" } otherwise { return "no" } } function disabled(active boolean) -> text { if active is false { return "yes" } otherwise { return "no" } }';
  const result=compile(source,'boolean-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'enabled',[true])).toBe('yes');
  expect(executeValue(result.ir!.functions,'disabled',[false])).toBe('yes');
 });
 it('lowers is not conditions to typed inequality',()=>{
  const source='function present(value text?) -> boolean { return value is not none } function inactive(active boolean) -> boolean { return active is not true }';
  const result=compile(source,'not-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'present',['value'])).toBe(true);
  expect(executeValue(result.ir!.functions,'present',[PIPE_NONE])).toBe(false);
  expect(executeValue(result.ir!.functions,'inactive',[false])).toBe(true);
 });
 it('does not rewrite the word otherwise inside a string literal',()=>{
  const result=compile('function main() -> text { return "otherwise" }','string-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'main',[])).toBe('otherwise');
 });
 it('lowers for each into the existing for-in semantics',()=>{
  const source='function total(values list<integer>) -> integer { var total is 0 for each value in values { total = total + value } return total }';
  const result=compile(source,'for-each-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  expect(executeValue(result.ir!.functions,'total',[[1n,2n,3n]])).toBe(6n);
 });
 it('rejects for each without an iteration variable',()=>{
  const result=compile('function total(values list<integer>) -> integer { for each in values { return 1 } return 0 }','bad-for-each.bmec');
  expect(result.diagnostics[0]?.kind).toBe('syntax');
 });
 it('lowers propagate value into existing Result propagation',()=>{
  const source='function addOne(value result<integer,text>) -> result<integer,text> { return ok(propagate value + 1) }';
  const result=compile(source,'propagate-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'addOne',[new ResultValue('ok',2n)])).toEqual(new ResultValue('ok',3n));
  expect(executeValue(result.ir!.functions,'addOne',[new ResultValue('err','bad')])).toEqual(new ResultValue('err','bad'));
 });
 it('does not rewrite propagate inside a string literal',()=>{
  const result=compile('function main() -> text { return "propagate value" }','string-propagate.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'main',[])).toBe('propagate value');
 });
 it('lowers wait for into existing async await semantics',async()=>{
  const source='async function one() -> task<integer> { return 1 } async function two() -> task<integer> { return wait for one() }';
  const result=compile(source,'wait-for-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  await expect(executeAsyncValue(result.ir!.functions,'two',[])).resolves.toBe(1n);
 });
 it('lowers controlled-English database reads into the typed database select',async()=>{
  const source='app Store model Item { name text required } async function list(db capability<database>) -> task<list<Item>> { return wait for get items from Item using db }';
  const result=compile(source,'database-read-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.functions.find(fn=>fn.name==='list')!.body[0]).toMatchObject({kind:'return',value:{kind:'await',operand:{kind:'call',callee:'databaseSelect'}}});
  const client=new Database(':memory:');
  ensureSqliteSchema(client,result.ir!.db!);
  client.prepare('INSERT INTO "Item" (name) VALUES (?)').run('controlled');
  const value=await executeAsyncValue(result.ir!.functions,'list',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!}});
  expect(publicValue(value)).toEqual([{id:1,name:'controlled'}]);
  client.close();
 });
 it('lowers controlled-English database filters into parameterized typed selection',async()=>{
  const source='app Store model User { name text required active boolean required } async function list(db capability<database>) -> task<list<User>> { return wait for get users from User where active is true using db }';
  const result=compile(source,'database-filter-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  const client=new Database(':memory:');
  ensureSqliteSchema(client,result.ir!.db!);
  client.prepare('INSERT INTO "User" (name, active) VALUES (?, ?), (?, ?)').run('active',1,'inactive',0);
  const value=await executeAsyncValue(result.ir!.functions,'list',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!}});
  expect(publicValue(value)).toEqual([{id:1,name:'active',active:true}]);
   client.close();
  });
  it('lowers controlled-English database limits through existing select IR',async()=>{
   const source='app Store model Item { name text required } async function list(db capability<database>) -> task<list<Item>> { return wait for get items from Item limited to 1 using db }';
   const result=compile(source,'database-limit-controlled.bmec');
   expect(result.diagnostics).toEqual([]);
   const call=(result.ir!.functions.find(fn=>fn.name==='list')!.body[0] as any).value.operand;
   expect(call).toMatchObject({kind:'call',callee:'databaseSelect'});
   expect(call.args[2]).toMatchObject({value:'1'});
   const client=new Database(':memory:');
   ensureSqliteSchema(client,result.ir!.db!);
   client.prepare('INSERT INTO "Item" (name) VALUES (?), (?)').run('first','second');
   const value=await executeAsyncValue(result.ir!.functions,'list',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!}});
   expect(publicValue(value)).toEqual([{id:1,name:'first'}]);
   client.close();
  });
  it('lowers controlled-English ordering and limits through existing select IR',async()=>{
   const source='app Store model Item { name text required quantity integer required } async function list(db capability<database>) -> task<list<Item>> { return wait for get items from Item ordered by quantity descending limited to 1 using db }';
   const result=compile(source,'database-order-controlled.bmec');
   expect(result.diagnostics).toEqual([]);
   const call=(result.ir!.functions.find(fn=>fn.name==='list')!.body[0] as any).value.operand;
   expect(call).toMatchObject({kind:'call',callee:'databaseSelect'});
   expect(call.args[2]).toMatchObject({value:'quantity'});
   expect(call.args[3]).toMatchObject({value:'descending'});
   expect(call.args[4]).toMatchObject({value:'1'});
   const client=new Database(':memory:');
   ensureSqliteSchema(client,result.ir!.db!);
   client.prepare('INSERT INTO "Item" (name, quantity) VALUES (?, ?), (?, ?)').run('small',5,'large',20);
   const value=await executeAsyncValue(result.ir!.functions,'list',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!}});
   expect(publicValue(value)).toEqual([{id:2,name:'large',quantity:20}]);
   client.close();
  });
  it('combines controlled-English filtering, ordering, and limits',async()=>{
   const source='app Store model Item { name text required active boolean required } async function list(db capability<database>) -> task<list<Item>> { return wait for get items from Item where active is true ordered by name descending limited to 1 using db }';
   const result=compile(source,'database-filter-order-limit-controlled.bmec');
   expect(result.diagnostics).toEqual([]);
   const call=(result.ir!.functions.find(fn=>fn.name==='list')!.body[0] as any).value.operand;
   expect(call).toMatchObject({kind:'call',callee:'databaseSelectWhere'});
   expect(call.args[3]).toMatchObject({value:'='});expect(call.args[5]).toMatchObject({value:'name'});expect(call.args[6]).toMatchObject({value:'descending'});expect(call.args[7]).toMatchObject({value:'1'});
   const client=new Database(':memory:');ensureSqliteSchema(client,result.ir!.db!);client.prepare('INSERT INTO "Item" (name, active) VALUES (?, ?), (?, ?), (?, ?)').run('Alpha',1,'Zulu',1,'Other',0);
   const value=await executeAsyncValue(result.ir!.functions,'list',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!}});expect(publicValue(value)).toEqual([{id:2,name:'Zulu',active:true}]);client.close();
  });
  it('lowers controlled-English comparison filters through the typed database predicate',async()=>{
   const source='app Store model Item { name text required quantity integer required } async function list(db capability<database>) -> task<list<Item>> { return wait for get items from Item where quantity is at most 10 using db }';
   const result=compile(source,'database-filter-comparison.bmec');
   expect(result.diagnostics).toEqual([]);
   const call=(result.ir!.functions.find(fn=>fn.name==='list')!.body[0] as any).value.operand;
   expect(call).toMatchObject({kind:'call',callee:'databaseSelectWhere'});
   expect(call.args[3]).toMatchObject({value:'<='});
   const client=new Database(':memory:');
   ensureSqliteSchema(client,result.ir!.db!);
   client.prepare('INSERT INTO "Item" (name, quantity) VALUES (?, ?), (?, ?)').run('small',5,'large',20);
   const value=await executeAsyncValue(result.ir!.functions,'list',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!}});
   expect(publicValue(value)).toEqual([{id:1,name:'small',quantity:5}]);
   client.close();
  });
  maybePostgres('executes controlled-English comparison filters through live PostgreSQL',async()=>{
   const source='app Store model Item { name text required quantity integer required } async function list(db capability<database>) -> task<list<Item>> { return wait for get items from Item where quantity is at most 10 using db }';
   const result=compile(source,'database-filter-comparison-postgres.bmec');
   expect(result.diagnostics).toEqual([]);
   const {Pool}=await import('pg');
   const pool=new Pool({connectionString:postgresConnection});
   const db=postgresPoolAdapter(pool);
   try{
    await pool.query('CREATE TABLE "Item" ("id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, "name" text NOT NULL, "quantity" bigint NOT NULL)');
    await db.execute({kind:'insert',model:'Item',values:{name:{kind:'primitive',name:'text'},quantity:{kind:'primitive',name:'integer'}}},['small',5]);
    await db.execute({kind:'insert',model:'Item',values:{name:{kind:'primitive',name:'text'},quantity:{kind:'primitive',name:'integer'}}},['large',20]);
    const value=await executeAsyncValue(result.ir!.functions,'list',[issueCapability('database')],{database:{adapter:db,schema:result.ir!.db!}});
    expect(publicValue(value)).toEqual([{id:1,name:'small',quantity:5}]);
   } finally { await pool.query('DROP TABLE IF EXISTS "Item" CASCADE'); await pool.end(); }
  });
  it('lowers controlled-English not-equal database filters deterministically',()=>{
   const result=compile('app Store model Item { quantity integer required } async function list(db capability<database>) -> task<list<Item>> { return wait for get items from Item where quantity is not 10 using db }','database-filter-not-equal.bmec');
   expect(result.diagnostics).toEqual([]);
   const call=(result.ir!.functions.find(fn=>fn.name==='list')!.body[0] as any).value.operand;
   expect(call.args[3]).toMatchObject({value:'!='});
  });
 it('reports invalid controlled-English database filter fields and types',()=>{
  const unknown=compile('app Store model User { active boolean required } async function list(db capability<database>) -> task<list<User>> { return wait for get users from User where missing is true using db }','database-filter-missing.bmec');
  expect(unknown.diagnostics.map(error=>error.code)).toContain('PIPE-DB-002');
   const wrong=compile('app Store model User { active boolean required } async function list(db capability<database>) -> task<list<User>> { return wait for get users from User where active is 1 using db }','database-filter-type.bmec');
   expect(wrong.diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
   const invalidOperator=compile('app Store model User { active boolean required } async function list(db capability<database>) -> task<list<User>> { return wait for databaseSelectWhere(db, "User", "active", "~", true) }','database-filter-operator.bmec');
   expect(invalidOperator.diagnostics.map(error=>error.code)).toContain('PIPE-DB-003');
  });
 it('preserves controlled-English database phrases inside strings',()=>{
  const result=compile('function main() -> text { return "get items from Item using db" }','string-database-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(executeValue(result.ir!.functions,'main',[])).toBe('get items from Item using db');
 });
 it('lowers controlled-English database inserts into the typed database insert',async()=>{
  const source='app Store model Item { name text required } async function add(db capability<database>, payload Item) -> task<integer> { return wait for add payload to Item using db }';
  const result=compile(source,'database-insert-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  const client=new Database(':memory:');
  ensureSqliteSchema(client,result.ir!.db!);
  const value=await executeAsyncValue(result.ir!.functions,'add',[issueCapability('database'),{name:'inserted'}],{database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!}});
  expect(publicValue(value)).toBe(1);
  expect((client.prepare('SELECT name FROM "Item"').get() as {name:string}).name).toBe('inserted');
  client.close();
 });
 it('lowers controlled-English database deletes into the typed database delete',async()=>{
  const source='app Store model Item { name text required } async function remove(db capability<database>, id integer) -> task<integer> { return wait for remove Item with id using db }';
  const result=compile(source,'database-delete-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  const client=new Database(':memory:');
  ensureSqliteSchema(client,result.ir!.db!);
  client.prepare('INSERT INTO "Item" (name) VALUES (?)').run('removed');
  const value=await executeAsyncValue(result.ir!.functions,'remove',[issueCapability('database'),1n],{database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!}});
  expect(publicValue(value)).toBe(1);
  expect(client.prepare('SELECT COUNT(*) AS count FROM "Item"').get()).toEqual({count:0});
  client.close();
 });
 it('reports controlled-English database delete type errors and formats deterministically',()=>{
  const invalid=compile('app Store model Item { name text required } async function remove(db capability<database>, id text) -> task<integer> { return wait for remove Item with id using db }','database-delete-invalid.bmec');
  expect(invalid.diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
  const source='async function remove(db capability<database>, id integer) -> task<integer> { return wait for remove Item with id using db }';
  const formatted=formatSource(source);
  expect(formatSource(formatted)).toBe(formatted);
 });
 it('lowers controlled-English database updates into the typed database update',async()=>{
  const source='app Store model Item { name text required } async function change(db capability<database>, id integer, payload Item) -> task<integer> { return wait for change payload on Item id using db }';
  const result=compile(source,'database-update-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  const client=new Database(':memory:');
  ensureSqliteSchema(client,result.ir!.db!);
  client.prepare('INSERT INTO "Item" (name) VALUES (?)').run('old');
  const value=await executeAsyncValue(result.ir!.functions,'change',[issueCapability('database'),1n,{name:'changed'}],{database:{adapter:sqliteAdapter(client,result.ir!.db!),schema:result.ir!.db!}});
  expect(publicValue(value)).toBe(1);
  expect((client.prepare('SELECT name FROM "Item" WHERE id=1').get() as {name:string}).name).toBe('changed');
  client.close();
 });
 it('reports controlled-English database update type errors and formats deterministically',()=>{
  const invalid=compile('app Store model Item { name text required } async function change(db capability<database>, id integer, payload text) -> task<integer> { return wait for change payload on Item id using db }','database-update-invalid.bmec');
  expect(invalid.diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
  const source='async function change(db capability<database>, id integer, payload Item) -> task<integer> { return wait for change payload on Item id using db }';
  const formatted=formatSource(source);
  expect(formatSource(formatted)).toBe(formatted);
 });
 it('lowers readable update phrasing into the existing typed database update',()=>{
  const source='async function change(db capability<database>, id integer, payload Item) -> task<integer> { return wait for update payload in Item with id using db }';
  const result=compile('app Store model Item { name text required } '+source,'database-update-readable.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  expect(result.ir!.functions.find(fn=>fn.name==='change')!.body[0]).toMatchObject({kind:'return',value:{kind:'await',operand:{kind:'call',callee:'databaseUpdate'}}});
 });
 it('lowers readable delete phrasing into the existing typed database delete',()=>{
  const source='async function remove(db capability<database>, id integer) -> task<integer> { return wait for delete id from Item using db }';
  const result=compile('app Store model Item { name text required } '+source,'database-delete-readable.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  expect(result.ir!.functions.find(fn=>fn.name==='remove')!.body[0]).toMatchObject({kind:'return',value:{kind:'await',operand:{kind:'call',callee:'databaseDelete'}}});
 });
 it('retains typed diagnostics for readable database mutations',()=>{
  const update=compile('app Store model Item { name text required } async function change(db capability<database>, id integer, payload text) -> task<integer> { return wait for update payload in Item with id using db }','database-update-readable-invalid.bmec');
  const remove=compile('app Store model Item { name text required } async function remove(db capability<database>, id text) -> task<integer> { return wait for delete id from Item using db }','database-delete-readable-invalid.bmec');
  expect(update.diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
  expect(remove.diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
 });
 it('lowers controlled-English HTTP serving into the existing route runtime',async()=>{
  const source='app Web function health() -> text { return "ok" } serve GET /health with health';
  const result=compile(source,'http-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({method:'GET',path:'/health',handlerId:'FUNC-001'});
  const handle=await startNodeHttpSource(result.ir!);
  try{const response=await fetch(`${handle.url}/health`);expect(response.status).toBe(200);expect(await response.json()).toBe('ok');}finally{await handle.close();}
 });
 it('accepts ordinary compact parameterized paths in controlled-English serving',()=>{
  const source='app Web function job(id text) -> text { return id } serve GET /jobs/:id with job';
  const result=compile(source,'http-controlled-parameter-path.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({method:'GET',path:'/jobs/:id',pathParams:[{name:'id',type:{kind:'primitive',name:'text'}}],handlerId:'FUNC-001'});
 });
 it('preserves typed success and application-error statuses in controlled-English serving',()=>{
  const source='app Web function create() -> text { return "ok" } serve POST /jobs returns 201 errors 400, 404 with create';
  const result=compile(source,'http-controlled-statuses.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({method:'POST',path:'/jobs',status:201,errorStatuses:[400,404],handlerId:'FUNC-001'});
 });
 it('combines controlled-English role and capability requirements with typed result statuses',async()=>{
  const source='app Secure\nasync function create(db capability<database>) -> task<result<integer,text>> { return err("invalid_input") }\nserve POST /jobs requiring role admin and database returns 201 errors 400 with create';
  const result=compile(source,'http-controlled-role-result-status.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({method:'POST',path:'/jobs',policyId:'role:admin',capabilities:['database'],status:201,errorStatuses:[400]});
  const alternate=compile(source.replace('requiring role admin and database returns 201 errors 400','returns 201 errors 400 requiring role admin and database'),'http-controlled-role-result-status-alternate.bmec');
  expect(alternate.diagnostics).toEqual([]);
  expect(alternate.ir!.http!.routes[0]).toMatchObject({policyId:'role:admin',capabilities:['database'],status:201,errorStatuses:[400]});
  const auth=new AuthService();await auth.register('admin','admin pass',{role:'admin'});
  const handle=await startNodeHttpSource(result.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),configureRouter:router=>router.registerPolicy('role:admin',rolePolicy(auth,'admin'))});
  try{expect((await fetch(`${handle.url}/jobs`,{method:'POST'})).status).toBe(403);const session=await auth.login('admin','admin pass');const response=await fetch(`${handle.url}/jobs`,{method:'POST',headers:{authorization:`Bearer ${session!.id}`}});expect(response.status,await response.text()).toBe(400);}finally{await handle.close();}
 });
 it('lowers controlled-English capability serving into the existing typed route boundary',async()=>{
  const source='app Web function health(env capability<environment>) -> text { return "ready" } serve GET /health requiring environment with health';
  const result=compile(source,'capability-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({capabilities:['environment'],handlerId:'FUNC-001'});
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  const handle=await startNodeHttpSource(result.ir!,{capabilityTokens:new Map([['environment',issueCapability('environment')]])});
  try{const response=await fetch(`${handle.url}/health`);expect(response.status).toBe(200);expect(await response.json()).toBe('ready');}finally{await handle.close();}
 });
 it('combines controlled-English authorization and capability requirements without changing route semantics',async()=>{
  const source='app Secure function health(db capability<database>) -> text { return "ready" } serve GET /health requiring role manager and database with health';
  const result=compile(source,'combined-route-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({policyId:'role:manager',capabilities:['database']});
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  const auth=new AuthService();await auth.register('manager','manager pass',{role:'manager'});
  const handle=await startNodeHttpSource(result.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),configureRouter:router=>router.registerPolicy('role:manager',rolePolicy(auth,'manager'))});
  try{expect((await fetch(`${handle.url}/health`)).status).toBe(403);const session=await auth.login('manager','manager pass');expect((await fetch(`${handle.url}/health`,{headers:{authorization:`Bearer ${session!.id}`}})).status).toBe(200);}finally{await handle.close();}
 });
 it('combines controlled-English authentication and capability requirements',async()=>{
  const source='app Secure function health(db capability<database>) -> text { return "ready" } serve GET /health requiring authenticated and database with health';
  const result=compile(source,'authenticated-route-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({policyId:'authenticated',capabilities:['database']});
  const auth=new AuthService();await auth.register('member','member pass');
  const handle=await startNodeHttpSource(result.ir!,{capabilityTokens:new Map([['database',issueCapability('database')]]),configureRouter:router=>router.registerPolicy('authenticated',authenticatedSession(auth.sessions))});
  try{expect((await fetch(`${handle.url}/health`)).status).toBe(403);const session=await auth.login('member','member pass');expect((await fetch(`${handle.url}/health`,{headers:{authorization:`Bearer ${session!.id}`}})).status).toBe(200);}finally{await handle.close();}
 });
 it('lowers controlled-English ask declarations into typed page inputs',()=>{
  const result=compile('app Login page SignIn { ask Email as text validate nonempty }','ask-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.ui!.components[0]!.children).toEqual([{kind:'input',name:'Email',type:{kind:'primitive',name:'text'},validation:'nonempty',event:undefined}]);
 });
 it('lowers controlled-English when clicked declarations into page events',()=>{
  const result=compile('app Login page SignIn { when clicked ask Email as text on clicked }','event-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.ui!.components[0]!.events).toEqual([{name:'clicked',parameters:{}}]);
  expect(result.ir!.ui!.components[0]!.children).toEqual([{kind:'input',name:'Email',type:{kind:'primitive',name:'text'},validation:undefined,event:'clicked'}]);
 });
 it('lowers named click phrases into the existing page event IR',()=>{
  const source='app Login page SignIn { when Save is clicked ask Email as text on Save }';
  const result=compile(source,'named-click-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.ui!.components[0]!.events).toEqual([{name:'Save',parameters:{}}]);
  expect(result.ir!.ui!.components[0]!.children).toEqual([{kind:'input',name:'Email',type:{kind:'primitive',name:'text'},validation:undefined,event:'Save'}]);
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
 });
 it('rejects unsupported named click wording instead of guessing an event',()=>{
  const result=compile('app Login page SignIn { when Save is pressed }','bad-named-click-controlled.bmec');
  expect(result.diagnostics[0]?.kind).toBe('syntax');
 });
 it('lowers controlled-English authenticated serving into the existing auth policy boundary',async()=>{
  const source='app Secure function private() -> text { return "ok" } serve GET /private requiring authenticated with private';
  const result=compile(source,'auth-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({policyId:'authenticated'});
  const auth=new AuthService();
  const handle=await startNodeHttpSource(result.ir!,{configureRouter:router=>router.registerPolicy('authenticated',authenticatedSession(auth.sessions))});
  try{expect((await fetch(`${handle.url}/private`)).status).toBe(403);}finally{await handle.close();}
 });
 it('lowers controlled-English role serving into the server-owned auth policy boundary',async()=>{
  const source='app Secure function private() -> text { return "ok" } serve GET /private requiring role manager with private';
  const result=compile(source,'role-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({policyId:'role:manager'});
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  const auth=new AuthService();await auth.register('manager','manager pass',{role:'manager'});
  const handle=await startNodeHttpSource(result.ir!,{configureRouter:router=>router.registerPolicy('role:manager',rolePolicy(auth,'manager'))});
  try{expect((await fetch(`${handle.url}/private`)).status).toBe(403);const session=await auth.login('manager','manager pass');expect((await fetch(`${handle.url}/private`,{headers:{authorization:`Bearer ${session!.id}`}})).status).toBe(200);}finally{await handle.close();}
 });
 it('rejects a role policy without a role name',()=>expect(()=>parse('app Secure function private() -> text { return "ok" } serve GET /private requiring role with private','role-missing.bmec')).toThrow());
 it('lowers controlled-English attribute serving into the existing auth policy boundary',async()=>{
  const source='app Secure function private() -> text { return "ok" } serve GET /admin requiring attribute admin with private';
  const result=compile(source,'attribute-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.http!.routes[0]).toMatchObject({policyId:'attribute:admin'});
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  const auth=new AuthService();await auth.register('admin','admin pass',{admin:true});
  const handle=await startNodeHttpSource(result.ir!,{configureRouter:router=>router.registerPolicy('attribute:admin',principalAttributePolicy(auth,'admin',true))});
  try{expect((await fetch(`${handle.url}/admin`)).status).toBe(403);const session=await auth.login('admin','admin pass');expect((await fetch(`${handle.url}/admin`,{headers:{authorization:`Bearer ${session!.id}`}})).status).toBe(200);}finally{await handle.close();}
 });
 it('lowers controlled-English show declarations into component text children',()=>{
  const result=compile('app Login component SignIn { show "Welcome" ask Email as text } page Home { use SignIn }','component-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.ui!.components.find(component=>component.name==='SignIn')!.children).toEqual([{kind:'text',value:'Welcome'},{kind:'input',name:'Email',type:{kind:'primitive',name:'text'},validation:undefined,event:undefined}]);
 });
 it('lowers controlled-English buttons into canonical clickable UI nodes',()=>{
  const result=compile('app Login page Home { event clicked() use SignIn } component SignIn { button "Sign in" on clicked }','button-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.ui!.components.find(component=>component.name==='SignIn')!.children).toEqual([{kind:'button',label:'Sign in',event:'clicked'}]);
 });
 it('lowers component named-click phrases into the existing button event IR',()=>{
  const source='app Login component SignIn { when Save is clicked } page Home { use SignIn }';
  const result=compile(source,'component-named-click-controlled.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.ui!.components.find(component=>component.name==='SignIn')!.children).toEqual([{kind:'button',label:'Save',event:'Save'}]);
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
 });
});
