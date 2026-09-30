import {spawn} from 'node:child_process';
import {Pool} from 'pg';
import {randomBytes} from 'node:crypto';
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {compileProject} from '../dist/compiler.js';
import {serializeValue} from '../dist/runtime/value-contract.js';
import {migratePostgresSchema} from '../dist/runtime/postgres-migration.js';

const baseConnection = process.env.BMEC_POSTGRES_URL;
if (!baseConnection) throw new Error('BMEC_POSTGRES_URL is required');
if (process.env.BMEC_POSTGRES_DISPOSABLE !== '1') throw new Error('Set BMEC_POSTGRES_DISPOSABLE=1 only for a verified disposable PostgreSQL target');
const rowCount = Number(process.env.BMEC_EXPLORER_ROWS ?? 250_000);
if (!Number.isInteger(rowCount) || rowCount < 100 || rowCount > 1_000_000) throw new Error('BMEC_EXPLORER_ROWS must be an integer from 100 to 1,000,000');
const project = compileProject(join(process.cwd(), 'examples', 'data-explorer', 'main.pipe'));
if (project.diagnostics.length) throw new Error(`Data Explorer compile failed: ${project.diagnostics.map(diagnostic => diagnostic.code).join(', ')}`);

const schema = `bmec_explorer_${process.pid}_${randomBytes(4).toString('hex')}`;
const scopedUrl = new URL(baseConnection);
scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
const pool = new Pool({connectionString: baseConnection});
const scopedPool = new Pool({connectionString: scopedUrl.toString()});
let child;
let schemaCreated = false;
let adminCookie;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const waitForUrl = process => new Promise((resolve, reject) => {
  let output = '';
  const onData = chunk => { output += chunk.toString(); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); };
  process.stdout.on('data', onData);
  process.stderr.on('data', chunk => { output += chunk.toString(); process.stderr.write(chunk); });
  process.once('error', reject);
  process.once('exit', code => { if (code && !output.includes('http://127.0.0.1:')) reject(new Error(`server exited with ${code}: ${output}`)); });
});
const stop = process => new Promise(resolve => {
  if (!process || process.exitCode !== null) return resolve();
  process.once('exit', resolve);
  process.kill('SIGINT');
  setTimeout(() => { process.kill('SIGKILL'); resolve(); }, 3000);
});
const routeRows = async (base, path) => {
  const response = await fetch(`${base}${path}`, {headers: adminCookie ? {cookie: adminCookie} : {}});
  assert(response.status === 200, `${path} returned HTTP ${response.status}`);
  return response.json();
};
const checkRows = (rows, label, filter = () => true, cursor = undefined) => {
  assert(rows.length === 50, `${label} returned ${rows.length} rows`);
  assert(rows.every(filter), `${label} returned a row outside its filter`);
  assert(rows.every((row, index) => index === 0 || rows[index - 1].name < row.name), `${label} is not uniquely ordered by name`);
  if (cursor !== undefined) assert(rows.every(row => row.name > cursor), `${label} returned a row at/before its cursor`);
};

