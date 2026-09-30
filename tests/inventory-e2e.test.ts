import {afterEach,describe,expect,it} from 'vitest';
import {readFileSync,mkdtempSync,cpSync,existsSync,rmSync} from 'node:fs';
import Database from 'better-sqlite3';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compileProject} from '../src/compiler.js';
import {startNodeHttpSource,type NodeHttpHandle} from '../src/http/node-adapter.js';
import {startNodeRelease} from '../src/release/server.js';
import {postgresPoolAdapter} from '../src/db/postgres.js';
import {sqliteAdapter} from '../src/db/adapter.js';
import {Pool} from 'pg';
import {AuthService} from '../src/runtime/auth.js';
import {rolePolicy} from '../src/http/auth-policy.js';
import {buildRelease} from '../src/release/release.js';
import {serializeValue} from '../src/runtime/value-contract.js';
import {issueCapability} from '../src/runtime/capabilities.js';
import {executeValue,ListValue,RecordValue,Money} from '../src/core/interpreter.js';
import {ensureSqliteSchema} from '../src/db/sqlite.js';

const handles:NodeHttpHandle[]=[];const pools:Pool[]=[];const sqliteClients:InstanceType<typeof Database>[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const pool of pools.splice(0))await pool.end();for(const client of sqliteClients.splice(0))client.close()});

