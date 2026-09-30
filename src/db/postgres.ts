import type {Pool, PoolClient, QueryResult} from 'pg';
import type {DbOperation} from './ir.js';
import type {DbAdapter, DbResult} from './adapter.js';
import {compileSql} from './sql.js';

type Query = (text: string, parameters?: unknown[]) => Promise<QueryResult<Record<string, unknown>>>;

function adapterFor(query: Query, transactionScoped = false): DbAdapter {
  const execute = async <T>(operation: DbOperation, values: unknown[] = []): Promise<DbResult<T>> => {
    const compiled = compileSql(operation, values);
    const result = await query(compiled.text, compiled.parameters);
    const first = result.rows[0] as { id?: number | bigint | string } | undefined;
    return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length, ...(operation.kind === 'insert' && operation.returningId && first?.id !== undefined ? { insertedId: first.id } : {}) };
  };
  const transactionAdapter: DbAdapter = { execute, async transaction() { throw new Error('PIPE-DB-008: nested database transactions are not supported'); } };
  return {
    execute,
    async transaction<T>(work: (adapter: DbAdapter) => Promise<T>): Promise<T> {
      if (transactionScoped) throw new Error('PIPE-DB-008: nested database transactions are not supported');
      await query('BEGIN');
      try {
        const result = await work(transactionAdapter);
        await query('COMMIT');
        return result;
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    },
  };
}

/** PostgreSQL adapter using one leased client per transaction. The Pool and
 * PoolClient types stop at this host boundary; BMEC code sees only DbAdapter. */
export function postgresPoolAdapter(pool: Pick<Pool, 'query' | 'connect'>): DbAdapter {
  const base = adapterFor((text, parameters) => pool.query(text, parameters) as Promise<QueryResult<Record<string, unknown>>>);
  return {
    execute: base.execute,
    async transaction<T>(work: (adapter: DbAdapter) => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      try {
        const transactionAdapter = adapterFor((text, parameters) => client.query(text, parameters) as Promise<QueryResult<Record<string, unknown>>>);
        return await transactionAdapter.transaction(work);
      } finally {
        client.release();
      }
    },
  };
}
