#!/usr/bin/env node
import {readFileSync} from 'node:fs';

const [resultPath, requestedBaseline] = process.argv.slice(2);
if (!resultPath) {
  console.error('usage: node scripts/performance-gate.mjs <result.json> [baseline.json]');
  process.exit(2);
}

const failures = [];
function readObject(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      failures.push(`${label}: expected a JSON object`);
      return {};
    }
    return value;
  } catch (error) {
    failures.push(`${label}: unable to read valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return {};
  }
}

const result = readObject(resultPath, 'result');
const baselinePath = requestedBaseline ?? (String(result.platform ?? '').toLowerCase().includes('linux') ? 'docs/performance-baseline-linux.json' : 'docs/performance-baseline.json');
const baseline = readObject(baselinePath, 'baseline');

const check = (label, actual, expected, multiplier, statistic = 'p95Ms') => {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    failures.push(`${label}: missing or invalid measurement object`);
    return;
  }
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    failures.push(`${label}: missing or invalid baseline measurement object`);
    return;
  }

  // Validate every reported timing, including percentile fields that are not
  // currently used for the regression comparison.
  for (const [source, measurement, name] of [[label, actual, 'result'], [`${label} baseline`, expected, 'baseline']]) {
    const timingFields = Object.keys(measurement).filter(key => key.endsWith('Ms'));
    for (const field of timingFields) {
      const value = measurement[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        failures.push(`${source}: ${field} must be a finite non-negative number (${name})`);
      }
    }
  }

  const actualValue = actual[statistic];
  const expectedValue = expected[statistic];
  if (typeof actualValue !== 'number' || !Number.isFinite(actualValue) || actualValue < 0) {
    failures.push(`${label}: missing or invalid ${statistic} measurement`);
    return;
  }
  if (typeof expectedValue !== 'number' || !Number.isFinite(expectedValue) || expectedValue <= 0) {
    failures.push(`${label}: missing or invalid baseline ${statistic} measurement`);
    return;
  }
  if (actualValue > expectedValue * multiplier) {
    failures.push(`${label}: ${statistic} ${actualValue}ms exceeds ${multiplier}x baseline ${expectedValue}ms`);
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

const bundle = result.browserBundleBytes;
const baselineBundle = baseline.browserBundleBytes;
if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
  failures.push('browser bundle: missing or invalid bundle size object');
} else {
  for (const [name, value] of Object.entries(bundle)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      failures.push(`browser bundle: ${name} must be a positive finite integer byte size`);
    }
  }
  if (!Object.hasOwn(bundle, 'appJs')) failures.push('browser bundle: missing appJs byte size');
}
if (!baselineBundle || typeof baselineBundle !== 'object' || Array.isArray(baselineBundle)) {
  failures.push('browser bundle baseline: missing or invalid bundle size object');
} else {
  for (const [name, value] of Object.entries(baselineBundle)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      failures.push(`browser bundle baseline: ${name} must be a positive finite integer byte size`);
    }
  }
  if (!Object.hasOwn(baselineBundle, 'appJs')) failures.push('browser bundle baseline: missing appJs byte size');
}
if (Number.isFinite(bundle?.appJs) && bundle.appJs > 0 && Number.isFinite(baselineBundle?.appJs) && baselineBundle.appJs > 0 && bundle.appJs > baselineBundle.appJs * 1.25) {
  failures.push(`browser app.js: ${bundle.appJs} bytes exceeds 125% baseline ${baselineBundle.appJs} bytes`);
}

if (!result.postgresCrud || typeof result.postgresCrud !== 'object' || Array.isArray(result.postgresCrud) || result.postgresCrud.skipped) {
  failures.push('PostgreSQL CRUD: required for the full performance gate');
} else {
  check('PostgreSQL CRUD', result.postgresCrud, baseline.postgresCrud, 2.0);
}

if (failures.length) {
  console.error(['BMEC performance gate: FAIL', ...failures.map(failure => `- ${failure}`)].join('\n'));
  process.exit(1);
}
console.log(`BMEC performance gate: PASS (baseline ${baseline.commit}, result ${result.commit})`);
