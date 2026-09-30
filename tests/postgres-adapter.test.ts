import {describe, expect, it} from 'vitest';
import {types} from 'pg';
import type {Pool} from 'pg';
import {postgresPoolAdapter} from '../src/db/postgres.js';
import {primitive} from '../src/types/type-ref.js';

const connection = process.env.BMEC_POSTGRES_URL;
const maybe = connection ? it : it.skip;

// Keep PostgreSQL temporal scalars in BMEC's canonical text representation at
// the host boundary. The driver otherwise materializes date/timestamp values
// as JavaScript Date objects, which are not BMEC Date/DateTime values.
types.setTypeParser(1082, value => value);
types.setTypeParser(1114, value => `${value.replace(' ', 'T')}Z`);
types.setTypeParser(1184, value => new Date(value).toISOString());

describe('PostgreSQL adapter integration', () => {
  it('keeps BEGIN, work, and ROLLBACK on the leased client', async () => {
    const events: string[] = [];
    const client = {
      async query(text: string) { events.push(`client:${text}`); return {rows: [], rowCount: 0}; },
      release() { events.push('release'); },
    };
    const pool = {
      async query(text: string) { events.push(`pool:${text}`); return {rows: [], rowCount: 0}; },
      async connect() { events.push('connect'); return client; },
    } as unknown as Pick<Pool, 'query' | 'connect'>;
    const db = postgresPoolAdapter(pool);
    await expect(db.transaction(async tx => {
      await tx.execute({kind: 'select', model: 'users'});
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(events).toEqual(['connect', 'client:BEGIN', 'client:SELECT * FROM "users"', 'client:ROLLBACK', 'release']);
  });
  it('uses RETURNING to expose inserted IDs from PostgreSQL', async () => {
    const calls: string[] = [];
    const db=postgresPoolAdapter({async query(text:string){calls.push(text);return {rows:[{id:'42'}],rowCount:1};},async connect(){throw new Error('not used');}} as unknown as Pick<Pool,'query'|'connect'>);
    const result=await db.execute({kind:'insert',model:'pipe_job',values:{title:primitive('text')},returningId:true},['created']);
    expect(calls).toEqual(['INSERT INTO "pipe_job" ("title") VALUES ($1) RETURNING "id"']);expect(result.insertedId).toBe('42');
  });
  it('uses a unique conflict target to insert once and returns no ID on replay',async()=>{
    const calls:Array<{text:string;parameters?:unknown[]}>=[];let count=0;
    const db=postgresPoolAdapter({async query(text:string,parameters?:unknown[]){calls.push({text,parameters});count++;return count===1?{rows:[{id:'5'}],rowCount:1}:{rows:[],rowCount:0};},async connect(){throw new Error('not used');}} as unknown as Pick<Pool,'query'|'connect'>);
    const operation={kind:'insert' as const,model:'Checkout',values:{key:primitive('text'),total:primitive('integer')},returningId:true,conflictField:'key'};
    expect((await db.execute(operation,['retry-1',120n])).insertedId).toBe('5');
    expect((await db.execute(operation,['retry-1',120n])).insertedId).toBeUndefined();
    expect(calls).toEqual([
      {text:'INSERT INTO "Checkout" ("key", "total") VALUES ($1, $2) ON CONFLICT ("key") DO NOTHING RETURNING "id"',parameters:['retry-1',120n]},
      {text:'INSERT INTO "Checkout" ("key", "total") VALUES ($1, $2) ON CONFLICT ("key") DO NOTHING RETURNING "id"',parameters:['retry-1',120n]},
    ]);
  });
  it('compiles total and filtered counts as parameterized PostgreSQL queries', async () => {
    const calls: Array<{text:string;parameters?:unknown[]}> = [];
    const db=postgresPoolAdapter({async query(text:string,parameters?:unknown[]){calls.push({text,parameters});return {rows:[{count:'3'}],rowCount:1};},async connect(){throw new Error('not used');}} as unknown as Pick<Pool,'query'|'connect'>);
    const total=await db.execute({kind:'count',model:'Task'});
    const filtered=await db.execute({kind:'count',model:'Task',where:{kind:'compare',field:'status',operator:'=',value:primitive('text')}},['Active']);
    expect(total.rows).toEqual([{count:'3'}]);expect(filtered.rows).toEqual([{count:'3'}]);
    expect(calls).toEqual([{text:'SELECT COUNT(*) AS "count" FROM "Task"',parameters:[]},{text:'SELECT COUNT(*) AS "count" FROM "Task" WHERE "status" = $1',parameters:['Active']}]);
  });
  it('compiles a stock decrement with an atomic non-negative guard',async()=>{
    const calls:Array<{text:string;parameters?:unknown[]}>=[];
    const db=postgresPoolAdapter({async query(text:string,parameters?:unknown[]){calls.push({text,parameters});return {rows:[],rowCount:1};},async connect(){throw new Error('not used');}} as unknown as Pick<Pool,'query'|'connect'>);
    const result=await db.execute({kind:'decrement',model:'Product',field:'stock',amountType:primitive('integer'),where:{kind:'compare',field:'sku',operator:'=',value:primitive('text')}},[2n,'cup-01',2n]);
    expect(result.rowCount).toBe(1);
    expect(calls).toEqual([{text:'UPDATE "Product" SET "stock" = "stock" - $1 WHERE "sku" = $2 AND "stock" >= $3',parameters:[2n,'cup-01',2n]}]);
  });

  maybe('executes the complete BMEC DB IR gate on real PostgreSQL', async () => {
    const {Pool} = await import('pg');
    const pool = new Pool({connectionString: connection});
    const db = postgresPoolAdapter(pool);
    try {
      await pool.query('CREATE TABLE "pipe_generated" ("id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, "name" text NOT NULL)');
      const created=await db.execute({kind:'insert',model:'pipe_generated',values:{name:primitive('text')},returningId:true},['Audit test']);
      expect(created.insertedId).toBe('1');
      await pool.query('CREATE TABLE "pipe_user" ("id" bigint PRIMARY KEY, "email" text NOT NULL UNIQUE)');
      await pool.query('CREATE TABLE "pipe_inventory" ("sku" text PRIMARY KEY, "stock" integer NOT NULL)');
      await pool.query('CREATE TABLE "pipe_checkout" ("id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, "key" text NOT NULL UNIQUE, "total" bigint NOT NULL)');
      const checkout={kind:'insert' as const,model:'pipe_checkout',values:{key:primitive('text'),total:primitive('integer')},returningId:true,conflictField:'key'};
      const replays=await Promise.all([db.execute(checkout,['retry-1',120n]),db.execute(checkout,['retry-1',120n])]);
      expect(replays.map(result=>result.insertedId===undefined?undefined:String(result.insertedId)).sort()).toEqual(['1',undefined].sort());
      expect((await pool.query('SELECT count(*)::int AS count FROM "pipe_checkout"')).rows).toEqual([{count:1}]);
      await pool.query('INSERT INTO "pipe_inventory" ("sku", "stock") VALUES ($1, $2)', ['cup-01', 1]);
      const decrement={kind:'decrement' as const,model:'pipe_inventory',field:'stock',amountType:primitive('integer'),where:{kind:'compare' as const,field:'sku',operator:'=' as const,value:primitive('text')}};
      expect((await db.execute(decrement,[1n,'cup-01',1n])).rowCount).toBe(1);
      expect((await db.execute(decrement,[1n,'cup-01',1n])).rowCount).toBe(0);
      expect((await db.execute<{stock:number}>({kind:'select',model:'pipe_inventory',fields:['stock'],where:{kind:'compare',field:'sku',operator:'=',value:primitive('text')}},['cup-01'])).rows).toEqual([{stock:0}]);
      await pool.query('CREATE TABLE "pipe_order" ("id" bigint PRIMARY KEY, "user_id" bigint NOT NULL REFERENCES "pipe_user"("id"), "amount" bigint NOT NULL, "day" date NOT NULL, "stamp" timestamptz NOT NULL, "note" text)');
      const userInsert = {kind: 'insert' as const, model: 'pipe_user', values: {id: primitive('id'), email: primitive('text')}};
      const orderInsert = {kind: 'insert' as const, model: 'pipe_order', values: {id: primitive('id'), user_id: primitive('id'), amount: primitive('money'), day: primitive('date'), stamp: primitive('datetime'), note: primitive('text')}};
      await db.execute(userInsert, [9007199254740993n, 'ada@example.test']);
      await db.execute(orderInsert, [9007199254740994n, 9007199254740993n, 1234567890123456789n, '2026-09-17', '2026-09-17T12:34:56Z', null]);
      const rows = await db.execute<{id: string; user_id: string; amount: string; day: string; stamp: string; note: string | null}>({kind: 'select', model: 'pipe_order', fields: ['id', 'user_id', 'amount', 'day', 'stamp', 'note'], where: {kind: 'compare', field: 'user_id', operator: '=', value: primitive('id')}, orderBy: {field: 'id'}, limit: 1}, [9007199254740993n]);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({id: '9007199254740994', user_id: '9007199254740993', amount: '1234567890123456789', day: '2026-09-17', note: null});
      expect(rows.rows[0]!.stamp).toContain('2026-09-17T12:34:56');
      const attack = "x'); DROP TABLE pipe_order; --";
      await db.execute({kind: 'insert', model: 'pipe_order', values: {id: primitive('id'), user_id: primitive('id'), amount: primitive('money'), day: primitive('date'), stamp: primitive('datetime'), note: primitive('text')}}, [9007199254740995n, 9007199254740993n, 2n, '2026-09-17', '2026-09-17T12:34:56Z', attack]);
      expect((await db.execute({kind: 'select', model: 'pipe_order', where: {kind: 'compare', field: 'note', operator: '=', value: primitive('text')}}, [attack])).rowCount).toBe(1);
      await db.execute({kind: 'update', model: 'pipe_order', values: {amount: primitive('money')}, where: {kind: 'compare', field: 'id', operator: '=', value: primitive('id')}}, [42n, 9007199254740994n]);
      expect((await db.execute<{amount: string}>({kind: 'select', model: 'pipe_order', fields: ['amount'], where: {kind: 'compare', field: 'id', operator: '=', value: primitive('id')}}, [9007199254740994n])).rows[0]!.amount).toBe('42');
      await db.execute({kind: 'delete', model: 'pipe_order', where: {kind: 'compare', field: 'id', operator: '=', value: primitive('id')}}, [9007199254740995n]);
      await expect(db.execute(userInsert, [9007199254740996n, 'ada@example.test'])).rejects.toThrow();
      await expect(db.execute(orderInsert, [9007199254740997n, 999999n, 1n, '2026-09-17', '2026-09-17T12:34:56Z', null])).rejects.toThrow();
      await expect(db.transaction(async tx => {
        await tx.execute(orderInsert, [9007199254740998n, 9007199254740993n, 7n, '2026-09-17', '2026-09-17T12:34:56Z', 'rolled back']);
        throw new Error('rollback');
      })).rejects.toThrow('rollback');
      const after = await db.execute({kind: 'select', model: 'pipe_order'});
      expect(after.rowCount).toBe(1);
    } finally {
      await pool.query('DROP TABLE IF EXISTS "pipe_order", "pipe_inventory", "pipe_checkout", "pipe_user", "pipe_generated" CASCADE');
      await pool.end();
    }
  });
});
