import type {DbAdapter} from '../db/adapter.js';
import {primitive} from '../types/type-ref.js';
import type {AuthUser,PasswordHash,UserStore} from './auth.js';

export interface DbUserStoreOptions {model:string;modelId:string;idField?:string;passwordHashField?:string;attributesField?:string}

/** Durable credential storage adapter. The database stores opaque hash
 * metadata and JSON attributes; password verification and session semantics
 * remain in AuthService. */
export class DbUserStore implements UserStore {
 private readonly idField:string;private readonly passwordHashField:string;private readonly attributesField:string;
 constructor(private readonly db:DbAdapter,private readonly options:DbUserStoreOptions){this.idField=options.idField??'id';this.passwordHashField=options.passwordHashField??'password_hash';this.attributesField=options.attributesField??'attributes';}
 async get(id:string):Promise<AuthUser|undefined>{
  const result=await this.db.execute<Record<string,unknown>>({kind:'select',model:this.options.model,modelId:this.options.modelId,fields:[this.idField,this.passwordHashField,this.attributesField],where:{kind:'compare',field:this.idField,operator:'=',value:primitive('text')}},[id]);
  const row=result.rows[0];if(!row)return undefined;try{const passwordHash=JSON.parse(String(row[this.passwordHashField])) as PasswordHash;const attributes=JSON.parse(String(row[this.attributesField]??'{}'));if(passwordHash?.algorithm!=='scrypt'||typeof passwordHash.salt!=='string'||typeof passwordHash.digest!=='string'||passwordHash.cost!==16384||!attributes||typeof attributes!=='object'||Array.isArray(attributes))throw new Error();return {id:String(row[this.idField]),passwordHash,attributes:attributes as Readonly<Record<string,string|number|boolean>>};}catch{throw new Error('PIPE-AUTH-007: stored credential record is malformed');}
 }
 async put(user:AuthUser):Promise<void>{
  await this.db.execute({kind:'insert',model:this.options.model,modelId:this.options.modelId,values:{[this.idField]:primitive('text'),[this.passwordHashField]:primitive('text'),[this.attributesField]:primitive('text')}},[user.id,JSON.stringify(user.passwordHash),JSON.stringify(user.attributes)]);
 }
}
