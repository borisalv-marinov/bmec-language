#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import Database from 'better-sqlite3';
import {Pool} from 'pg';
import {compile} from '../dist/compiler.js';
import {parse} from '../dist/parser/parser.js';
import {analyzeProgram} from '../dist/semantic/analyze.js';
import {executeValue} from '../dist/core/interpreter.js';
import {buildRelease} from '../dist/release/release.js';
import {startNodeHttp} from '../dist/http/node-adapter.js';
import {sqliteAdapter} from '../dist/db/adapter.js';
import {postgresPoolAdapter} from '../dist/db/postgres.js';
import {primitive} from '../dist/types/type-ref.js';

const source = `app Benchmark
model Item { name text required qty integer required }
function add(a integer, b integer) -> integer { return a + b }
function main() -> integer { return add(20, 22) }
`;
const iterations = Number(process.env.PIPE_BENCH_ITERATIONS ?? 20);
const outputPath = process.env.PIPE_BENCH_OUTPUT;
const samples = (fn, count = iterations) => {
  for (let i = 0; i < 3; i++) fn();
  const values = [];
  for (let i = 0; i < count; i++) { const start = performance.now(); fn(); values.push(performance.now() - start); }
  values.sort((a, b) => a - b);
  const at = p => values[Math.min(values.length - 1, Math.floor(values.length * p))];
  return {iterations: count, p50Ms: Number(at(.5).toFixed(3)), p95Ms: Number(at(.95).toFixed(3)), minMs: Number(values[0].toFixed(3)), maxMs: Number(values.at(-1).toFixed(3))};
};
const asyncSamples = async (fn, count = iterations) => {
  for (let i = 0; i < 3; i++) await fn();
  const values = [];
  for (let i = 0; i < count; i++) { const start = performance.now(); await fn(); values.push(performance.now() - start); }
  values.sort((a, b) => a - b);
  const at = p => values[Math.min(values.length - 1, Math.floor(values.length * p))];
  return {iterations: count, p50Ms: Number(at(.5).toFixed(3)), p95Ms: Number(at(.95).toFixed(3)), minMs: Number(values[0].toFixed(3)), maxMs: Number(values.at(-1).toFixed(3))};
};
const schema = {version: 1, models: [{id: 'BENCH-ITEM', name: 'bench_item', fields: [
  {id: 'BENCH-ID', name: 'id', type: primitive('integer'), primaryKey: true},
  {id: 'BENCH-NAME', name: 'name', type: primitive('text'), required: true},
  {id: 'BENCH-QTY', name: 'qty', type: primitive('integer'), required: true},
]}]};
const insert = {kind: 'insert', model: 'bench_item', modelId: 'BENCH-ITEM', values: {id: primitive('integer'), name: primitive('text'), qty: primitive('integer')}};
const select = {kind: 'select', model: 'bench_item', modelId: 'BENCH-ITEM', fields: ['id', 'name', 'qty'], where: {kind: 'compare', field: 'id', operator: '=', value: primitive('integer')}};
const update = {kind: 'update', model: 'bench_item', modelId: 'BENCH-ITEM', values: {qty: primitive('integer')}, where: {kind: 'compare', field: 'id', operator: '=', value: primitive('integer')}};
const remove = {kind: 'delete', model: 'bench_item', modelId: 'BENCH-ITEM', where: {kind: 'compare', field: 'id', operator: '=', value: primitive('integer')}};

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'pipe-bench-'));
  let commit = process.env.PIPE_BENCH_COMMIT ?? 'unknown';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(); } catch { /* isolated source copies need not contain .git */ }
  const result = {commit, node: process.version, platform: `${process.platform} ${process.arch}`, iterations};
  const sourceFile = join(root, 'main.pipe'); writeFileSync(sourceFile, source);
  result.compilerColdCheck = samples(() => execFileSync(process.execPath, ['dist/cli/index.js', 'check', sourceFile], {stdio: 'ignore'}), 5);
  result.compilerWarmCheck = samples(() => compile(source));
  const ast = parse(source);
  result.parser = samples(() => parse(source));
  result.semanticAnalysis = samples(() => analyzeProgram(ast));
  const ir = compile(source).ir;
  result.interpreter = samples(() => executeValue(ir.functions, 'main', []), 100);
  const releaseDir = join(root, 'release');
  result.releaseBuild = samples(() => buildRelease(ir, join(root, `release-${Math.random().toString(36).slice(2)}`), {packageName: 'benchmark', packageVersion: '0.1.0', languageVersion: '0.1-alpha'}), 5);
  buildRelease(ir, releaseDir, {packageName: 'benchmark', packageVersion: '0.1.0', languageVersion: '0.1-alpha'});
  result.browserBundleBytes = {indexHtml: readFileSync(join(releaseDir, 'index.html')).byteLength, appJs: readFileSync(join(releaseDir, 'app.js')).byteLength};
  const route = {id: 'health', method: 'GET', path: '/health', pathParams: [], query: [], headers: [], status: 200, handlerId: 'health'};
  const http = await startNodeHttp({routes: [route]}, router => router.register('health', () => ({status: 200, headers: {}, body: {ok: true}})));
  try { result.http = await asyncSamples(() => fetch(`${http.url}/health`), 50); } finally { await http.close(); }
  const sqlite = new Database(':memory:'); sqlite.exec('CREATE TABLE "bench_item" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "qty" INTEGER NOT NULL)');
  const sqliteDb = sqliteAdapter(sqlite, schema); let id = 1;
  result.sqliteCrud = await asyncSamples(async () => { const current = id++; await sqliteDb.execute(insert, [current, 'bench', 1]); await sqliteDb.execute(select, [current]); await sqliteDb.execute(update, [2, current]); await sqliteDb.execute(remove, [current]); }, 50); sqlite.close();
  const connection = process.env.BMEC_POSTGRES_URL;
  if (!connection) {
    if (process.env.BMEC_SKIP_POSTGRES_BENCHMARK === '1') {
      result.postgresCrud = {skipped: true, reason: 'BMEC_POSTGRES_URL unavailable'};
      rmSync(root, {recursive: true, force: true});
      const output = JSON.stringify(result, null, 2) + '\n';
      if (outputPath) writeFileSync(outputPath, output);
      process.stdout.write(output);
      return;
    }
    throw new Error('BMEC_POSTGRES_URL is required for the PostgreSQL benchmark');
  }
  const pool = new Pool({connectionString: connection}); const postgres = postgresPoolAdapter(pool);
  await pool.query('DROP TABLE IF EXISTS "bench_item"'); await pool.query('CREATE TABLE "bench_item" ("id" bigint PRIMARY KEY, "name" text NOT NULL, "qty" bigint NOT NULL)'); id = 1;
  try { result.postgresCrud = await asyncSamples(async () => { const current = id++; await postgres.execute(insert, [current, 'bench', 1]); await postgres.execute(select, [current]); await postgres.execute(update, [2, current]); await postgres.execute(remove, [current]); }, 20); } finally { await pool.query('DROP TABLE IF EXISTS "bench_item"'); await pool.end(); }
  const output = JSON.stringify(result, null, 2) + '\n';
  rmSync(root, {recursive: true, force: true});
  if (outputPath) writeFileSync(outputPath, output);
  process.stdout.write(output);
}
main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
