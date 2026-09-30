#!/usr/bin/env node
import {readFileSync} from 'node:fs';

const [resultPath, requestedBaseline] = process.argv.slice(2);
if (!resultPath) {
  console.error('usage: node scripts/performance-gate.mjs <result.json> [baseline.json]');
  process.exit(2);
}

const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const baselinePath = requestedBaseline ?? (String(result.platform ?? '').toLowerCase().includes('linux') ? 'docs/performance-baseline-linux.json' : 'docs/performance-baseline.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const failures = [];
const check = (label, actual, expected, multiplier, statistic = 'p95Ms') => {
  if (!actual || typeof actual[statistic] !== 'number' || typeof expected?.[statistic] !== 'number') {
    failures.push(`${label}: missing ${statistic} measurement`);
    return;
  }
  if (actual[statistic] > expected[statistic] * multiplier) {
    failures.push(`${label}: ${statistic} ${actual[statistic]}ms exceeds ${multiplier}x baseline ${expected[statistic]}ms`);
  }
};

check('compiler warm check', result.compilerWarmCheck, baseline.compilerWarmCheck, 2.0);
check('parser', result.parser, baseline.parser, 10.0);
check('semantic analysis', result.semanticAnalysis, baseline.semanticAnalysis, 5.0);
check('interpreter', result.interpreter, baseline.interpreter, 5.0);
check('release build', result.releaseBuild, baseline.releaseBuild, 2.0);
// Loopback HTTP p95 varies across hosted runner scheduling; keep the bound looser than local baselines.
check('HTTP', result.http, baseline.http, 5.0);
// The in-memory SQLite workload is short enough that a single hosted-runner
// scheduler pause can dominate its p95. Keep recording p95, but gate its median
// against a separately recorded median baseline so repeatable slowdowns still fail.
check('SQLite CRUD', result.sqliteCrud, baseline.sqliteCrud, 3.0, 'p50Ms');
if (result.browserBundleBytes?.appJs > baseline.browserBundleBytes.appJs * 1.25) {
  failures.push(`browser app.js: ${result.browserBundleBytes.appJs} bytes exceeds 125% baseline ${baseline.browserBundleBytes.appJs} bytes`);
}
if (!result.postgresCrud || result.postgresCrud.skipped) {
  failures.push('PostgreSQL CRUD: required for the full performance gate');
} else {
  check('PostgreSQL CRUD', result.postgresCrud, baseline.postgresCrud, 2.0);
}

if (failures.length) {
  console.error(['BMEC performance gate: FAIL', ...failures.map(failure => `- ${failure}`)].join('\n'));
  process.exit(1);
}
console.log(`BMEC performance gate: PASS (baseline ${baseline.commit}, result ${result.commit})`);
