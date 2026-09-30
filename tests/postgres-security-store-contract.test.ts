import {describe,expect,it} from 'vitest';
import {PostgresSessionStore,PostgresUserStore,type PgSessionPool} from '../src/runtime/auth-stores.js';
import {PostgresRateLimitStore} from '../src/http/rate-limit.js';

class RecordingPool implements PgSessionPool {
 readonly calls:{sql:string;values?:unknown[]}[]=[];
 async query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount?:number|null}>{this.calls.push({sql,values});if(sql.includes('RETURNING request_count'))return {rows:[{request_count:2}],rowCount:1};if(sql.includes('SELECT user_id,created_at,expires_at'))return {rows:[{user_id:'ada',created_at:'1000',expires_at:'2000'}]};if(sql.includes('SELECT id,password_hash,attributes'))return {rows:[]};return {rows:[],rowCount:1};}
}

describe('PostgreSQL security store query contracts',()=>{
 it('uses hashed session identifiers and parameterized persistent operations',async()=>{
  const pool=new RecordingPool(),sessions=new PostgresSessionStore(pool,1000);await sessions.initialize();const session=await sessions.create('ada',100);expect(session.expiresAt).toBe(1100);expect(pool.calls.at(-1)?.values?.[0]).not.toBe(session.id);expect(pool.calls.at(-1)?.sql).toContain('$1');expect(await sessions.get(session.id,200)).toMatchObject({userId:'ada',createdAt:1000,expiresAt:2000});await sessions.rotate(session.id,'ada',300);expect(pool.calls.at(-1)?.sql).toContain('WITH inserted AS');expect(pool.calls.at(-1)?.sql).toContain('DELETE FROM bmec_sessions');
 });
 it('uses an atomic PostgreSQL upsert for a shared bounded rate window',async()=>{
  const pool=new RecordingPool(),limits=new PostgresRateLimitStore(pool);await limits.initialize();const result=await limits.consume('login-account:ada',2,60_000,121_000);expect(result).toMatchObject({allowed:true,remaining:0});const query=pool.calls.find(call=>call.sql.includes('RETURNING request_count'))!;expect(query.sql).toContain('ON CONFLICT(key_hash) DO UPDATE');expect(query.values?.[0]).not.toBe('login-account:ada');expect(query.values?.[1]).toBe(120_000);
 });
 it('parameterizes durable users and stores only password hash metadata',async()=>{
  const pool=new RecordingPool(),users=new PostgresUserStore(pool);await users.initialize();const user={id:'ada',passwordHash:{algorithm:'scrypt' as const,salt:'salt',digest:'digest',cost:16384},attributes:{role:'admin'}};await users.put(user);const insert=pool.calls.at(-1)!;expect(insert.sql).toContain('VALUES($1,$2,$3)');expect(insert.values?.[0]).toBe('ada');expect(insert.values?.[1]).toContain('scrypt');expect(insert.values?.[1]).not.toContain('password');
 });
});
