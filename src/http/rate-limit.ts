import {createHash} from 'node:crypto';
import type {PgSessionPool} from '../runtime/auth-stores.js';

interface SqliteDatabase {exec(sql:string):unknown;prepare(sql:string):{run(...params:any[]):{changes:number};get(...params:any[]):unknown}}

export interface RateLimitResult {allowed:boolean;retryAfterSeconds:number;remaining:number}
export interface RateLimitStore {consume(key:string,limit:number,windowMs:number,now?:number):Promise<RateLimitResult>|RateLimitResult}
const digest=(key:string)=>createHash('sha256').update(key).digest('hex');
export const opaqueRateLimitKey=(key:string)=>digest(key);
const decision=(count:number,limit:number,windowStart:number,windowMs:number,now:number):RateLimitResult=>({allowed:count<=limit,retryAfterSeconds:Math.max(1,Math.ceil((windowStart+windowMs-now)/1000)),remaining:Math.max(0,limit-count)});

/** Bounded per-process fixed-window limiter for development and single-process use. */
export class MemoryRateLimitStore implements RateLimitStore {
 private readonly buckets=new Map<string,{start:number;count:number}>();
 constructor(private readonly maxKeys=10_000){if(!Number.isSafeInteger(maxKeys)||maxKeys<1)throw new Error('PIPE-RATE-001: invalid rate-limit key bound');}
 consume(key:string,limit:number,windowMs:number,now=Date.now()):RateLimitResult{validate(limit,windowMs);const start=Math.floor(now/windowMs)*windowMs;let bucket=this.buckets.get(key);if(!bucket||bucket.start!==start){bucket={start,count:0};this.buckets.delete(key);if(this.buckets.size>=this.maxKeys)this.buckets.delete(this.buckets.keys().next().value!);this.buckets.set(key,bucket);}bucket.count++;return decision(bucket.count,limit,start,windowMs,now);}
}
const validate=(limit:number,windowMs:number)=>{if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(windowMs)||windowMs<1000)throw new Error('PIPE-RATE-002: invalid rate-limit policy');};

/** SQLite limiter for a persistent single-process runtime. */
export class SqliteRateLimitStore implements RateLimitStore {
 private lastCleanup=0;
 constructor(private readonly db:SqliteDatabase){db.exec('CREATE TABLE IF NOT EXISTS bmec_rate_limits (key_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, request_count INTEGER NOT NULL)');db.exec('CREATE INDEX IF NOT EXISTS bmec_rate_limits_window ON bmec_rate_limits(window_start)');}
 consume(key:string,limit:number,windowMs:number,now=Date.now()):RateLimitResult{validate(limit,windowMs);const start=Math.floor(now/windowMs)*windowMs;const row=this.db.prepare('INSERT INTO bmec_rate_limits(key_hash,window_start,request_count) VALUES(?,?,1) ON CONFLICT(key_hash) DO UPDATE SET window_start=excluded.window_start,request_count=CASE WHEN bmec_rate_limits.window_start=excluded.window_start THEN bmec_rate_limits.request_count+1 ELSE 1 END RETURNING request_count').get(digest(key),start) as {request_count:number|bigint};if(now-this.lastCleanup>=windowMs){this.db.prepare('DELETE FROM bmec_rate_limits WHERE window_start<?').run(start-windowMs);this.lastCleanup=now;}return decision(Number(row.request_count),limit,start,windowMs,now);}
}

/** PostgreSQL fixed-window limiter with atomic upserts shared by all instances. */
export class PostgresRateLimitStore implements RateLimitStore {
 private lastCleanup=0;
 constructor(private readonly pool:PgSessionPool){}
 async initialize():Promise<void>{await this.pool.query('CREATE TABLE IF NOT EXISTS bmec_rate_limits (key_hash text PRIMARY KEY, window_start bigint NOT NULL, request_count integer NOT NULL)');await this.pool.query('CREATE INDEX IF NOT EXISTS bmec_rate_limits_window ON bmec_rate_limits(window_start)');}
 async consume(key:string,limit:number,windowMs:number,now=Date.now()):Promise<RateLimitResult>{validate(limit,windowMs);const start=Math.floor(now/windowMs)*windowMs;const result=await this.pool.query('INSERT INTO bmec_rate_limits(key_hash,window_start,request_count) VALUES($1,$2,1) ON CONFLICT(key_hash) DO UPDATE SET window_start=EXCLUDED.window_start,request_count=CASE WHEN bmec_rate_limits.window_start=EXCLUDED.window_start THEN bmec_rate_limits.request_count+1 ELSE 1 END RETURNING request_count',[digest(key),start]);if(now-this.lastCleanup>=windowMs){await this.pool.query('DELETE FROM bmec_rate_limits WHERE window_start<$1',[start-windowMs]);this.lastCleanup=now;}return decision(Number(result.rows[0]?.request_count??limit+1),limit,start,windowMs,now);}
}
