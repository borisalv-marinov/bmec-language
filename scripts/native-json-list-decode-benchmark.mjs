#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../dist/compiler.js';
import { executeValue } from '../dist/core/interpreter.js';
import { lowerNativeC } from '../dist/native/codegen.js';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const samples = Number(process.env.BMEC_JSON_SAMPLES ?? 9);
const warmups = Number(process.env.BMEC_JSON_WARMUPS ?? 2);
const targetMs = Number(process.env.BMEC_JSON_TARGET_MS ?? 75);
const listItems = Number(process.env.BMEC_JSON_LIST_ITEMS ?? 8);
if (!Number.isInteger(listItems) || listItems < 1 || listItems > 4096) throw new Error('BMEC_JSON_LIST_ITEMS must be an integer from 1 through 4096');
const iterationsPerInvocation = Math.max(1, Math.floor(800 / listItems));
const expected = BigInt(listItems) * BigInt(listItems + 1) / 2n;
const payload = JSON.stringify({ version: 1, kind: 'list', elementType: { kind: 'primitive', name: 'integer' }, items: Array.from({ length: listItems }, (_, index) => ({ version: 1, kind: 'integer', value: String(index + 1) })) });
const work = mkdtempSync(join(tmpdir(), 'bmec-json-list-decode-bench-'));
const source = `function decodeIntegers(source text) -> result<list<integer>,text> { return decodeJson(source) }
function matchesExpected(source text, expected integer) -> boolean {
  let decoded = decodeIntegers(source)
  if isOk(decoded) {
    let values = decoded.value
    var total integer = 0
    for value in values { total = total + value }
    return total == expected
  } else { return false }
}
function main() -> boolean {
  repeat ${iterationsPerInvocation} {
    let matched = matchesExpected(${JSON.stringify(payload)}, ${expected})
    if matched == false { return false }
  }
  return true
}`;
const sourcePath = join(work, 'json-list-decode.bmec');
writeFileSync(sourcePath, source, 'utf8');
const compiled = compileFile(sourcePath);
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));
if (!JSON.stringify(compiled.ir).includes(JSON.stringify(payload))) throw new Error('BMEC IR does not contain the benchmark payload byte-for-byte');
const entry = compiled.ir.functions.find(fn => fn.name === 'main');
if (!entry || entry.returnTypeRef.kind !== 'primitive' || entry.returnTypeRef.name !== 'boolean') throw new Error('Unexpected native JSON benchmark entry');
const entryC = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const loweringStart = performance.now();
const generated = lowerNativeC(compiled.ir).replace('#include <string.h>', '#include <string.h>\n#include <time.h>');
const loweringMs = performance.now() - loweringStart;
const prototype = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${entryC}\\(`, 'm').exec(generated);
if (!prototype) throw new Error('Native JSON list decode benchmark function prototype was not found');
const resultType = prototype[1];
const mainStart = generated.lastIndexOf('int main(');
if (mainStart < 0) throw new Error('Generated native main wrapper was not found');
const wrapper = `int main(int argc, char **argv) {
  if (argc != 2) return 2;
  char *end = NULL; int64_t runs = strtoll(argv[1], &end, 10);
  if (!end || *end || runs < 1 || runs > 100000) return 2;
  struct timespec begin, finish; ${resultType} result = false;
  clock_gettime(CLOCK_MONOTONIC, &begin);
  for (int64_t i = 0; i < runs; ++i) { bmec_arena_release(); bmec_steps = 0; bmec_depth = 0; result = ${entryC}(); if (!result) return 1; }
  clock_gettime(CLOCK_MONOTONIC, &finish); bmec_arena_release();
  double elapsed = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0;
  printf("%.9f true\\n", elapsed); return 0;
}
`;
const cSource = join(work, 'json-list-decode.native.c');
writeFileSync(cSource, `${generated.slice(0, mainStart)}${wrapper}`, 'utf8');
const compiler = process.env.BMEC_CC ?? (spawnSync('clang', ['--version'], { encoding: 'utf8' }).status === 0 ? 'clang' : 'gcc');
const nativeExe = join(work, 'json-list-decode-native');
const cppExe = join(work, 'json-list-decode-cpp');
const cppSource = join(work, 'json-decode-list.cpp');
const cppTemplate = readFileSync(join(projectRoot, 'benchmarks', 'native', 'json-decode-list.cpp'), 'utf8');
if (!cppTemplate.includes('"__BMEC_JSON_INPUT__"')) throw new Error('C++ JSON list benchmark input marker was not found');
writeFileSync(cppSource, cppTemplate.replace('"__BMEC_JSON_INPUT__"', JSON.stringify(payload)), 'utf8');
function compile(executable, args) {
  const start = performance.now();
  const result = spawnSync(args[0], [...args.slice(1), '-o', executable], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Compiler failed: ${result.stderr || result.error?.message || result.status}`);
  return Number((performance.now() - start).toFixed(3));
}
const nativeCompileMs = compile(nativeExe, [compiler, '-O3', '-std=c11', cSource, '-lm']);
const cppCompileMs = compile(cppExe, ['g++', '-O3', '-std=c++17', cppSource]);
const invoke = executable => runs => {
  const result = spawnSync(executable, [String(runs)], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.error?.message || result.status}`);
  const elapsed = Number(result.stdout.trim().split(/\s+/)[0]);
  if (!Number.isFinite(elapsed)) throw new Error(`${executable} returned invalid timing: ${result.stdout}`);
  return elapsed;
};
const nativeRun = invoke(nativeExe);
const cppRun = runs => {
  const result = spawnSync(cppExe, [String(runs), String(listItems), String(iterationsPerInvocation), expected.toString()], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${cppExe} failed: ${result.stderr || result.error?.message || result.status}`);
  const elapsed = Number(result.stdout.trim().split(/\s+/)[0]);
  if (!Number.isFinite(elapsed)) throw new Error(`${cppExe} returned invalid timing: ${result.stdout}`);
  return elapsed;
};
const referenceRun = () => executeValue(compiled.ir.functions, 'main', []);
const nodeRun = () => {
  let success = true;
  for (let i = 0; i < iterationsPerInvocation; ++i) {
    const decoded = JSON.parse(payload);
    const values = decoded.items;
    let sum = 0n;
    const contract = decoded.version === 1 && decoded.kind === 'list' && decoded.elementType?.kind === 'primitive' && decoded.elementType?.name === 'integer' && Array.isArray(values) && values.length === listItems;
    if (contract) for (let item = 0; item < values.length; ++item) {
      const value = values[item];
      if (value.version !== 1 || value.kind !== 'integer' || typeof value.value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value.value)) { success = false; break; }
      sum += BigInt(value.value);
    }
    success = success && contract && sum === expected;
  }
  return success;
};
function summarize(values, runs) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  return { samples: values.length, warmups, runsPerSample: runs, iterationsPerInvocation, totalListDecodesPerSample: runs * iterationsPerInvocation, targetSampleMs: targetMs, minMs: sorted[0], medianMs, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], maxMs: sorted.at(-1), coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)), nsPerListDecode: Number((medianMs * 1e6 / (runs * iterationsPerInvocation)).toFixed(2)) };
}
function calibrate(fn, label) {
  let runs = 1;
  let elapsed = fn(runs);
  while (elapsed < targetMs && runs < 65536) { runs *= 2; elapsed = fn(runs); }
  if (elapsed < targetMs) throw new Error(`${label} calibration could not reach ${targetMs} ms`);
  return runs;
}
function measureProcess(fn, runs) {
  for (let i = 0; i < warmups; ++i) fn(runs);
  return summarize(Array.from({ length: samples }, () => fn(runs)), runs);
}
function measureTimedBatch(fn, runs) {
  for (let i = 0; i < warmups; ++i) fn(runs);
  return summarize(Array.from({ length: samples }, () => fn(runs)), runs);
}
function measureJs(fn, runs) {
  for (let i = 0; i < warmups; ++i) for (let j = 0; j < runs; ++j) if (!fn()) throw new Error('JSON decoder checksum failed');
  const values = [];
  for (let i = 0; i < samples; ++i) {
    const start = performance.now();
    for (let j = 0; j < runs; ++j) if (!fn()) throw new Error('JSON decoder checksum failed');
    values.push(performance.now() - start);
  }
  return summarize(values, runs);
}
function measureMemory(executable, name, runs, argsFor = value => [String(value)]) {
  const timed = spawnSync('/usr/bin/time', ['-f', 'BMEC_MAX_RSS_KIB=%M', executable, ...argsFor(runs)], { encoding: 'utf8', windowsHide: true });
  if (timed.error || timed.status !== 0) throw new Error(`${name} memory run failed: ${timed.stderr || timed.error?.message || timed.status}`);
  const peakRssKiB = Number(/BMEC_MAX_RSS_KIB=(\d+)/.exec(timed.stderr)?.[1]);
  if (!Number.isFinite(peakRssKiB)) throw new Error(`${name} peak RSS was not reported`);
  return peakRssKiB;
}
try {
  const referenceBatch = runs => {
    const start = performance.now();
    for (let i = 0; i < runs; ++i) if (referenceRun() !== true) throw new Error('BMEC reference checksum failed');
    return performance.now() - start;
  };
  const referenceRuns = calibrate(referenceBatch, 'BMEC reference');
  const nodeRuns = calibrate(runs => {
    const start = performance.now();
    for (let i = 0; i < runs; ++i) if (!nodeRun()) throw new Error('Node JSON decoder checksum failed');
    return performance.now() - start;
  }, 'Node');
  const nativeRuns = calibrate(nativeRun, 'BMEC native');
  const cppRuns = calibrate(cppRun, 'C++');
  const reference = measureTimedBatch(referenceBatch, referenceRuns);
  const node = measureJs(nodeRun, nodeRuns);
  const native = measureProcess(nativeRun, nativeRuns);
  const cpp = measureProcess(cppRun, cppRuns);
  const memoryKiB = { native: measureMemory(nativeExe, 'BMEC native', nativeRuns), cpp: measureMemory(cppExe, 'C++', cppRuns, runs => [String(runs), String(listItems), String(iterationsPerInvocation), expected.toString()]), reference: 'not isolated', node: 'not isolated' };
  const startup = { native: [], cpp: [] };
  for (let i = 0; i < 7; ++i) {
    let start = performance.now(); nativeRun(1); startup.native.push(performance.now() - start);
    start = performance.now(); cppRun(1); startup.cpp.push(performance.now() - start);
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const wireHash = createHash('sha256').update(payload).digest('hex');
  if (referenceRun() !== true || !nodeRun()) throw new Error('Final decoder checksum confirmation failed');
  nativeRun(1);
  cppRun(1);
  const evidence = {
    version: 1,
    workload: `decode a BMEC tagged list of ${listItems} integers, validate items, and sum them`,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    node: process.version,
    inputBytes: Buffer.byteLength(payload),
    listItems,
    iterationsPerInvocation,
    expectedSum: expected.toString(),
    inputSha256: wireHash,
    implementations: { reference, native, node, cpp },
    compilers: { native: { compiler, version: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c11', '-lm'], compileMs: nativeCompileMs }, cpp: { compiler: 'g++', version: execFileSync('g++', ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c++17'], compileMs: cppCompileMs } },
    buildPipelineMs: { nativeLoweringAndCGeneration: Number(loweringMs.toFixed(3)), nativeCCompilation: nativeCompileMs, cppCompilation: cppCompileMs },
    executableBytes: { native: statSync(nativeExe).size, cpp: statSync(cppExe).size },
    peakRssKiB: memoryKiB,
    processLaunchPlusOneBatchMedianMs: { native: Number(median(startup.native).toFixed(3)), cpp: Number(median(startup.cpp).toFixed(3)) },
    ratios: { nativeOverCpp: Number((native.nsPerListDecode / cpp.nsPerListDecode).toFixed(3)), nativeOverNode: Number((native.nsPerListDecode / node.nsPerListDecode).toFixed(3)), nativeOverReference: Number((native.nsPerListDecode / reference.nsPerListDecode).toFixed(3)) },
  };
  const outputName = process.env.BMEC_JSON_OUTPUT ?? (listItems === 8 ? 'bmec-0.5-json-list-decode-linux.json' : `bmec-0.5-json-list-decode-${listItems}-linux.json`);
  writeFileSync(join(projectRoot, 'docs', 'evidence', outputName), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally { rmSync(work, { recursive: true, force: true }); }
