#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compile } from '../dist/compiler.js';
import { executeValue } from '../dist/core/interpreter.js';
import { lowerNativeC } from '../dist/native/codegen.js';

if (process.platform !== 'linux') throw new Error('This benchmark currently requires Linux x64');
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourceIdentity = 'benchmarks/native/json-record-encode.bmec';
const sourceTemplate = readFileSync(join(root, sourceIdentity), 'utf8');
const samples = Number(process.env.BMEC_JSON_SAMPLES ?? 9);
const warmups = Number(process.env.BMEC_JSON_WARMUPS ?? 2);
const targetMs = Number(process.env.BMEC_JSON_TARGET_MS ?? 75);
if (!Number.isInteger(samples) || samples < 3 || !Number.isInteger(warmups) || warmups < 0 || !Number.isFinite(targetMs) || targetMs <= 0)
  throw new Error('Invalid benchmark sample settings');

const seed = compile(sourceTemplate.replace('__BMEC_EXPECTED__', '""'), sourceIdentity);
if (seed.diagnostics.length) throw new Error(seed.diagnostics.map(item => item.message).join('\n'));
const expected = String(executeValue(seed.ir.functions, 'expectedWire', []));
const compiled = compile(sourceTemplate.replace('__BMEC_EXPECTED__', JSON.stringify(expected)), sourceIdentity);
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));
const symbol = compiled.ir.functions.find(fn => fn.name === 'buildSample')?.returnTypeRef?.symbol;
if (!symbol) throw new Error('Benchmark record TypeRef was not resolved');
const expectedHash = createHash('sha256').update(expected).digest('hex');
const wordsSource = 'alpha|π|東京|q"uote\\|line\nfeed';
const nativeSemanticWire = () => JSON.stringify({
  version: 1,
  kind: 'record',
  type: { kind: 'record', name: 'Sample', symbol },
  fields: {
    count: { version: 1, kind: 'integer', value: '42' },
    ratio: { version: 1, kind: 'number', value: 1.25 },
    enabled: { version: 1, kind: 'boolean', value: true },
    label: { version: 1, kind: 'text', value: 'entrée "π"' },
    words: { version: 1, kind: 'list', elementType: { kind: 'primitive', name: 'text' }, items: wordsSource.split('|').map(value => ({ version: 1, kind: 'text', value })) },
  },
});
if (nativeSemanticWire() !== expected) throw new Error('Node/reference wire mismatch before timing');

