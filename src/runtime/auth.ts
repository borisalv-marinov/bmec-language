import {randomBytes,scrypt as derive, timingSafeEqual} from 'node:crypto';
const scrypt=(password:string,salt:Buffer)=>new Promise<Buffer>((resolve,reject)=>derive(password,salt,32,{N:16384,r:8,p:1},(error,key)=>error?reject(error):resolve(key)));
const DUMMY_PASSWORD_HASH:PasswordHash={algorithm:'scrypt',salt:Buffer.alloc(16).toString('base64url'),digest:Buffer.alloc(32).toString('base64url'),cost:16384};
export interface PasswordHash {algorithm:'scrypt';salt:string;digest:string;cost:number}
export interface Session {id:string;userId:string;createdAt:number;expiresAt:number}
export interface AuthUser {id:string;passwordHash:PasswordHash;attributes:Readonly<Record<string,string|number|boolean>>}
export async function hashPassword(password:string):Promise<PasswordHash>{if(typeof password!=='string'||password.length<8)throw new Error('PIPE-AUTH-001: password must contain at least 8 characters');const salt=randomBytes(16),digest=await scrypt(password,salt);return {algorithm:'scrypt',salt:salt.toString('base64url'),digest:digest.toString('base64url'),cost:16384}}
export async function verifyPassword(password:string,hash:PasswordHash):Promise<boolean>{if(hash.algorithm!=='scrypt'||hash.cost!==16384)return false;try{const digest=await scrypt(password,Buffer.from(hash.salt,'base64url'));const expected=Buffer.from(hash.digest,'base64url');return digest.length===expected.length&&timingSafeEqual(digest,expected)}catch{return false}}
export type MaybePromise<T> = T|Promise<T>;
export interface SessionRepository {create(userId:string,now?:number):MaybePromise<Session>;get(id:string,now?:number):MaybePromise<Session|undefined>;clearExpired(now?:number):MaybePromise<number>;revoke(id:string):MaybePromise<void>;rotate(id:string,userId:string,now?:number):MaybePromise<Session>}
export class SessionStore implements SessionRepository {private readonly sessions=new Map<string,Session>();constructor(private readonly ttlMs=86400000){if(!Number.isFinite(ttlMs)||ttlMs<=0)throw new Error('PIPE-AUTH-003: session TTL must be positive')}create(userId:string,now=Date.now()):Session{if(!userId)throw new Error('PIPE-AUTH-004: session user ID is required');const session={id:randomBytes(32).toString('base64url'),userId,createdAt:now,expiresAt:now+this.ttlMs};this.sessions.set(session.id,session);return session}get(id:string,now=Date.now()):Session|undefined{const session=this.sessions.get(id);if(!session)return undefined;if(session.expiresAt<=now){this.sessions.delete(id);return undefined}return session}clearExpired(now=Date.now()):number{let count=0;for(const [id,session] of this.sessions)if(session.expiresAt<=now){this.sessions.delete(id);count++}return count}revoke(id:string):void{this.sessions.delete(id)}rotate(id:string,userId:string,now=Date.now()):Session{const session=this.create(userId,now);this.revoke(id);return session}}

/** Credential persistence is a host concern; BMEC receives only authenticated
 * identity and policy decisions. This in-memory implementation is suitable
 * for isolated tests and can be replaced by a narrow durable adapter. */
export interface UserStore {get(id:string):Promise<AuthUser|undefined>;put(user:AuthUser):Promise<void>}
export class MemoryUserStore implements UserStore {
 private readonly users=new Map<string,AuthUser>();
 async get(id:string):Promise<AuthUser|undefined>{return this.users.get(id)}
 async put(user:AuthUser):Promise<void>{if(this.users.has(user.id))throw new Error('PIPE-AUTH-005: user already exists');this.users.set(user.id,user)}
}
export class AuthService {
 constructor(readonly users:UserStore=new MemoryUserStore(),readonly sessions:SessionRepository=new SessionStore()){}
 async register(id:string,password:string,attributes:Readonly<Record<string,string|number|boolean>>={}):Promise<AuthUser>{
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))throw new Error('PIPE-AUTH-006: invalid user ID');
  const user={id,passwordHash:await hashPassword(password),attributes:{...attributes}};
  await this.users.put(user);return user;
 }
 async login(id:string,password:string,now=Date.now(),replaceSessionId?:string):Promise<Session|undefined>{
  const user=await this.users.get(id);if(!user){await verifyPassword(password,DUMMY_PASSWORD_HASH);return undefined}if(!(await verifyPassword(password,user.passwordHash)))return undefined;
  return await (replaceSessionId?this.sessions.rotate(replaceSessionId,user.id,now):this.sessions.create(user.id,now));
 }
 logout(sessionId:string):MaybePromise<void>{return this.sessions.revoke(sessionId)}
 async rotateSession(sessionId:string,userId:string,now=Date.now()):Promise<Session>{return await this.sessions.rotate(sessionId,userId,now)}
 async userForSession(session:Session,now=Date.now()):Promise<AuthUser|undefined>{return this.users.get((await this.sessions.get(session.id,now))?.userId??'')}
}