try {
  const serverVersion = (await pool.query('SELECT version() AS version')).rows[0].version;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await migratePostgresSchema(scopedPool,project.ir.db);
  await scopedPool.query(`INSERT INTO "Region" ("name") SELECT 'Region ' || n FROM generate_series(1, 100) AS n`);
  const seedStarted = performance.now();
  await scopedPool.query(`INSERT INTO "ExplorerRecord" ("name", "category", "region", "value", "active") SELECT 'Record ' || lpad((n - 1)::text, 7, '0'), 'Category ' || ((n - 1) % 200), ((n - 1) % 100) + 1, (n - 1) % 100000, ((n - 1) % 2 = 0) FROM generate_series(1, $1::integer) AS n`, [rowCount]);
  const seedMs = performance.now() - seedStarted;
  await scopedPool.query('ANALYZE "ExplorerRecord"');

  const planSql = {
    regionCursor: `EXPLAIN SELECT "id", "name", "category", "region", "value", "active" FROM "ExplorerRecord" WHERE "region" = 3 AND "name" > 'Record 0012344' ORDER BY "name" ASC LIMIT 50`,
    categoryCursor: `EXPLAIN SELECT "id", "name", "category", "region", "value", "active" FROM "ExplorerRecord" WHERE "category" = 'Category 7' AND "name" > 'Record 0012344' ORDER BY "name" ASC LIMIT 50`,
  };
  const plans = {};
  for (const [kind, sql] of Object.entries(planSql)) {
    plans[kind] = (await scopedPool.query(sql)).rows.map(row => row['QUERY PLAN']);
    const expectedIndex = kind === 'regionCursor' ? 'ExplorerRecord_region_name' : 'ExplorerRecord_category_name';
    assert(plans[kind].join('\n').includes(expectedIndex), `${kind} did not select ${expectedIndex}: ${plans[kind].join(' | ')}`);
  }

  const authUsers = JSON.stringify([{id: 'admin', password: 'admin-pass-123', role: 'admin'}]);
  child = spawn(process.execPath, ['dist/cli/index.js', 'run', 'examples/data-explorer/main.pipe'], {env: {...process.env, BMEC_PORT: '0', BMEC_POSTGRES_URL: scopedUrl.toString(), BMEC_AUTH_USERS: authUsers}, stdio: ['ignore', 'pipe', 'pipe']});
  const base = await waitForUrl(child);
  const login = await fetch(`${base}/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: 'admin', password: 'admin-pass-123'})});
  assert(login.status === 200, `admin login returned HTTP ${login.status}`);
  adminCookie = login.headers.getSetCookie?.()[0]?.split(';')[0] ?? login.headers.get('set-cookie')?.split(';')[0];
  const startedAt = performance.now();
  for (const kind of ['all', 'region', 'regionCursor', 'category', 'categoryCursor', 'cursor']) {
    const paths = {
      all: '/records/page',
      region: '/records/region/3',
      regionCursor: `/records/region/3/pages/${encodeURIComponent('Record 0012344')}`,
      category: '/records/category/Category%207',
      categoryCursor: `/records/category/Category%207/pages/${encodeURIComponent('Record 0012344')}`,
      cursor: `/records/page/${encodeURIComponent('Record 0012344')}`,
    };
    const rows = await routeRows(base, paths[kind]);
    const filter = kind.startsWith('region') ? row => Number(row.region?.id ?? row.region) === 3 : kind.startsWith('category') ? row => row.category === 'Category 7' : () => true;
    checkRows(rows, kind, filter, kind.toLowerCase().includes('cursor') ? 'Record 0012344' : undefined);
  }
  const firstPage = await routeRows(base, '/records/page');
  const cursorPages = [firstPage];
  for (let page = 0; page < 2; page++) cursorPages.push(await routeRows(base, `/records/page/${encodeURIComponent(cursorPages.at(-1).at(-1).name)}`));
  const visited = cursorPages.flat().map(row => row.name);
  assert(new Set(visited).size === 150, 'unfiltered cursor continuation returned duplicates');
  assert(visited[0] === 'Record 0000000' && visited.at(-1) === 'Record 0000149', 'first three cursor pages returned an unexpected range');
  const deepPage = await routeRows(base, `/records/page/${encodeURIComponent(`Record ${String(rowCount - 51).padStart(7, '0')}`)}`);
  assert(deepPage.length === 50 && deepPage[0].name === `Record ${String(rowCount - 50).padStart(7, '0')}` && deepPage.at(-1).name === `Record ${String(rowCount - 1).padStart(7, '0')}`, 'deep cursor page returned an unexpected range');
  const summaryRows = await routeRows(base, '/records/summary');
  const summary = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
  const activeExpected = Math.ceil(rowCount / 2);
  assert(Number(summary?.total) === rowCount && Number(summary?.active) === activeExpected, `summary counts mismatch: ${JSON.stringify(summaryRows)}`);

  const anonymousWrite = await fetch(`${base}/records`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({name: 'Denied write', category: 'Controlled', region: 1, value: 1, active: true})});
  assert(anonymousWrite.status === 403, `anonymous write returned HTTP ${anonymousWrite.status}`);
  const createFunction = project.ir.functions.find(fn => fn.name === 'createRecord');
  const recordType = createFunction?.parameters.find(parameter => parameter.name === 'body')?.typeRef;
  const regionType = project.ir.models.find(model => model.name === 'Region')?.typeRef;
  assert(recordType && regionType, 'Data Explorer model metadata is missing');
  const payload = serializeValue({kind: 'model', type: recordType, fields: {
    name: {kind: 'text', value: 'Controlled write'}, category: {kind: 'text', value: 'Controlled'},
    region: {kind: 'model', type: regionType, fields: {id: {kind: 'integer', value: '3'}}},
    value: {kind: 'integer', value: '123'}, active: {kind: 'boolean', value: true},
  }});
  const controlledWrite = await fetch(`${base}/records`, {method: 'POST', headers: {'content-type': 'application/json', cookie: adminCookie ?? ''}, body: JSON.stringify(payload)});
  assert(controlledWrite.status === 200, `admin write returned HTTP ${controlledWrite.status}: ${await controlledWrite.text()}`);
  const actualCount = Number((await scopedPool.query('SELECT COUNT(*) AS count FROM "ExplorerRecord"')).rows[0].count);
  assert(actualCount === rowCount + 1, `controlled write count mismatch: ${actualCount}`);
  const activeCount = Number((await scopedPool.query('SELECT COUNT(*) AS count FROM "ExplorerRecord" WHERE "active" = true')).rows[0].count);
  assert(activeCount === activeExpected + 1, `active count mismatch after controlled write: ${activeCount}`);

  const evidence = {gate: 'BMEC_DATA_EXPLORER_POSTGRES', recordedAt: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, node: process.version, database: serverVersion, rows: rowCount, seedMs: Number(seedMs.toFixed(1)), startupAndRouteChecksMs: Number((performance.now() - startedAt).toFixed(1)), queryPlans: plans, databaseAggregates: {route: 'GET /records/summary', expectedRows: rowCount, total: summary.total, active: summary.active, countsUseDatabaseAggregates: true}, cursorPagination: {pageSize: 50, firstThreePages: 150, noDuplicates: true, deepPageRows: deepPage.length, filteredRoutes: ['region equality', 'category equality', 'region equality + cursor', 'category equality + cursor'], ordered: true}, accessControl: {anonymousWriteDenied: true, controlledAdminWrite: true}, limitations: ['Local PostgreSQL disposable cluster; no hosted or production database claim', 'Only COUNT aggregates are verified; SUM/AVG, load/concurrent-write guarantees, and snapshot isolation across pages are not demonstrated', 'The dataset was traversed by HTTP cursor pages, not by a million-row browser session']};
  const evidencePath = process.env.BMEC_EXPLORER_POSTGRES_EVIDENCE;
  if (evidencePath) { mkdirSync(dirname(evidencePath), {recursive: true}); writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`); }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await stop(child);
  await scopedPool.end();
  if (schemaCreated) await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await pool.end();
}