const entry = compiled.ir.functions.find(fn => fn.name === 'main');
if (!entry || entry.returnTypeRef.kind !== 'primitive' || entry.returnTypeRef.name !== 'boolean') throw new Error('Unexpected benchmark entry');
const entryC = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const work = mkdtempSync(join(tmpdir(), 'bmec-json-record-encode-bench-'));
try {
  const loweringStart = performance.now();
  const generated = lowerNativeC(compiled.ir).replace('#include <string.h>', '#include <string.h>\n#include <time.h>');
  const loweringMs = performance.now() - loweringStart;
  const match = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${entryC}\\(`, 'm').exec(generated);
  if (!match) throw new Error('Generated entry function prototype was not found');
  const mainStart = generated.lastIndexOf('int main(');
  if (mainStart < 0) throw new Error('Generated native main wrapper was not found');
  const wrapper = `int main(int argc, char **argv) {
  if (argc != 2) return 2; char *end = NULL; int64_t runs = strtoll(argv[1], &end, 10);
  if (!end || *end || runs < 1 || runs > 1000000) return 2;
  struct timespec begin, finish; bool result = false; clock_gettime(CLOCK_MONOTONIC, &begin);
  for (int64_t i = 0; i < runs; ++i) { bmec_arena_release(); bmec_steps = 0; bmec_depth = 0; result = ${entryC}(); if (!result) return 1; }
  clock_gettime(CLOCK_MONOTONIC, &finish); bmec_arena_release();
  double elapsed = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0;
  printf("%.9f true\\n", elapsed); return 0;
}
`;
  const nativeSource = join(work, 'json-record-encode.native.c');
  writeFileSync(nativeSource, `${generated.slice(0, mainStart)}${wrapper}`, 'utf8');
  const compiler = process.env.BMEC_CC ?? (spawnSync('clang', ['--version'], { encoding: 'utf8' }).status === 0 ? 'clang' : 'gcc');
  const nativeExe = join(work, 'json-record-encode-native');
  const cppExe = join(work, 'json-record-encode-cpp');
  function compileExecutable(executable, args) {
    const start = performance.now();
    const result = spawnSync(args[0], [...args.slice(1), '-o', executable], { encoding: 'utf8', windowsHide: true, cwd: work });
    if (result.error || result.status !== 0) throw new Error(`Compiler failed: ${result.stderr || result.error?.message || result.status}`);
    return Number((performance.now() - start).toFixed(3));
  }
  const nativeCompileMs = compileExecutable(nativeExe, [compiler, '-O3', '-std=c11', nativeSource, '-lm']);
  const cppSource = join(root, 'benchmarks', 'native', 'json-record-encode.cpp');
  const cppCompileMs = compileExecutable(cppExe, ['g++', '-O3', '-std=c++17', cppSource]);
  const invoke = (executable, extraArgs = []) => runs => {
    const result = spawnSync(executable, [String(runs), ...extraArgs], { encoding: 'utf8', windowsHide: true, cwd: work });
    if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.error?.message || result.status}`);
    const elapsed = Number(result.stdout.trim().split(/\s+/)[0]);
    if (!Number.isFinite(elapsed)) throw new Error(`${executable} returned invalid timing: ${result.stdout}`);
    return elapsed;
  };
  const nativeRun = invoke(nativeExe);
  const cppRun = invoke(cppExe, [expected]);
  const referenceRun = runs => { let result = false; for (let i = 0; i < runs; i++) result = executeValue(compiled.ir.functions, 'main', []); return result; };
  const nodeRun = runs => { for (let i = 0; i < runs; i++) if (nativeSemanticWire() !== expected) return false; return true; };
  function summarize(values, runs) {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const medianMs = sorted[Math.floor(sorted.length / 2)];
    return { samples: values.length, warmups, runsPerSample: runs, transformsPerSample: runs, targetSampleMs: targetMs, minMs: sorted[0], medianMs, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], maxMs: sorted.at(-1), coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)), nsPerRecordEncode: Number((medianMs * 1e6 / runs).toFixed(2)) };
  }
  function calibrate(fn, label) {
    let runs = 1, elapsed = fn(runs);
    while (elapsed < targetMs && runs < 1000000) { runs = Math.min(1000000, runs * 2); elapsed = fn(runs); }
    if (elapsed < targetMs) throw new Error(`${label} calibration could not reach ${targetMs} ms`);
    return runs;
  }
  const measureInProcess = (fn, runs) => {
    for (let i = 0; i < warmups; i++) if (fn(runs) !== true) throw new Error('Warmup output mismatch');
    const values = [];
    for (let i = 0; i < samples; i++) { const start = performance.now(); if (fn(runs) !== true) throw new Error('Sample output mismatch'); values.push(performance.now() - start); }
    return summarize(values, runs);
  };
  const measureNativeProcess = (fn, runs) => {
    for (let i = 0; i < warmups; i++) fn(runs);
    return summarize(Array.from({ length: samples }, () => fn(runs)), runs);
  };
  const refRuns = calibrate(runs => { const start = performance.now(); const ok = referenceRun(runs); const elapsed = performance.now() - start; if (!ok) throw new Error('Reference result mismatch'); return elapsed; }, 'reference');
  const nodeRuns = calibrate(runs => { const start = performance.now(); const ok = nodeRun(runs); const elapsed = performance.now() - start; if (!ok) throw new Error('Node result mismatch'); return elapsed; }, 'Node');
  const nativeRuns = calibrate(nativeRun, 'native');
  const cppRuns = calibrate(cppRun, 'C++');
  const reference = measureInProcess(referenceRun, refRuns);
  const node = measureInProcess(nodeRun, nodeRuns);
  const native = measureNativeProcess(nativeRun, nativeRuns);
  const cpp = measureNativeProcess(cppRun, cppRuns);
  if (String(executeValue(compiled.ir.functions, 'main', [])) !== 'true' || nodeRun(1) !== true || nativeRun(1) < 0 || cppRun(1) < 0)
    throw new Error('Final checksum validation failed');
  const memory = executable => {
    const timed = spawnSync('/usr/bin/time', ['-f', 'BMEC_MAX_RSS_KIB=%M', executable, '1', ...(executable === cppExe ? [expected] : [])], { encoding: 'utf8', windowsHide: true });
    if (timed.error || timed.status !== 0) throw new Error(`Memory run failed: ${timed.stderr || timed.error?.message || timed.status}`);
    return Number(/BMEC_MAX_RSS_KIB=(\d+)/.exec(timed.stderr)?.[1]);
  };
  const memoryKiB = { native: memory(nativeExe), cpp: memory(cppExe), reference: 'not isolated', node: 'not isolated' };
  const output = {
    version: 1,
    benchmark: 'typed JSON encoding for a plain record with scalar and UTF-8 text-list fields',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    nodeVersion: process.version,
    outputBytes: Buffer.byteLength(expected),
    outputSha256: expectedHash,
    symbol,
    implementations: { reference, native: { ...native, compileMs: nativeCompileMs, executableBytes: statSync(nativeExe).size }, node, cpp: { ...cpp, compileMs: cppCompileMs, executableBytes: statSync(cppExe).size } },
    ratiosToCpp: { reference: Number((reference.nsPerRecordEncode / cpp.nsPerRecordEncode).toFixed(3)), native: Number((native.nsPerRecordEncode / cpp.nsPerRecordEncode).toFixed(3)), node: Number((node.nsPerRecordEncode / cpp.nsPerRecordEncode).toFixed(3)) },
    peakRssKiB: memoryKiB,
    compilers: { native: { name: compiler, version: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c11', '-lm'] }, cpp: { name: 'g++', version: execFileSync('g++', ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c++17'] } },
    nativeLoweringMs: Number(loweringMs.toFixed(3)),
  };
  const destination = resolve(process.env.BMEC_JSON_RECORD_ENCODE_OUTPUT ?? join(root, 'docs', 'evidence', 'bmec-0.5-json-record-encode-linux.json'));
  writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
