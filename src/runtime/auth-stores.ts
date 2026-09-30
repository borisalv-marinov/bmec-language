import {createHash,randomBytes} from 'node:crypto';
import type {AuthUser,Session,SessionRepository,UserStore} from './auth.js';

interface SqliteDatabase {exec(sql:string):unknown;prepare(sql:string):{run(...params:any[]):{changes:number};get(...params:any[]):unknown};transaction<T extends (...args:any[])=>any>(fn:T):()=>ReturnType<T>}

const tokenHash=(id:string)=>createHash('sha256').update(id).digest('hex');
const newSession=(userId:string,now:number,ttlMs:number):Session=>{
 if(!userId)throw new Error('PIPE-AUTH-004: session user ID is required');
 return {id:randomBytes(32).toString('base64url'),userId,createdAt:now,expiresAt:now+ttlMs};
};
const validateTtl=(ttlMs:number)=>{if(!Number.isFinite(ttlMs)||ttlMs<=0)throw new Error('PIPE-AUTH-003: session TTL must be positive')};

/** SQLite-backed session repository for a persistent, single-process runtime. */
export class SqliteSessionStore implements SessionRepository {
 private lastCleanup=0;
 constructor(private readonly db:SqliteDatabase,private readonly ttlMs=86400000){validateTtl(ttlMs);db.exec('CREATE TABLE IF NOT EXISTS bmec_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS bmec_sessions_expiry ON bmec_sessions(expires_at)');}
 create(userId:string,now=Date.now()):Session{const session=newSession(userId,now,this.ttlMs);this.db.prepare('INSERT INTO bmec_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(tokenHash(session.id),session.userId,session.createdAt,session.expiresAt);return session;}
 get(id:string,now=Date.now()):Session|undefined{this.cleanup(now);const hash=tokenHash(id);const row=this.db.prepare('SELECT user_id,created_at,expires_at FROM bmec_sessions WHERE token_hash=? AND expires_at>?').get(hash,now) as {user_id:string;created_at:number|bigint;expires_at:number|bigint}|undefined;if(!row){this.db.prepare('DELETE FROM bmec_sessions WHERE token_hash=? AND expires_at<=?').run(hash,now);return undefined;}return {id,userId:row.user_id,createdAt:Number(row.created_at),expiresAt:Number(row.expires_at)};}
 clearExpired(now=Date.now()):number{return this.db.prepare('DELETE FROM bmec_sessions WHERE expires_at<=?').run(now).changes;}
 revoke(id:string):void{this.db.prepare('DELETE FROM bmec_sessions WHERE token_hash=?').run(tokenHash(id));}
 rotate(id:string,userId:string,now=Date.now()):Session{const session=newSession(userId,now,this.ttlMs);this.db.transaction(()=>{this.db.prepare('INSERT INTO bmec_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(tokenHash(session.id),session.userId,session.createdAt,session.expiresAt);this.db.prepare('DELETE FROM bmec_sessions WHERE token_hash=?').run(tokenHash(id));})();return session;}
 private cleanup(now:number):void{if(now-this.lastCleanup>=60000){this.db.prepare('DELETE FROM bmec_sessions WHERE expires_at<=?').run(now);this.lastCleanup=now;}}
}

export interface PgSessionPool {query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount?:number|null}>}

const readUser=(row:Record<string,unknown>|undefined):AuthUser|undefined=>{
 if(!row)return undefined;
 try{const passwordHash=JSON.parse(String(row.password_hash)) as AuthUser['passwordHash'];const attributes=JSON.parse(String(row.attributes??'{}'));if(passwordHash?.algorithm!=='scrypt'||typeof passwordHash.salt!=='string'||typeof passwordHash.digest!=='string'||passwordHash.cost!==16384||!attributes||typeof attributes!=='object'||Array.isArray(attributes))throw new Error();return {id:String(row.id),passwordHash,attributes:attributes as AuthUser['attributes']};}catch{throw new Error('PIPE-AUTH-007: stored credential record is malformed');}
};

/** Persistent first-party credential stores for the reference runtime. */
export class SqliteUserStore implements UserStore {
 constructor(private readonly db:SqliteDatabase){db.exec('CREATE TABLE IF NOT EXISTS bmec_users (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, attributes TEXT NOT NULL)');}
 async get(id:string):Promise<AuthUser|undefined>{return readUser(this.db.prepare('SELECT id,password_hash,attributes FROM bmec_users WHERE id=?').get(id) as Record<string,unknown>|undefined);}
 async put(user:AuthUser):Promise<void>{try{this.db.prepare('INSERT INTO bmec_users(id,password_hash,attributes) VALUES(?,?,?)').run(user.id,JSON.stringify(user.passwordHash),JSON.stringify(user.attributes));}catch(error){if(error instanceof Error&&error.message.includes('UNIQUE constraint failed'))throw new Error('PIPE-AUTH-005: user already exists');throw error;}}
}

export class PostgresUserStore implements UserStore {
 constructor(private readonly pool:PgSessionPool){}
 async initialize():Promise<void>{await this.pool.query('CREATE TABLE IF NOT EXISTS bmec_users (id text PRIMARY KEY, password_hash text NOT NULL, attributes text NOT NULL)');}
 async get(id:string):Promise<AuthUser|undefined>{const result=await this.pool.query('SELECT id,password_hash,attributes FROM bmec_users WHERE id=$1',[id]);return readUser(result.rows[0]);}
 async put(user:AuthUser):Promise<void>{try{await this.pool.query('INSERT INTO bmec_users(id,password_hash,attributes) VALUES($1,$2,$3)',[user.id,JSON.stringify(user.passwordHash),JSON.stringify(user.attributes)]);}catch(error){if(error instanceof Error&&error.message.includes('duplicate key'))throw new Error('PIPE-AUTH-005: user already exists');throw error;}}
}

/** PostgreSQL-backed session repository shared safely by multiple app instances. */
export class PostgresSessionStore implements SessionRepository {
 private lastCleanup=0;
 constructor(private readonly pool:PgSessionPool,private readonly ttlMs=86400000){validateTtl(ttlMs);}
 async initialize():Promise<void>{await this.pool.query('CREATE TABLE IF NOT EXISTS bmec_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL)');await this.pool.query('CREATE INDEX IF NOT EXISTS bmec_sessions_expiry ON bmec_sessions(expires_at)');}
 async create(userId:string,now=Date.now()):Promise<Session>{const session=newSession(userId,now,this.ttlMs);await this.pool.query('INSERT INTO bmec_sessions(token_hash,user_id,created_at,expires_at) VALUES($1,$2,$3,$4)',[tokenHash(session.id),session.userId,session.createdAt,session.expiresAt]);return session;}
 async get(id:string,now=Date.now()):Promise<Session|undefined>{await this.cleanup(now);const hash=tokenHash(id);const result=await this.pool.query('SELECT user_id,created_at,expires_at FROM bmec_sessions WHERE token_hash=$1 AND expires_at>$2',[hash,now]);const row=result.rows[0];if(!row){await this.pool.query('DELETE FROM bmec_sessions WHERE token_hash=$1 AND expires_at<=$2',[hash,now]);return undefined;}return {id,userId:String(row.user_id),createdAt:Number(row.created_at),expiresAt:Number(row.expires_at)};}
 async clearExpired(now=Date.now()):Promise<number>{const result=await this.pool.query('DELETE FROM bmec_sessions WHERE expires_at<=$1',[now]);return result.rowCount??0;}
 async revoke(id:string):Promise<void>{await this.pool.query('DELETE FROM bmec_sessions WHERE token_hash=$1',[tokenHash(id)]);}
 async rotate(id:string,userId:string,now=Date.now()):Promise<Session>{const session=newSession(userId,now,this.ttlMs);await this.pool.query('WITH inserted AS (INSERT INTO bmec_sessions(token_hash,user_id,created_at,expires_at) VALUES($1,$2,$3,$4) RETURNING token_hash) DELETE FROM bmec_sessions WHERE token_hash=$5',[tokenHash(session.id),session.userId,session.createdAt,session.expiresAt,tokenHash(id)]);return session;}
 private async cleanup(now:number):Promise<void>{if(now-this.lastCleanup>=60000){await this.pool.query('DELETE FROM bmec_sessions WHERE expires_at<=$1',[now]);this.lastCleanup=now;}}
}
