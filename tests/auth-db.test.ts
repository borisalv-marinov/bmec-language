import {afterEach,describe,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {sqliteAdapter} from '../src/db/adapter.js';
import {ensureSqliteSchema} from '../src/db/sqlite.js';
import {DbUserStore} from '../src/runtime/auth-db.js';
import {AuthService,SessionStore} from '../src/runtime/auth.js';
import type {DbSchema} from '../src/db/ir.js';
import {primitive} from '../src/types/type-ref.js';

const schema:DbSchema={version:1,models:[{id:'DB-AUTH',name:'AuthUser',fields:[
 {id:'AUTH-ID',name:'id',type:primitive('text'),primaryKey:true,required:true},
 {id:'AUTH-HASH',name:'password_hash',type:primitive('text'),required:true},
 {id:'AUTH-ATTR',name:'attributes',type:primitive('text'),required:true},
]}]};
describe('durable authentication database adapter',()=>{
 let client:InstanceType<typeof Database>;
 afterEach(()=>client?.close());
 it('persists hashes and attributes through the validated SQLite DB adapter',async()=>{
  client=new Database(':memory:');ensureSqliteSchema(client,schema);const db=sqliteAdapter(client,schema);const users=new DbUserStore(db,{model:'AuthUser',modelId:'DB-AUTH'});const auth=new AuthService(users,new SessionStore(1000));
  await auth.register('ada','correct horse',{admin:true});const raw=client.prepare('SELECT * FROM "AuthUser"').get() as Record<string,string>;expect(raw.password_hash).not.toContain('correct horse');expect(raw.attributes).toContain('admin');
  const second=new AuthService(users,new SessionStore(1000));const session=await second.login('ada','correct horse',100);expect(session?.userId).toBe('ada');expect(await second.login('ada','wrong horse',100)).toBeUndefined();
  await expect(auth.register('ada','another pass')).rejects.toThrow();
 });
 it('rejects malformed persisted credential records',async()=>{
  client=new Database(':memory:');ensureSqliteSchema(client,schema);client.prepare('INSERT INTO "AuthUser" (id,password_hash,attributes) VALUES (?,?,?)').run('ada','{}','{}');const db=sqliteAdapter(client,schema);await expect(new DbUserStore(db,{model:'AuthUser',modelId:'DB-AUTH'}).get('ada')).rejects.toThrow('PIPE-AUTH-007');
 });
});
