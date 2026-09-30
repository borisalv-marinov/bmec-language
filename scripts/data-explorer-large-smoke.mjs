import Database from 'better-sqlite3';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compileProject} from '../dist/compiler.js';
import {sqliteAdapter} from '../dist/db/adapter.js';
import {ensureSqliteSchema} from '../dist/db/sqlite.js';
import {startNodeHttpSource} from '../dist/http/node-adapter.js';
import {issueCapability} from '../dist/runtime/capabilities.js';
import {serializeValue} from '../dist/runtime/value-contract.js';
import {AuthService} from '../dist/runtime/auth.js';
import {rolePolicy} from '../dist/http/auth-policy.js';
import {principalFromRequest} from '../dist/runtime/auth-http.js';

const rowCount = Number(process.env.BMEC_EXPLORER_ROWS ?? 250_000);
if (!Number.isInteger(rowCount) || rowCount < 100 || rowCount > 1_000_000) throw new Error('BMEC_EXPLORER_ROWS must be an integer from 100 to 1,000,000');
const project = compileProject(join(process.cwd(), 'examples', 'data-explorer', 'main.pipe'));
if (project.diagnostics.length) throw new Error(`Data Explorer compile failed: ${project.diagnostics.map(diagnostic => diagnostic.code).join(', ')}`);
const temp = mkdtempSync(join(tmpdir(), 'bmec-data-explorer-'));
const client = new Database(join(temp, 'explorer.sqlite'));
client.pragma('journal_mode = WAL');
client.pragma('foreign_keys = ON');
ensureSqliteSchema(client, project.ir.db);
const insertRegion = client.prepare('INSERT INTO "Region" (name) VALUES (?)');
const insertRecord = client.prepare('INSERT INTO "ExplorerRecord" (name, category, region, value, active) VALUES (?, ?, ?, ?, ?)');
const seed = client.transaction(() => {
  for (let region = 1; region <= 4; region++) insertRegion.run(`Region ${region}`);
  for (let index = 0; index < rowCount; index++) {
    const category = `Category ${index % 20}`;
    const region = index % 4 + 1;
    insertRecord.run(`Record ${String(index).padStart(7, '0')}`, category, region, index % 100_000, index % 2 === 0 ? 1 : 0);
  }
});
const seedStarted = performance.now();
seed();
const seedMs = performance.now() - seedStarted;
let invalidRelationRejected = false;
try { insertRecord.run('Invalid region test', 'Invalid', 99, 0, 1); }
catch { invalidRelationRejected = true; }
if (!invalidRelationRejected) throw new Error('SQLite foreign key accepted a record with an unknown region');
client.exec('ANALYZE');
const queryPlans = {
  all: client.prepare('EXPLAIN QUERY PLAN SELECT id, name, category, region, value, active FROM "ExplorerRecord" ORDER BY name ASC LIMIT 50').all(),
  region: client.prepare('EXPLAIN QUERY PLAN SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE region = ? ORDER BY name ASC LIMIT 50').all(3),
  regionCursor: client.prepare('EXPLAIN QUERY PLAN SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE region = ? AND name > ? ORDER BY name ASC LIMIT 50').all(3, 'Record 0012344'),
  category: client.prepare('EXPLAIN QUERY PLAN SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE category = ? ORDER BY name ASC LIMIT 50').all('Category 7'),
  categoryCursor: client.prepare('EXPLAIN QUERY PLAN SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE category = ? AND name > ? ORDER BY name ASC LIMIT 50').all('Category 7', 'Record 0012344'),
  cursor: client.prepare('EXPLAIN QUERY PLAN SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE name > ? ORDER BY name ASC LIMIT 50').all('Record 0000049'),
};
if (!JSON.stringify(queryPlans.all).includes('USING') || JSON.stringify(queryPlans.all).includes('TEMP B-TREE')) throw new Error('Ordered query does not use its declared unique index');
if (!JSON.stringify(queryPlans.region).includes('ExplorerRecord_region_name')) throw new Error('Region query does not use its declared index');
if (!JSON.stringify(queryPlans.regionCursor).includes('ExplorerRecord_region_name') || JSON.stringify(queryPlans.regionCursor).includes('TEMP B-TREE')) throw new Error('Region cursor query does not use its declared composite filter/order index');
if (!JSON.stringify(queryPlans.category).includes('ExplorerRecord_category_name')) throw new Error('Category query does not use its declared index');
if (!JSON.stringify(queryPlans.categoryCursor).includes('ExplorerRecord_category_name') || JSON.stringify(queryPlans.categoryCursor).includes('TEMP B-TREE')) throw new Error('Category cursor query does not use its declared composite filter/order index');
if (!JSON.stringify(queryPlans.cursor).includes('SEARCH ExplorerRecord USING') || JSON.stringify(queryPlans.cursor).includes('TEMP B-TREE')) throw new Error('Cursor query does not use its declared unique index for filtering and ordering');
const queryStatements = {
  all: client.prepare('SELECT id, name, category, region, value, active FROM "ExplorerRecord" ORDER BY name ASC LIMIT 50'),
  region: client.prepare('SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE region = ? ORDER BY name ASC LIMIT 50'),
  regionCursor: client.prepare('SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE region = ? AND name > ? ORDER BY name ASC LIMIT 50'),
  category: client.prepare('SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE category = ? ORDER BY name ASC LIMIT 50'),
  categoryCursor: client.prepare('SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE category = ? AND name > ? ORDER BY name ASC LIMIT 50'),
  cursor: client.prepare('SELECT id, name, category, region, value, active FROM "ExplorerRecord" WHERE name > ? ORDER BY name ASC LIMIT 50'),
};
const dbQuerySamples = new Map([['all', []], ['region', []], ['regionCursor', []], ['category', []], ['categoryCursor', []], ['cursor', []]]);
for (let iteration = 0; iteration < 25; iteration++) for (const [kind, statement] of Object.entries(queryStatements)) {
  const started = performance.now();
  const rows = kind === 'region' ? statement.all(3) : kind === 'regionCursor' ? statement.all(3, 'Record 0012344') : kind === 'category' ? statement.all('Category 7') : kind === 'categoryCursor' ? statement.all('Category 7', 'Record 0012344') : kind === 'cursor' ? statement.all('Record 0012344') : statement.all();
  if (rows.length !== 50) throw new Error(`${kind} direct query returned ${rows.length} rows`);
  dbQuerySamples.get(kind).push(performance.now() - started);
}
const startedServer = performance.now();
const auth = new AuthService();
await auth.register('admin', 'admin password', {role: 'admin'});
const adminSession = await auth.login('admin', 'admin password');
if (!adminSession) throw new Error('Data Explorer admin session could not be created');
const handle = await startNodeHttpSource(project.ir, {capabilityTokens: new Map([['database', issueCapability('database')]]), database: {adapter: sqliteAdapter(client, project.ir.db), schema: project.ir.db}, configureRouter: router => {
  router.setPrincipalResolver(request => principalFromRequest(request, auth));
  router.registerPolicy('role:admin', rolePolicy(auth, 'admin'));
}});
const startupMs = performance.now() - startedServer;
const samples = new Map([['all', []], ['region', []], ['regionCursor', []], ['category', []], ['categoryCursor', []], ['cursor', []]]);
const urls = {all: '/records', region: '/records/region/3', regionCursor: `/records/region/3/pages/${encodeURIComponent('Record 0012344')}`, category: '/records/category/Category%207', categoryCursor: `/records/category/Category%207/pages/${encodeURIComponent('Record 0012344')}`, cursor: `/records/page/${encodeURIComponent('Record 0012344')}`};
try {
  for (let warmup = 0; warmup < 5; warmup++) for (const path of Object.values(urls)) await fetch(`${handle.url}${path}`);
  for (let iteration = 0; iteration < 25; iteration++) for (const [kind, path] of Object.entries(urls)) {
    const started = performance.now();
    const response = await fetch(`${handle.url}${path}`);
    if (response.status !== 200) throw new Error(`${kind} read returned ${response.status}`);
    const rows = await response.json();
    if (rows.length !== 50) throw new Error(`${kind} read returned ${rows.length} rows; expected bounded page size 50`);
    if (kind.startsWith('region') && rows.some(row => (row.region?.id ?? row.region) !== 3)) throw new Error('Region filter returned an unrelated record');
    if (kind.startsWith('category') && rows.some(row => row.category !== 'Category 7')) throw new Error('Category filter returned an unrelated record');
    if (kind.toLowerCase().includes('cursor') && rows.some(row => row.name <= 'Record 0012344')) throw new Error('Cursor query returned a row at or before the cursor');
    if (rows.some((row, index) => index > 0 && rows[index - 1].name > row.name)) throw new Error(`${kind} read was not ordered by name`);
    samples.get(kind).push(performance.now() - started);
  }
  const readCursorPage = async path => {
    const response = await fetch(`${handle.url}${path}`);
    if (response.status !== 200) throw new Error(`Cursor page ${path} returned ${response.status}`);
    const rows = await response.json();
    if (rows.length > 50 || rows.some((row, index) => index > 0 && rows[index - 1].name >= row.name)) throw new Error(`Cursor page ${path} exceeded its bound or was not strictly ordered`);
    return rows;
  };
  const cursorPages = [];
  let nextPath = '/records/page';
  for (let page = 0; page < 3; page++) {
    const rows = await readCursorPage(nextPath);
    if (rows.length !== 50) throw new Error(`Cursor page ${page + 1} returned ${rows.length} rows instead of 50`);
    const expectedFirst = page * 50;
    const expectedLast = expectedFirst + 49;
    if (rows[0].name !== `Record ${String(expectedFirst).padStart(7, '0')}` || rows.at(-1).name !== `Record ${String(expectedLast).padStart(7, '0')}`) throw new Error(`Cursor page ${page + 1} did not preserve its exact boundary`);
    cursorPages.push({page: page + 1, first: rows[0].name, last: rows.at(-1).name, rows: rows.length});
    nextPath = `/records/page/${encodeURIComponent(rows.at(-1).name)}`;
  }
  const deepCursor = `Record ${String(rowCount - 51).padStart(7, '0')}`;
  const deepRows = await readCursorPage(`/records/page/${encodeURIComponent(deepCursor)}`);
  if (deepRows.length !== 50 || deepRows[0].name !== `Record ${String(rowCount - 50).padStart(7, '0')}` || deepRows.at(-1).name !== `Record ${String(rowCount - 1).padStart(7, '0')}`) throw new Error('Deep cursor page returned an incorrect range');
  cursorPages.push({page: 'deep', first: deepRows[0].name, last: deepRows.at(-1).name, rows: deepRows.length});
  const filteredCursorPages = [];
  for (const [name, firstPath, nextPath, matches] of [
    ['region=3', '/records/region/3', '/records/region/3/pages/', row => (row.region?.id ?? row.region) === 3],
    ['category=Category 7', '/records/category/Category%207', '/records/category/Category%207/pages/', row => row.category === 'Category 7'],
  ]) {
    const first = await readCursorPage(firstPath);
    if (first.length !== 50 || first.some(row => !matches(row))) throw new Error(`${name} first filtered page is not a bounded matching page`);
    const second = await readCursorPage(`${nextPath}${encodeURIComponent(first.at(-1).name)}`);
    if (second.length !== 50 || second.some(row => !matches(row) || row.name <= first.at(-1).name)) throw new Error(`${name} filtered continuation is not bounded, ordered, or scoped`);
    filteredCursorPages.push({filter: name, firstPageRows: first.length, nextPageRows: second.length, firstCursor: first.at(-1).name, nextFirst: second[0].name, noDuplicates: new Set([...first, ...second].map(row => row.name)).size === 100});
  }
  const endRows = await readCursorPage(`/records/page/${encodeURIComponent(`Record ${String(rowCount - 1).padStart(7, '0')}`)}`);
  if (endRows.length !== 0) throw new Error('Cursor after the final row was not empty');
  const beforeConcurrentRss = process.memoryUsage().rss;
  const concurrentStarted = performance.now();
  const concurrent = await Promise.all(Array.from({length: 128}, (_, index) => fetch(`${handle.url}${Object.values(urls)[index % Object.keys(urls).length]}`)));
  const concurrentLatency = performance.now() - concurrentStarted;
  if (concurrent.some(response => response.status !== 200)) throw new Error(`Concurrent reads had ${concurrent.filter(response => response.status !== 200).length} non-200 responses`);
  for (const response of concurrent) if ((await response.json()).length !== 50) throw new Error('Concurrent query exceeded its 50-row bound');
  const afterConcurrentRss = process.memoryUsage().rss;
  const count = client.prepare('SELECT COUNT(*) AS count FROM "ExplorerRecord"').get().count;
  if (count !== rowCount) throw new Error(`Expected ${rowCount} records, found ${count}`);
  const summaryResponse = await fetch(`${handle.url}/records/summary`);
  if (summaryResponse.status !== 200) throw new Error(`Database aggregate route returned ${summaryResponse.status}`);
  const aggregateCounts = await summaryResponse.json();
  const aggregateSummary = Array.isArray(aggregateCounts) && aggregateCounts.length === 1 ? aggregateCounts[0] : undefined;
  const expectedActive = Math.ceil(rowCount / 2);
  if (aggregateSummary?.total !== rowCount || aggregateSummary?.active !== expectedActive) throw new Error(`Database aggregates mismatch: ${JSON.stringify(aggregateCounts)}; expected ${rowCount}/${expectedActive}`);
  const insert = project.ir.functions.find(fn => fn.name === 'createRecord');
  const recordType = insert?.parameters.find(parameter => parameter.name === 'body')?.typeRef;
  const regionType = project.ir.models.find(model => model.name === 'Region')?.typeRef;
  if (!recordType || !regionType) throw new Error('Typed data model metadata is missing');
  const payload = serializeValue({kind: 'model', type: recordType, fields: {
    name: {kind: 'text', value: 'Controlled write'}, category: {kind: 'text', value: 'Controlled'},
    region: {kind: 'model', type: regionType, fields: {id: {kind: 'integer', value: '3'}}},
    value: {kind: 'integer', value: '123'}, active: {kind: 'boolean', value: true},
  }});
  const anonymousWrite = await fetch(`${handle.url}/records`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)});
  if (anonymousWrite.status !== 403) throw new Error(`Anonymous Data Explorer write returned ${anonymousWrite.status}`);
  if (client.prepare('SELECT COUNT(*) AS count FROM "ExplorerRecord"').get().count !== rowCount) throw new Error('Anonymous Data Explorer write changed the row count');
  const write = await fetch(`${handle.url}/records`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${adminSession.id}`}, body: JSON.stringify(payload)});
  if (write.status !== 200) throw new Error(`Controlled write returned ${write.status}`);
  const finalCount = client.prepare('SELECT COUNT(*) AS count FROM "ExplorerRecord"').get().count;
  if (finalCount !== rowCount + 1) throw new Error(`Controlled write changed row count to ${finalCount}`);
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1].toFixed(2);
  const summary = Object.fromEntries([...samples].map(([kind, values]) => [kind, {p50Ms: percentile(values, .5), p95Ms: percentile(values, .95)}]));
  const directSummary = Object.fromEntries([...dbQuerySamples].map(([kind, values]) => [kind, {p50Ms: percentile(values, .5), p95Ms: percentile(values, .95)}]));
  const evidence = {gate: 'BMEC_DATA_EXPLORER_LARGE', recordedAt: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, node: process.version, database: 'SQLite / better-sqlite3', sqlite: client.prepare('SELECT sqlite_version() AS version').get().version, rows: rowCount, seedMs: Number(seedMs.toFixed(1)), serverStartupMs: Number(startupMs.toFixed(1)), queryEngine: directSummary, applicationLatency: summary, queryPlans, databaseAggregates: {route: 'GET /records/summary', expectedRows: rowCount, total: aggregateSummary.total, active: aggregateSummary.active, countsUseDatabaseAggregates: true}, cursorPagination: {route: 'GET /records/page/:after', orderField: 'ExplorerRecord.name (unique)', pages: cursorPages, filteredPages: filteredCursorPages, fullPageSize: 50, finalPageRows: endRows.length, deepPageRowsReturned: deepRows.length}, concurrentReads: {requests: 128, elapsedMs: Number(concurrentLatency.toFixed(1)), transport: 'one in-process SQLite connection; no network connection pool'}, concurrentRssMiB: {before: Number((beforeConcurrentRss / 1048576).toFixed(1)), after: Number((afterConcurrentRss / 1048576).toFixed(1))}, boundedReadRows: 50, foreignKeyConstraint: 'PASS', anonymousWriteDenied: 'PASS', controlledWrite: 'PASS (admin authenticated)', limitations: ['This is the SQLite workload gate; PostgreSQL has a separate data-explorer-postgres-smoke.mjs gate', 'Keyset pagination is supported for unique text fields and combines with a single region/category equality filter; arbitrary offset pagination, composite cursors, and snapshot guarantees are not demonstrated', 'Aggregation covers database-side COUNT only; SUM/AVG, batch-write, and streaming behavior are not demonstrated', 'The reported RSS delta is process-level before/after, not a peak-memory profiler', 'Generated list cursor navigation is verified in Chromium on 120 SQLite rows; this database-scale run measures backend paging, not million-row browser traversal']};
  const evidencePath = process.env.BMEC_EXPLORER_EVIDENCE;
  if (evidencePath) {
    mkdirSync(join(evidencePath, '..'), {recursive: true});
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await handle.close();
  client.close();
  rmSync(temp, {recursive: true, force: true});
}
