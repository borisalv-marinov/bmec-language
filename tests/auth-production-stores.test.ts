import {afterEach,describe,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {AuthService} from '../src/runtime/auth.js';
import {SqliteSessionStore,SqliteUserStore} from '../src/runtime/auth-stores.js';
import {MemoryRateLimitStore,SqliteRateLimitStore} from '../src/http/rate-limit.js';

describe('persistent authentication and rate-limit stores',()=>{
 let db:InstanceType<typeof Database>;
 afterEach(()=>db?.close());
 it('persists credentials and opaque session hashes across service instances',async()=>{
  db=new Database(':memory:');const users=new SqliteUserStore(db),sessions=new SqliteSessionStore(db,5000);const first=new AuthService(users,sessions);await first.register('ada','correct horse',{role:'admin'});const login=await first.login('ada','correct horse',1000);expect(login).toBeTruthy();
  const second=new AuthService(new SqliteUserStore(db),new SqliteSessionStore(db,5000));expect(await second.userForSession(login!,1500)).toMatchObject({id:'ada',attributes:{role:'admin'}});expect(db.prepare('SELECT token_hash FROM bmec_sessions').get()).not.toEqual({token_hash:login!.id});
  const rotated=await second.login('ada','correct horse',2000,login!.id);expect(rotated?.id).not.toBe(login!.id);expect(await first.userForSession(login!,2000)).toBeUndefined();expect(await first.userForSession(rotated!,2000)).toMatchObject({id:'ada'});
  await second.logout(rotated!.id);expect(await first.userForSession(rotated!,2000)).toBeUndefined();
 });
 it('expires durable sessions and cleans expired rows',()=>{
  db=new Database(':memory:');const sessions=new SqliteSessionStore(db,100);const expired=sessions.create('ada',1000),active=sessions.create('ada',1050);expect(sessions.get(expired.id,1100)).toBeUndefined();expect(sessions.get(active.id,1100)?.userId).toBe('ada');expect(sessions.clearExpired(1200)).toBe(1);
 });
 it('shares atomic fixed-window limits across SQLite store instances',()=>{
  db=new Database(':memory:');const first=new SqliteRateLimitStore(db),second=new SqliteRateLimitStore(db);expect(first.consume('login:ip',2,10000,1000).allowed).toBe(true);expect(second.consume('login:ip',2,10000,1500).allowed).toBe(true);const blocked=first.consume('login:ip',2,10000,2000);expect(blocked).toMatchObject({allowed:false,remaining:0});expect(second.consume('login:ip',2,10000,10000).allowed).toBe(true);
 });
 it('bounds in-memory limiter keys and resets fixed windows',()=>{
  const limiter=new MemoryRateLimitStore(2);expect(limiter.consume('x',1,1000,0).allowed).toBe(true);expect(limiter.consume('x',1,1000,100).allowed).toBe(false);expect(limiter.consume('x',1,1000,1000).allowed).toBe(true);limiter.consume('y',1,1000,1000);limiter.consume('z',1,1000,1000);expect(limiter.consume('x',1,1000,1000).allowed).toBe(true);
 });
});
