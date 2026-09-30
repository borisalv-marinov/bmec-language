import {describe,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {compile} from '../src/compiler.js';
import {executeAsyncValue,publicValue,ListValue,RecordValue,PIPE_NONE} from '../src/core/interpreter.js';
import {issueCapability} from '../src/runtime/capabilities.js';
import {sqliteAdapter} from '../src/db/adapter.js';
import {ensureSqliteSchema} from '../src/db/sqlite.js';

describe('PIPE source database selection',()=>{
  it('types, lowers, and executes a source DB select through real SQLite',async()=>{
    const compiled=compile('app Store\nmodel Item { name text required }\nasync function list(db capability<database>) -> task<list<Item>> { return await databaseSelect(db, "Item") }');
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.ir!.functions.find(fn=>fn.name==='list')!.body[0]).toMatchObject({kind:'return',value:{kind:'await',operand:{kind:'call',type:'task<list<Item>>'}}});
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Item" (name) VALUES (?)').run('from-sqlite');
    const value=await executeAsyncValue(compiled.ir!.functions,'list',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    expect(publicValue(value)).toEqual([{id:1,name:'from-sqlite'}]);client.close();
  });
  it('filters source DB reads by the implicit generated integer id',async()=>{
    const compiled=compile('app Store\nmodel Item { name text required }\nasync function find(db capability<database>, rowId integer) -> task<list<Item>> { return wait for get items from Item where id is rowId using db }\nasync function findOrdered(db capability<database>, rowId integer) -> task<list<Item>> { return wait for get items from Item where id is rowId ordered by name ascending limited to 10 using db }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Item" (name) VALUES (?), (?)').run('first','second');
    const options={database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}};
    const value=await executeAsyncValue(compiled.ir!.functions,'find',[issueCapability('database'),2n],options);
    const ordered=await executeAsyncValue(compiled.ir!.functions,'findOrdered',[issueCapability('database'),2n],options);
    expect(publicValue(value)).toEqual([{id:2,name:'second'}]);expect(publicValue(ordered)).toEqual([{id:2,name:'second'}]);client.close();
  });
  it('allows a record field as the value of a filtered database read',async()=>{
    const compiled=compile('app Store\nmodel Product { name text required }\ntype Line { productId integer }\nasync function findProduct(db capability<database>, line Line) -> task<list<Product>> { return wait for get products from Product where id is line.productId using db }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO Product (name) VALUES (?), (?)').run('first','second');
    const value=await executeAsyncValue(compiled.ir!.functions,'findProduct',[issueCapability('database'),{productId:2n}],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    expect(publicValue(value)).toEqual([{id:2,name:'second'}]);client.close();
  });
  it('narrows a queried model before reading its generated ID',async()=>{
    const compiled=compile('app Store\nmodel Product { sku text required unique }\nasync function findId(db capability<database>, sku text) -> task<integer?> { let products = await get products from Product where sku is sku using db let product = first(products) if product != none { return product.id } else { return none } }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO Product (sku) VALUES (?), (?)').run('first','second');
    try{
      const value=await executeAsyncValue(compiled.ir!.functions,'findId',[issueCapability('database'),'second'],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
      expect(value).toBe(2n);
    }finally{client.close()}
  });
  it('filters a bounded source DB read by two typed predicates in SQLite',async()=>{
    const compiled=compile('app Journal\nmodel Post { title text required slug text required published boolean required }\nasync function find(db capability<database>, slug text) -> task<list<Post>> { return wait for get posts from Post where published is true and slug is slug ordered by title ascending limited to 1 using db }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    client.prepare('INSERT INTO Post (title,slug,published) VALUES (?,?,?),(?,?,?)').run('published','story',1,'draft','story',0);
    const result=await executeAsyncValue(compiled.ir!.functions,'find',[issueCapability('database'),'story'],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    expect(publicValue(result)).toEqual([{id:1,title:'published',slug:'story',published:true}]);client.close();
  });
  it('combines workspace, owner, and cursor predicates before the row limit',async()=>{
    const compiled=compile('app PulseBoardFixture\nmodel Task { workspaceId integer required ownerAuthId text required title text required }\nasync function next(db capability<database>, workspace integer, owner text, after integer) -> task<list<Task>> { return wait for get tasks from Task where workspaceId is workspace and ownerAuthId is owner and id is greater than after ordered by id ascending limited to 50 using db }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    client.prepare('INSERT INTO Task (workspaceId,ownerAuthId,title) VALUES (?,?,?),(?,?,?),(?,?,?),(?,?,?),(?,?,?)').run(7,'alice','before cursor',7,'alice','member next',7,'bob','foreign owner',8,'alice','foreign workspace',7,'alice','member later');
    const options={database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}};
    const result=await executeAsyncValue(compiled.ir!.functions,'next',[issueCapability('database'),7n,'alice',1n],options);
    expect(publicValue(result)).toEqual([{id:2,workspaceId:7,ownerAuthId:'alice',title:'member next'},{id:5,workspaceId:7,ownerAuthId:'alice',title:'member later'}]);client.close();
  });
  it('combines publication filtering with a strict server-side cursor predicate',async()=>{
    const compiled=compile('app Journal\nmodel Post { title text required slug text required published boolean required }\nasync function next(db capability<database>, after text) -> task<list<Post>> { return wait for get posts from Post where published is true and slug is greater than after ordered by slug ascending limited to 2 using db }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    client.prepare('INSERT INTO Post (title,slug,published) VALUES (?,?,?),(?,?,?),(?,?,?),(?,?,?)').run('first','a',1,'second','b',1,'draft','c',0,'fourth','d',1);
    const result=await executeAsyncValue(compiled.ir!.functions,'next',[issueCapability('database'),'a'],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    expect(publicValue(result)).toEqual([{id:2,title:'second',slug:'b',published:true},{id:4,title:'fourth',slug:'d',published:true}]);client.close();
  });
  it('type-checks every value inside grouped database predicate expressions',()=>{
    const compiled=compile('app CommunityIssues\nmodel Issue { title text required description text required }\nasync function search(db capability<database>, term text, after text) -> task<list<Issue>> { return wait for get issues from Issue where (title contains term or description contains term) and id is greater than after ordered by id ascending limited to 50 using db }');
    expect(compiled.diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
  });
  it('rejects an unclosed grouped database predicate',()=>{
    const compiled=compile('app CommunityIssues\nmodel Issue { title text required description text required }\nasync function search(db capability<database>, term text, after integer) -> task<list<Issue>> { return wait for get issues from Issue where (title contains term or description contains term and id is greater than after ordered by id ascending limited to 50 using db }');
    expect(compiled.diagnostics.length).toBeGreaterThan(0);
  });
  it('types, lowers, and executes a source DB insert through real SQLite',async()=>{
    const compiled=compile('app Store\nmodel Item { name text required }\nasync function add(db capability<database>) -> task<integer> { let payload Item = Item { name: "inserted" } return await databaseInsert(db, "Item", payload) }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    const value=await executeAsyncValue(compiled.ir!.functions,'add',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    expect(publicValue(value)).toBe(1);expect((client.prepare('SELECT name FROM "Item"').get() as {name:string}).name).toBe('inserted');client.close();
  });
  it('rejects a database insert with the wrong model value type',()=>{
    const compiled=compile('app Store\nmodel Item { name text required }\ntype Other { name text required }\nasync function add(db capability<database>) -> task<integer> { let payload Other = Other { name: "inserted" } return await databaseInsert(db, "Item", payload) }');
    expect(compiled.diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
  });
  it('returns the generated SQLite row id from a typed source insert',async()=>{
    const compiled=compile('app Store\nmodel Item { name text required }\nasync function add(db capability<database>) -> task<integer> { let payload Item = Item { name: "inserted" } return await databaseInsertId(db, "Item", payload) }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    const value=await executeAsyncValue(compiled.ir!.functions,'add',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!,{safeIntegers:true}),schema:compiled.ir!.db!}});
    expect(publicValue(value)).toBe(1);expect((client.prepare('SELECT name FROM "Item" WHERE id=1').get() as {name:string}).name).toBe('inserted');client.close();
  });
  it('runs typed total and enum-filtered counts in SQLite',async()=>{
    const compiled=compile('app Store\nenum Status { Open Active Done }\nmodel Item { name text required status Status required }\nasync function totals(db capability<database>) -> task<integer> { return await databaseCount(db, "Item") }\nasync function active(db capability<database>) -> task<integer> { return await databaseCountWhere(db, "Item", "status", "=", Status.Active()) }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Item" (name,status) VALUES (?,?)').run('one','Active');client.prepare('INSERT INTO "Item" (name,status) VALUES (?,?)').run('two','Done');
    const options={database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}};
    const total=await executeAsyncValue(compiled.ir!.functions,'totals',[issueCapability('database')],options);const active=await executeAsyncValue(compiled.ir!.functions,'active',[issueCapability('database')],options);
    expect(publicValue(total)).toBe(2);expect(publicValue(active)).toBe(1);client.close();
  });
  it('evaluates an awaited database count nested in arithmetic',async()=>{
    const compiled=compile('app Store\nmodel Item { name text required }\nasync function nextId(db capability<database>) -> task<integer> { let itemCount = (await databaseCount(db, "Item")) + 1 return itemCount }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Item" (name) VALUES (?)').run('existing');
    const value=await executeAsyncValue(compiled.ir!.functions,'nextId',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    expect(publicValue(value)).toBe(2);client.close();
  });
  it('counts rows with two typed predicates in SQLite without counting other owners',async()=>{
    const compiled=compile('app Store\nenum Status { Open Active Done }\nmodel Item { ownerAuthId text required status Status required }\nasync function ownTasks(db capability<database>, owner text) -> task<integer> { return await databaseCountWhere(db, "Item", "ownerAuthId", "=", owner, "status", "=", Status.Active()) }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    client.prepare('INSERT INTO "Item" (ownerAuthId,status) VALUES (?,?)').run('alice','Active');
    client.prepare('INSERT INTO "Item" (ownerAuthId,status) VALUES (?,?)').run('alice','Done');
    client.prepare('INSERT INTO "Item" (ownerAuthId,status) VALUES (?,?)').run('bob','Active');
    const count=await executeAsyncValue(compiled.ir!.functions,'ownTasks',[issueCapability('database'),'alice'],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    expect(publicValue(count)).toBe(1);client.close();
  });
  it('types, lowers, and executes a source DB update by implicit integer id',async()=>{
    const compiled=compile('app Store\nmodel Item { name text required }\nasync function change(db capability<database>) -> task<integer> { let payload Item = Item { name: "changed" } return await databaseUpdate(db, "Item", 1, payload) }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Item" (name) VALUES (?)').run('old');
    const value=await executeAsyncValue(compiled.ir!.functions,'change',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    expect(publicValue(value)).toBe(1);expect((client.prepare('SELECT name FROM "Item" WHERE id=1').get() as {name:string}).name).toBe('changed');client.close();
  });
  it('updates only when both workspace and owner predicates match in one SQLite statement',async()=>{
    const compiled=compile('app Store\nmodel Item { title text required ownerAuthId text required workspaceId integer required }\nasync function change(db capability<database>, owner text, workspace integer) -> task<integer> { let payload Item = Item { title: "changed", ownerAuthId: owner, workspaceId: workspace } return await databaseUpdateWhere(db, "Item", 1, payload, "ownerAuthId", owner, "workspaceId", workspace) }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    client.prepare('INSERT INTO Item (title,ownerAuthId,workspaceId) VALUES (?,?,?), (?,?,?)').run('owned','alice',101,'other workspace','alice',202);
    const options={database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}},token=issueCapability('database');
    try{
      await expect(executeAsyncValue(compiled.ir!.functions,'change',[token,'alice',101n],options)).resolves.toBe(1n);
      await expect(executeAsyncValue(compiled.ir!.functions,'change',[token,'alice',999n],options)).resolves.toBe(0n);
      expect(client.prepare('SELECT title,workspaceId FROM Item ORDER BY id').all()).toEqual([{title:'changed',workspaceId:101},{title:'other workspace',workspaceId:202}]);
    }finally{client.close()}
  });
  it('updates a row atomically through a schema-declared unique field',async()=>{
    const compiled=compile('app Store\nmodel Preference { owner text required unique workspace integer required }\nasync function save(db capability<database>, owner text, workspace integer) -> task<integer> { let payload Preference = Preference { owner: owner, workspace: workspace } return await databaseUpdateUniqueWhere(db, "Preference", owner, "owner", payload) }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO Preference (owner,workspace) VALUES (?,?)').run('alice',101);
    try{await expect(executeAsyncValue(compiled.ir!.functions,'save',[issueCapability('database'),'alice',202n],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}})).resolves.toBe(1n);expect(client.prepare('SELECT owner,workspace FROM Preference').get()).toEqual({owner:'alice',workspace:202});}finally{client.close()}
  });
  it('rejects unique-field updates through a field without a schema uniqueness constraint',()=>{
    const compiled=compile('app Store\nmodel Preference { owner text required workspace integer required }\nasync function save(db capability<database>, owner text, workspace integer) -> task<integer> { let payload Preference = Preference { owner: owner, workspace: workspace } return await databaseUpdateUniqueWhere(db, "Preference", owner, "owner", payload) }');
    expect(compiled.diagnostics.map(item=>item.code)).toContain('PIPE-DB-002');
  });
  it('types, lowers, and executes a source DB delete by implicit integer id',async()=>{
    const compiled=compile('app Store\nmodel Item { name text required }\nasync function remove(db capability<database>) -> task<integer> { return await databaseDelete(db, "Item", 1) }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Item" (name) VALUES (?)').run('gone');
    const value=await executeAsyncValue(compiled.ir!.functions,'remove',[issueCapability('database')],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
    expect(publicValue(value)).toBe(1);expect(client.prepare('SELECT count(*) AS count FROM "Item"').get()).toEqual({count:0});client.close();
  });
  it('deletes only when both workspace and owner predicates match in one SQLite statement',async()=>{
    const compiled=compile('app Store\nmodel Item { ownerAuthId text required workspaceId integer required }\nasync function remove(db capability<database>, owner text, workspace integer) -> task<integer> { return await databaseDeleteWhere(db, "Item", 1, "ownerAuthId", owner, "workspaceId", workspace) }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    client.prepare('INSERT INTO Item (ownerAuthId,workspaceId) VALUES (?,?),(?,?)').run('alice',101,'alice',202);
    const options={database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}},token=issueCapability('database');
    try{
      await expect(executeAsyncValue(compiled.ir!.functions,'remove',[token,'alice',101n],options)).resolves.toBe(1n);
      expect(client.prepare('SELECT ownerAuthId,workspaceId FROM Item').all()).toEqual([{ownerAuthId:'alice',workspaceId:202}]);
    }finally{client.close()}
  });
  it('decrements inventory atomically under concurrent requests',async()=>{
    const compiled=compile('app Store\nmodel Product { sku text required unique stock integer required }\nasync function reserve(db capability<database>, sku text, quantity integer) -> task<integer> { return await databaseDecrementWhere(db, "Product", "stock", quantity, "sku", sku) }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Product" (sku,stock) VALUES (?,?)').run('cup-01',1);
    const options={database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}},token=issueCapability('database');
    try{
      const results=await Promise.all([executeAsyncValue(compiled.ir!.functions,'reserve',[token,'cup-01',1n],options),executeAsyncValue(compiled.ir!.functions,'reserve',[token,'cup-01',1n],options)]);
      expect(results.map(publicValue).sort()).toEqual([0,1]);
      expect(client.prepare('SELECT stock FROM "Product" WHERE sku=?').get('cup-01')).toEqual({stock:0});
      await expect(executeAsyncValue(compiled.ir!.functions,'reserve',[token,'cup-01',0n],options)).rejects.toThrow('positive decrement amount');
      expect(client.prepare('SELECT stock FROM "Product" WHERE sku=?').get('cup-01')).toEqual({stock:0});
    }finally{client.close()}
  });
  it('allows an atomic stock decrement keyed by a model generated ID',async()=>{
    const compiled=compile('app Store\nmodel Product { sku text required unique stock integer required }\nasync function reserve(db capability<database>, productId integer, quantity integer) -> task<integer> { return await databaseDecrementWhere(db, "Product", "stock", quantity, "id", productId) }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO Product (sku,stock) VALUES (?,?)').run('cup-01',3);
    try{
      const count=await executeAsyncValue(compiled.ir!.functions,'reserve',[issueCapability('database'),1n,2n],{database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
      expect(count).toBe(1n);expect(client.prepare('SELECT stock FROM Product WHERE id=1').get()).toEqual({stock:1});
    }finally{client.close()}
  });
  it('returns an optional generated ID from a unique-key insert-if-absent operation',async()=>{
    const compiled=compile('app Store\nmodel Checkout { key text required unique total integer required }\nasync function create(db capability<database>, payload Checkout) -> task<integer?> { return await databaseInsertIdIfAbsent(db, "Checkout", payload, "key") }');
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);
    const options={database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}},token=issueCapability('database'),payload={key:'retry-1',total:120};
    try{
      await expect(executeAsyncValue(compiled.ir!.functions,'create',[token,payload],options)).resolves.toBe(1n);
      await expect(executeAsyncValue(compiled.ir!.functions,'create',[token,payload],options)).resolves.toBe(PIPE_NONE);
      expect(client.prepare('SELECT id,key,total FROM "Checkout"').all()).toEqual([{id:1,key:'retry-1',total:120}]);
    }finally{client.close()}
  });
  it('rejects a non-unique conflict field during source analysis',()=>{
    const compiled=compile('app Store\nmodel Checkout { key text required total integer required }\nasync function create(db capability<database>, payload Checkout) -> task<integer?> { return await databaseInsertIdIfAbsent(db, "Checkout", payload, "key") }');
    expect(compiled.diagnostics.map(item=>item.code)).toContain('PIPE-DB-002');
  });
  it('rolls earlier reservations back when a later item is unavailable',async()=>{
    const compiled=compile(`app Store
model Product { sku text required unique stock integer required }
async function reservePair(db capability<database>) -> task<result<integer,text>> {
  transaction using db {
    let first = await databaseDecrementWhere(db, "Product", "stock", 1, "sku", "available")
    let second = await databaseDecrementWhere(db, "Product", "stock", 1, "sku", "missing")
    if second == 0 { return err("unavailable") }
  }
  return ok(1)
}`);
    expect(compiled.diagnostics).toEqual([]);
    const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO "Product" (sku,stock) VALUES (?,?)').run('available',1);
    try{
      const database={adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!};
      await expect(executeAsyncValue(compiled.ir!.functions,'reservePair',[issueCapability('database')],{database})).resolves.toMatchObject({state:'err',payload:'unavailable'});
      expect(client.prepare('SELECT stock FROM "Product" WHERE sku=?').get('available')).toEqual({stock:1});
    }finally{client.close()}
  });
  it('rejects capability confusion and unknown model literals at compile time',()=>{
    const wrong=compile('app Store\nmodel Item { name text }\nasync function list(time capability<time>) -> task<list<Item>> { return await databaseSelect(time, "Item") }');
    expect(wrong.diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
    const unknown=compile('app Store\nmodel Item { name text }\nasync function list(db capability<database>) -> task<list<Item>> { return await databaseSelect(db, "Missing") }');
    expect(unknown.diagnostics.map(error=>error.code)).toContain('PIPE-DB-001');
  });
  it('rejects text-contains database predicates on non-text fields',()=>{
    const compiled=compile('app Store\nmodel Item { count integer required title text required }\nasync function search(db capability<database>, term text) -> task<list<Item>> { return wait for get items from Item where count contains term or title contains term ordered by title ascending limited to 10 using db }');
    expect(compiled.diagnostics.map(item=>item.code)).toContain('PIPE-FUNC-009');
  });
  it('rejects source DB execution without an injected adapter',async()=>{
    const compiled=compile('app Store\nmodel Item { name text }\nasync function list(db capability<database>) -> task<list<Item>> { return await databaseSelect(db, "Item") }');
    await expect(executeAsyncValue(compiled.ir!.functions,'list',[issueCapability('database')])).rejects.toThrow('PIPE-DB-003');
  });
  it('preserves int64 model IDs through source SQLite execution',async()=>{
    const compiled=compile('app Store\nmodel Item { id integer required name text required }\nasync function seed(db capability<database>) -> task<integer> { let payload Item = Item { id: 9007199254740993 name: "exact" } return await databaseInsert(db, "Item", payload) }\nasync function list(db capability<database>) -> task<list<Item>> { return await databaseSelect(db, "Item") }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);const options={database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}};
    const exactOptions={database:{adapter:sqliteAdapter(client,compiled.ir!.db!,{safeIntegers:true}),schema:compiled.ir!.db!}};await executeAsyncValue(compiled.ir!.functions,'seed',[issueCapability('database')],exactOptions);const value=await executeAsyncValue(compiled.ir!.functions,'list',[issueCapability('database')],exactOptions);const row=(value as ListValue).items[0] as RecordValue;
    expect(row.fields.get('id')).toBe(9007199254740993n);expect(row.fields.get('name')).toBe('exact');client.close();
  });
  it('round-trips exact money, temporal, boolean, and optional source fields',async()=>{
    const compiled=compile('app Store\nmodel Item { id integer required price money required day date required stamp datetime required active boolean required note text? }\nasync function seed(db capability<database>, payload Item) -> task<integer> { return await databaseInsert(db, "Item", payload) }\nasync function list(db capability<database>) -> task<list<Item>> { return await databaseSelect(db, "Item") }');
    expect(compiled.diagnostics).toEqual([]);const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);const options={database:{adapter:sqliteAdapter(client,compiled.ir!.db!,{safeIntegers:true}),schema:compiled.ir!.db!}};
    await executeAsyncValue(compiled.ir!.functions,'seed',[issueCapability('database'),{id:9007199254740993n,price:12.34,day:'2025-01-02',stamp:'2025-01-02T03:04:05Z',active:true,note:PIPE_NONE}],options);const value=await executeAsyncValue(compiled.ir!.functions,'list',[issueCapability('database')],options);const row=(value as ListValue).items[0] as RecordValue;
    expect(row.fields.get('id')).toBe(9007199254740993n);expect((row.fields.get('price') as {minor:bigint}).minor).toBe(1234n);expect((row.fields.get('day') as {value:string}).value).toBe('2025-01-02');expect((row.fields.get('stamp') as {value:string}).value).toBe('2025-01-02T03:04:05Z');expect(row.fields.get('active')).toBe(true);expect(row.fields.get('note')).toBeDefined();client.close();
  });
});
