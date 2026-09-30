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

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const samples = Number(process.env.BMEC_JSON_SAMPLES ?? 9);
const warmups = Number(process.env.BMEC_JSON_WARMUPS ?? 2);
const targetMs = Number(process.env.BMEC_JSON_TARGET_MS ?? 75);
const iterationsPerInvocation = 100;
const examplePath = join(root, 'examples', 'json-record-list-decode-bench', 'main.bmec');
const sourceIdentity = 'examples/json-record-list-decode-bench/main.bmec';
const sourceTemplate = readFileSync(examplePath, 'utf8');
const seed = compile(sourceTemplate.replaceAll('__BMEC_RECORD_PAYLOAD__', '""'), sourceIdentity);
if (seed.diagnostics.length) throw new Error(seed.diagnostics.map(item => item.message).join('\n'));
const payload = String(executeValue(seed.ir.functions, 'sampleWire', []));
const expectedChecksum = 53n;
const benchmarkSource = sourceTemplate.replace(/^function sampleWire.*\r?\n/m, '');
const compiled = compile(benchmarkSource.replaceAll('__BMEC_RECORD_PAYLOAD__', JSON.stringify(payload)), sourceIdentity);
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));
if (!JSON.stringify(compiled.ir).includes(JSON.stringify(payload))) throw new Error('BMEC IR does not contain the benchmark payload byte-for-byte');
const entry = compiled.ir.functions.find(fn => fn.name === 'main');
if (!entry || entry.returnTypeRef.kind !== 'primitive' || entry.returnTypeRef.name !== 'boolean') throw new Error('Unexpected native JSON record-list benchmark entry');
const entryC = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const work = mkdtempSync(join(tmpdir(), 'bmec-json-record-list-bench-'));
try {
  const loweringStart = performance.now();
  const generated = lowerNativeC(compiled.ir).replace('#include <string.h>', '#include <string.h>\n#include <time.h>');
  const loweringMs = performance.now() - loweringStart;
  const prototype = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${entryC}\\(`, 'm').exec(generated);
  if (!prototype) throw new Error('Generated native entry function was not found');
  const mainStart = generated.lastIndexOf('int main(');
  if (mainStart < 0) throw new Error('Generated native main wrapper was not found');
  const wrapper = `int main(int argc, char **argv) {\n  if (argc != 2) return 2;\n  char *end = NULL; int64_t runs = strtoll(argv[1], &end, 10);\n  if (!end || *end || runs < 1 || runs > 100000) return 2;\n  struct timespec begin, finish; ${prototype[1]} result = false;\n  clock_gettime(CLOCK_MONOTONIC, &begin);\n  for (int64_t i = 0; i < runs; ++i) { bmec_arena_release(); bmec_steps = 0; bmec_depth = 0; result = ${entryC}(); if (!result) return 1; }\n  clock_gettime(CLOCK_MONOTONIC, &finish); bmec_arena_release();\n  double elapsed = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0;\n  printf("%.9f true\\n", elapsed); return 0;\n}\n`;
  const cSource = join(work, 'json-record-list.native.c');
  writeFileSync(cSource, `${generated.slice(0, mainStart)}${wrapper}`, 'utf8');
  const cppTemplate = readFileSync(join(root, 'benchmarks', 'native', 'json-decode-record-list.cpp'), 'utf8');
  const cppSource = join(work, 'json-record-list.cpp');
  const inputFile = join(work, 'record-list-input.json');
  writeFileSync(cppSource, cppTemplate, 'utf8');
  writeFileSync(inputFile, payload, 'utf8');
  const compiler = process.env.BMEC_CC ?? (spawnSync('clang', ['--version'], { encoding: 'utf8' }).status === 0 ? 'clang' : 'gcc');
  const nativeExe = join(work, 'json-record-list-native');
  const cppExe = join(work, 'json-record-list-cpp');
  function compileExecutable(executable, args) {
    const start = performance.now();
    const result = spawnSync(args[0], [...args.slice(1), '-o', executable], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`Compiler failed: ${result.stderr || result.error?.message || result.status}`);
    return Number((performance.now() - start).toFixed(3));
  }
  const nativeCompileMs = compileExecutable(nativeExe, [compiler, '-O3', '-std=c11', cSource, '-lm']);
  const cppCompileMs = compileExecutable(cppExe, ['g++', '-O3', '-std=c++17', cppSource]);
  const invoke = (executable, extraArgs = []) => runs => {
    const result = spawnSync(executable, [String(runs), ...extraArgs], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.error?.message || result.status}`);
    const elapsed = Number(result.stdout.trim().split(/\s+/)[0]);
    if (!Number.isFinite(elapsed)) throw new Error(`${executable} returned invalid timing: ${result.stdout}`);
    return elapsed;
  };
  const nativeRun = invoke(nativeExe);
  const cppRun = invoke(cppExe, [inputFile]);
  const referenceRun = () => executeValue(compiled.ir.functions, 'main', []);
  const nodeRun = () => {
    let success = true;
    for (let i = 0; i < iterationsPerInvocation; ++i) {
      const decoded = JSON.parse(payload);
      if (decoded.version !== 1 || decoded.kind !== 'record' || decoded.type?.kind !== 'record' || decoded.type?.name !== 'Sample' || !decoded.type?.symbol || (decoded.type?.typeArguments !== undefined && (!Array.isArray(decoded.type.typeArguments) || decoded.type.typeArguments.length !== 0))) return false;
      const fields = decoded.fields;
      if (!fields || Object.keys(fields).length !== 2 || fields.count?.version !== 1 || fields.count?.kind !== 'integer' || typeof fields.count?.value !== 'string' || fields.values?.version !== 1 || fields.values?.kind !== 'list' || fields.values?.elementType?.kind !== 'primitive' || fields.values?.elementType?.name !== 'integer' || !Array.isArray(fields.values?.items) || fields.values.items.length !== 8) return false;
      let sum = BigInt(fields.count.value);
      for (const item of fields.values.items) {
        if (item.version !== 1 || item.kind !== 'integer' || typeof item.value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(item.value)) { success = false; break; }
        sum += BigInt(item.value);
      }
      success = success && sum === expectedChecksum;
    }
    return success;
  };
  function summarize(values, runs) {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const medianMs = sorted[Math.floor(sorted.length / 2)];
    return { samples: values.length, warmups, runsPerSample: runs, iterationsPerInvocation, totalRecordDecodesPerSample: runs * iterationsPerInvocation, targetSampleMs: targetMs, minMs: sorted[0], medianMs, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], maxMs: sorted.at(-1), coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)), nsPerRecordDecode: Number((medianMs * 1e6 / (runs * iterationsPerInvocation)).toFixed(2)) };
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
  function measureJs(fn, runs) {
    for (let i = 0; i < warmups; ++i) for (let j = 0; j < runs; ++j) if (!fn()) throw new Error('JSON record decoder checksum failed');
    const values = [];
    for (let i = 0; i < samples; ++i) {
      const start = performance.now();
      for (let j = 0; j < runs; ++j) if (!fn()) throw new Error('JSON record decoder checksum failed');
      values.push(performance.now() - start);
    }
    return summarize(values, runs);
  }
  function measureMemory(executable, name, runs) {
    const args = executable === cppExe ? [String(runs), inputFile] : [String(runs)];
    const timed = spawnSync('/usr/bin/time', ['-f', 'BMEC_MAX_RSS_KIB=%M', executable, ...args], { encoding: 'utf8', windowsHide: true });
    if (timed.error || timed.status !== 0) throw new Error(`${name} memory run failed: ${timed.stderr || timed.error?.message || timed.status}`);
    const peakRssKiB = Number(/BMEC_MAX_RSS_KIB=(\d+)/.exec(timed.stderr)?.[1]);
    if (!Number.isFinite(peakRssKiB)) throw new Error(`${name} peak RSS was not reported`);
    return peakRssKiB;
  }
  const referenceBatch = runs => {
    const start = performance.now();
    for (let i = 0; i < runs; ++i) if (referenceRun() !== true) throw new Error('BMEC reference checksum failed');
    return performance.now() - start;
  };
  const referenceRuns = calibrate(referenceBatch, 'BMEC reference');
  const nodeRuns = calibrate(runs => {
    const start = performance.now();
    for (let i = 0; i < runs; ++i) if (!nodeRun()) throw new Error('Node JSON record decoder checksum failed');
    return performance.now() - start;
  }, 'Node');
  const nativeRuns = calibrate(nativeRun, 'BMEC native');
  const cppRuns = calibrate(cppRun, 'C++');
  const reference = summarize(Array.from({ length: samples }, () => referenceBatch(referenceRuns)), referenceRuns);
  const node = measureJs(nodeRun, nodeRuns);
  const native = measureProcess(nativeRun, nativeRuns);
  const cpp = measureProcess(cppRun, cppRuns);
  const peakRssKiB = { native: measureMemory(nativeExe, 'BMEC native', nativeRuns), cpp: measureMemory(cppExe, 'C++', cppRuns), reference: 'not isolated', node: 'not isolated' };
  const startup = { native: [], cpp: [] };
  for (let i = 0; i < 7; ++i) {
    let start = performance.now(); nativeRun(1); startup.native.push(performance.now() - start);
    start = performance.now(); cppRun(1); startup.cpp.push(performance.now() - start);
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const inputSha256 = createHash('sha256').update(payload).digest('hex');
  if (referenceRun() !== true || !nodeRun()) throw new Error('Final decoder checksum confirmation failed');
  nativeRun(1);
  cppRun(1);
  const evidence = {
    version: 1,
    workload: 'decode a canonical BMEC record with an integer-list field and sum its values',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    node: process.version,
    inputBytes: Buffer.byteLength(payload),
    expectedChecksum: expectedChecksum.toString(),
    inputSha256,
    implementations: { reference, native, node, cpp },
    compilers: { native: { compiler, version: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c11', '-lm'], compileMs: nativeCompileMs }, cpp: { compiler: 'g++', version: execFileSync('g++', ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c++17'], compileMs: cppCompileMs } },
    buildPipelineMs: { nativeLoweringAndCGeneration: Number(loweringMs.toFixed(3)), nativeCCompilation: nativeCompileMs, cppCompilation: cppCompileMs },
    executableBytes: { native: statSync(nativeExe).size, cpp: statSync(cppExe).size },
    peakRssKiB,
    processLaunchPlusOneBatchMedianMs: { native: Number(median(startup.native).toFixed(3)), cpp: Number(median(startup.cpp).toFixed(3)) },
    ratios: { nativeOverCpp: Number((native.nsPerRecordDecode / cpp.nsPerRecordDecode).toFixed(3)), nativeOverNode: Number((native.nsPerRecordDecode / node.nsPerRecordDecode).toFixed(3)), nativeOverReference: Number((native.nsPerRecordDecode / reference.nsPerRecordDecode).toFixed(3)) },
  };
  writeFileSync(join(root, 'docs', 'evidence', 'bmec-0.5-json-record-list-decode-linux.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally { rmSync(work, { recursive: true, force: true }); }