const connection=process.env.BMEC_POSTGRES_URL;const maybe=connection?it:it.skip;
describe('BMEC Inventory validation application',()=>{
 it('uses controlled-English database routes and manager-only CRUD policies in canonical IR',()=>{const entry=join(process.cwd(),'examples','inventory','main.pipe');const compiled=compileProject(entry);expect(compiled.diagnostics).toEqual([]);expect(compiled.ir!.apis).toEqual(expect.arrayContaining([expect.objectContaining({route:'/products',policyId:'role:manager'}),expect.objectContaining({route:'/stock',policyId:'role:manager'})]));expect(compiled.ir!.http!.routes.filter(route=>['/inventory','/products','/products/:id','/stock','/stock/:id'].includes(route.path))).toEqual(expect.arrayContaining([expect.objectContaining({path:'/inventory',method:'GET',capabilities:['database']}),expect.objectContaining({path:'/products',method:'POST',capabilities:['database'],policyId:'role:manager'}),expect.objectContaining({path:'/stock',method:'GET',capabilities:['database'],policyId:'role:manager'})]));expect(compiled.ir!.http!.routes.filter(route=>['/products','/products/:id','/stock','/stock/:id'].includes(route.path)).every(route=>route.policyId==='role:manager')).toBe(true);});
 it('uses controlled-English product creation over canonical insert IR',()=>{const entry=join(process.cwd(),'examples','inventory','main.pipe');const source=readFileSync(entry,'utf8');expect(source).toContain('wait for add body to Product using db');const compiled=compileProject(entry);expect(compiled.diagnostics).toEqual([]);const create=(compiled.ir!.functions.find(fn=>fn.name==='createProduct')!.body[0] as any).value.operand;expect(create).toMatchObject({kind:'call',callee:'databaseInsert'});});
 it('compiles the second application and derives a server-free release',()=>{
  const entry=join(process.cwd(),'examples','inventory','main.pipe');const compiled=compileProject(entry);
  expect(compiled.diagnostics).toEqual([]);expect(compiled.modules).toHaveLength(3);
  expect(compiled.ir?.models.map(model=>model.name)).toEqual(['Product','StockEntry']);
  expect(compiled.ir?.models.find(model=>model.name==='Product')?.fields.some(field=>field.type==='money')).toBe(true);
  expect(compiled.ir?.models.find(model=>model.name==='StockEntry')?.fields.some(field=>field.type==='datetime')).toBe(true);
  expect(compiled.ir?.http?.routes.some(route=>route.path==='/stock')).toBe(true);
  const listProducts=compiled.ir?.functions.find(fn=>fn.name==='listProducts')!;const productQuery=(listProducts.body[0] as any).value.operand;expect(productQuery).toMatchObject({kind:'call',callee:'databaseSelect'});expect(productQuery.args[2]).toMatchObject({value:'name'});expect(productQuery.args[3]).toMatchObject({value:'ascending'});expect(productQuery.args[4]).toMatchObject({value:'50'});
  const listStock=compiled.ir?.functions.find(fn=>fn.name==='listStock')!;const stockQuery=(listStock.body[0] as any).value.operand;expect(stockQuery).toMatchObject({kind:'call',callee:'databaseSelect'});expect(stockQuery.args[2]).toMatchObject({value:'received'});expect(stockQuery.args[3]).toMatchObject({value:'descending'});
  const affordable=executeValue(compiled.ir!.functions,'affordable',[[new RecordValue(new Map([['name','Cheap'],['price',new Money(1000n)]])),new RecordValue(new Map([['name','Costly'],['price',new Money(5000n)]]))],new Money(2000n)]) as ListValue;
  expect(affordable.items).toHaveLength(1);
  const output=join(mkdtempSync(join(tmpdir(),'pipe-inventory-release-')),'out');buildRelease(compiled.ir!,output,{packageName:'inventory',packageVersion:'0.1.0',languageVersion:'0.1-alpha'});
  const browser=readFileSync(join(output,'index.html'),'utf8');const server=readFileSync(join(output,'server-ir.json'),'utf8');
  expect(browser).toContain('data-pipe-component="COMP-001"');expect(browser).toContain('Add product');expect(browser).toContain('data-pipe-page="/stock"');expect(browser).not.toContain('databaseSelect');expect(server).toContain('databaseSelect');
 });
 it('passes the external CLI project flow from an isolated copy',()=>{
  const root=mkdtempSync(join(tmpdir(),'pipe-inventory-cli-'));cpSync(join(process.cwd(),'examples','inventory'),root,{recursive:true});const cli=join(process.cwd(),'dist','cli','index.js');const main=join(root,'main.pipe');
  execFileSync(process.execPath,[cli,'fmt',main,'--write'],{cwd:root});expect(execFileSync(process.execPath,[cli,'fmt',main,'--check'],{cwd:root,encoding:'utf8'})).toContain('Formatted');expect(execFileSync(process.execPath,[cli,'check',main],{cwd:root,encoding:'utf8'})).toContain('OK');expect(execFileSync(process.execPath,[cli,'lock',main],{cwd:root,encoding:'utf8'})).toContain('Locked inventory');expect(execFileSync(process.execPath,[cli,'build',main,'--release'],{cwd:root,encoding:'utf8'})).toContain('Released');const release=join(root,'release');expect(existsSync(join(release,'index.html'))).toBe(true);expect(readFileSync(join(release,'server-ir.json'),'utf8')).not.toContain(process.cwd());rmSync(root,{recursive:true,force:true});
 });
 it('launches the Inventory release server and protects product CRUD with its declared manager policy',async()=>{
  const entry=join(process.cwd(),'examples','inventory','main.pipe');const compiled=compileProject(entry);const output=join(mkdtempSync(join(tmpdir(),'pipe-inventory-server-')),'release');buildRelease(compiled.ir!,output,{packageName:'inventory',packageVersion:'0.1.0',languageVersion:'0.1-alpha'});
  const client=new Database(':memory:');sqliteClients.push(client);ensureSqliteSchema(client,compiled.ir!.db!);const db=sqliteAdapter(client,compiled.ir!.db!);
  const auth=new AuthService();await auth.register('manager','manager pass',{role:'manager'});const manager=await auth.login('manager','manager pass');const managerHeaders={authorization:`Bearer ${manager!.id}`};const handle=await startNodeRelease(output,{database:{adapter:db,schema:compiled.ir!.db!},capabilityTokens:new Map([['database',issueCapability('database')]]),configureRouter:router=>router.registerPolicy('role:manager',rolePolicy(auth,'manager'))});handles.push(handle);const page=await fetch(`${handle.url}/`);expect(page.status).toBe(200);expect(await page.text()).toContain('data-pipe-page="/stock"');const createProduct=compiled.ir!.functions.find(fn=>fn.name==='createProduct')!;const bodyType=createProduct.parameters.find(parameter=>parameter.name==='body')!.typeRef;const product=serializeValue({kind:'model',type:bodyType,fields:{name:{kind:'text',value:'Released'},price:{kind:'money',minor:1250n,scale:2},category:{kind:'optional',inner:null},available:{kind:'boolean',value:true}}});expect((await fetch(`${handle.url}/products`)).status).toBe(403);const denied=await fetch(`${handle.url}/products`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(product)});expect(denied.status).toBe(403);const created=await fetch(`${handle.url}/products`,{method:'POST',headers:{'content-type':'application/json',...managerHeaders},body:JSON.stringify(product)});expect(created.status).toBe(200);expect(await created.json()).toBe(1);expect(await (await fetch(`${handle.url}/products`,{headers:managerHeaders})).json()).toMatchObject([{name:'Released',price:12.5}]);
 });
 maybe('runs protected Product and Stock CRUD through real PostgreSQL with two server-side roles',async()=>{
  const entry=join(process.cwd(),'examples','inventory','main.pipe');const compiled=compileProject(entry);expect(compiled.diagnostics).toEqual([]);const ir=compiled.ir!;
  const pool=new Pool({connectionString:connection});pools.push(pool);const db=postgresPoolAdapter(pool);await pool.query('DROP TABLE IF EXISTS "StockEntry", "Product" CASCADE');await pool.query('CREATE TABLE "Product" ("id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,"name" text NOT NULL,"price" bigint NOT NULL,"category" text,"available" boolean NOT NULL DEFAULT true)');await pool.query('CREATE TABLE "StockEntry" ("id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,"product" bigint NOT NULL REFERENCES "Product"("id"),"quantity" bigint NOT NULL,"received" timestamptz NOT NULL,"note" text)');
  const auth=new AuthService();await auth.register('staff','staff pass',{role:'staff'});await auth.register('manager','manager pass',{role:'manager'});
  const handle=await startNodeHttpSource(ir,{database:{adapter:db,schema:ir.db!},capabilityTokens:new Map([['database',issueCapability('database')]]),configureRouter:router=>router.registerPolicy('role:manager',rolePolicy(auth,'manager'))});handles.push(handle);
  const noAuth=await fetch(`${handle.url}/products`);expect(noAuth.status).toBe(403);const staff=await auth.login('staff','staff pass');const manager=await auth.login('manager','manager pass');const staffHeaders={authorization:`Bearer ${staff!.id}`};const managerHeaders={authorization:`Bearer ${manager!.id}`};
  const deniedStock=await fetch(`${handle.url}/stock`,{headers:staffHeaders});expect(deniedStock.status).toBe(403);const deniedProducts=await fetch(`${handle.url}/products`,{headers:staffHeaders});expect(deniedProducts.status).toBe(403);const empty=await fetch(`${handle.url}/products`,{headers:managerHeaders});expect(empty.status).toBe(200);expect(await empty.json()).toEqual([]);
  const createProduct=ir.functions.find(fn=>fn.name==='createProduct')!;const bodyType=createProduct.parameters.find(parameter=>parameter.name==='body')!.typeRef;const product=serializeValue({kind:'model',type:bodyType,fields:{name:{kind:'text',value:'Keyboard'},price:{kind:'money',minor:4999n,scale:2},category:{kind:'optional',inner:{kind:'text',value:'hardware'}},available:{kind:'boolean',value:true}}});
  const created=await fetch(`${handle.url}/products`,{method:'POST',headers:{'content-type':'application/json',...managerHeaders},body:JSON.stringify(product)});expect(created.status).toBe(200);expect(await created.json()).toBe(1);
  const rows=await fetch(`${handle.url}/products`,{headers:managerHeaders});expect(await rows.json()).toEqual([{id:1,name:'Keyboard',price:49.99,category:'hardware',available:true}]);const stock=await fetch(`${handle.url}/stock`,{headers:managerHeaders});expect(stock.status).toBe(200);expect(await stock.json()).toEqual([]);
 });
});
