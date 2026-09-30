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
const nativeProfile = process.env.BMEC_NATIVE_PROFILE === '1';
const keepArtifacts = process.env.BMEC_KEEP_BENCH_ARTIFACTS === '1';
const iterationsPerInvocation = 100;
const sourceIdentity = 'examples/json-record-mixed-decode-bench/main.bmec';
const sourceTemplate = readFileSync(join(root, sourceIdentity), 'utf8');
const seed = compile(sourceTemplate.replaceAll('__BMEC_RECORD_PAYLOAD__', '""'), sourceIdentity);
if (seed.diagnostics.length) throw new Error(seed.diagnostics.map(item => item.message).join('\n'));
const payload = String(executeValue(seed.ir.functions, 'sampleWire', []));
const benchmarkSource = sourceTemplate.replace(/^function sampleWire.*\r?\n/m, '');
const compiled = compile(benchmarkSource.replaceAll('__BMEC_RECORD_PAYLOAD__', JSON.stringify(payload)), sourceIdentity);
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));
if (JSON.stringify(compiled.ir).includes(JSON.stringify(payload))) throw new Error('BMEC IR must not embed the benchmark payload');
const entry = compiled.ir.functions.find(fn => fn.name === 'run');
if (!entry || entry.returnTypeRef.kind !== 'primitive' || entry.returnTypeRef.name !== 'boolean' || entry.parameters.length !== 1 || entry.parameters[0].typeRef.kind !== 'primitive' || entry.parameters[0].typeRef.name !== 'text') throw new Error('Unexpected mixed record-list benchmark function');
const entryC = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const work = mkdtempSync(join(tmpdir(), 'bmec-json-record-mixed-bench-'));
try {
  const loweringStart = performance.now();
  const generated = lowerNativeC(compiled.ir).replace('#include <string.h>', '#include <string.h>\n#include <time.h>');
  const loweringMs = performance.now() - loweringStart;
  const prototype = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${entryC}\\(`, 'm').exec(generated);
  if (!prototype) throw new Error('Generated native entry function was not found');
  const mainStart = generated.lastIndexOf('int main(');
  if (mainStart < 0) throw new Error('Generated native main wrapper was not found');
  const wrapper = `int main(int argc, char **argv) {\n  if (argc != 3) return 2;\n  char *end = NULL; int64_t runs = strtoll(argv[1], &end, 10);\n  if (!end || *end || runs < 1 || runs > 100000) return 2;\n  FILE *input_file = fopen(argv[2], "rb"); if (!input_file || fseek(input_file, 0, SEEK_END) != 0) return 2;\n  long input_length = ftell(input_file); if (input_length < 0 || fseek(input_file, 0, SEEK_SET) != 0) return 2;\n  unsigned char *input_data = (unsigned char *)malloc((size_t)input_length + 1); if (!input_data) return 2;\n  if (fread(input_data, 1, (size_t)input_length, input_file) != (size_t)input_length) return 2; fclose(input_file);\n  bmec_text source = { input_data, (size_t)input_length };\n  struct timespec begin, finish; bool result = false;\n  clock_gettime(CLOCK_MONOTONIC, &begin);\n  for (int64_t i = 0; i < runs; ++i) { bmec_arena_release(); bmec_steps = 0; bmec_depth = 0; result = ${entryC}(source); if (!result) return 1; }\n  clock_gettime(CLOCK_MONOTONIC, &finish); bmec_arena_release(); free(input_data);\n  double elapsed = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0;\n  printf("%.9f true\\n", elapsed); return 0;\n}\n`;
  const cSource = join(work, 'json-record-mixed.native.c');
  writeFileSync(cSource, `${generated.slice(0, mainStart)}${wrapper}`, 'utf8');
  const cppSource = join(work, 'json-record-mixed.cpp');
  const inputFile = join(work, 'record-mixed-input.json');
  writeFileSync(cppSource, readFileSync(join(root, 'benchmarks/native/json-decode-record-mixed.cpp'), 'utf8'));
  writeFileSync(inputFile, payload, 'utf8');
  const compiler = process.env.BMEC_CC ?? (spawnSync('clang', ['--version'], { encoding: 'utf8' }).status === 0 ? 'clang' : 'gcc');
  const nativeExe = join(work, 'json-record-mixed-native');
  const cppExe = join(work, 'json-record-mixed-cpp');
  function compileExecutable(executable, args) {
    const start = performance.now();
    const result = spawnSync(args[0], [...args.slice(1), '-o', executable], { encoding: 'utf8', windowsHide: true, cwd: work });
    if (result.error || result.status !== 0) throw new Error(`Compiler failed: ${result.stderr || result.error?.message || result.status}`);
    return Number((performance.now() - start).toFixed(3));
  }
  const nativeFlags = ['-O3', '-std=c11', ...(nativeProfile ? ['-pg'] : []), cSource, '-lm'];
  const nativeCompileMs = compileExecutable(nativeExe, [compiler, ...nativeFlags]);
  const cppCompileMs = compileExecutable(cppExe, ['g++', '-O3', '-std=c++17', cppSource]);
  const invoke = (executable, extraArgs = []) => runs => {
    const result = spawnSync(executable, [String(runs), ...extraArgs], { encoding: 'utf8', windowsHide: true, cwd: work });
    if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.error?.message || result.status}`);
    const elapsed = Number(result.stdout.trim().split(/\s+/)[0]);
    if (!Number.isFinite(elapsed)) throw new Error(`${executable} returned invalid timing: ${result.stdout}`);
    return elapsed;
  };
  const nativeRun = invoke(nativeExe, [inputFile]);
  const cppRun = invoke(cppExe, [inputFile]);
  const referenceRun = runs => {
    let result = false;
    for (let i = 0; i < runs; i++) result = executeValue(compiled.ir.functions, 'run', [payload]);
    return result;
  };
  const nodeRun = runs => {
    for (let i = 0; i < runs * iterationsPerInvocation; i++) {
      const wire = JSON.parse(payload);
      if (wire.version !== 1 || wire.kind !== 'record' || wire.type?.kind !== 'record' || wire.type?.name !== 'Sample' || wire.type?.symbol !== 'examples/json-record-mixed-decode-bench/main.bmec:RecordDeclaration:0') return false;
      const fields = wire.fields;
      if (!fields || Object.keys(fields).length !== 6) return false;
      const intItems = fields?.values?.items;
      const numberItems = fields?.fractions?.items;
      const boolItems = fields?.flags?.items;
      if (fields?.count?.version !== 1 || fields?.count?.kind !== 'integer' || fields?.ratio?.version !== 1 || fields?.ratio?.kind !== 'number' || fields?.enabled?.version !== 1 || fields?.enabled?.kind !== 'boolean') return false;
      if (fields?.values?.version !== 1 || fields?.values?.kind !== 'list' || fields?.values?.elementType?.kind !== 'primitive' || fields?.values?.elementType?.name !== 'integer' || fields?.fractions?.version !== 1 || fields?.fractions?.kind !== 'list' || fields?.fractions?.elementType?.kind !== 'primitive' || fields?.fractions?.elementType?.name !== 'number' || fields?.flags?.version !== 1 || fields?.flags?.kind !== 'list' || fields?.flags?.elementType?.kind !== 'primitive' || fields?.flags?.elementType?.name !== 'boolean' || !Array.isArray(intItems) || !Array.isArray(numberItems) || !Array.isArray(boolItems)) return false;
      let integerSum = BigInt(fields.count.value);
      for (const item of intItems) { if (item?.kind !== 'integer' || typeof item.value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(item.value)) return false; integerSum += BigInt(item.value); }
      const numberSum = numberItems.reduce((sum, item) => { if (item?.version !== 1 || item?.kind !== 'number' || typeof item.value !== 'number' || !Number.isFinite(item.value)) throw new Error('Invalid number list payload'); return sum + item.value; }, 0);
      const trueCount = boolItems.reduce((sum, item) => { if (item?.version !== 1 || item?.kind !== 'boolean' || typeof item.value !== 'boolean') throw new Error('Invalid boolean list payload'); return sum + (item.value ? 1 : 0); }, 0);
      if (integerSum !== 53n || fields.ratio.value !== 1.25 || fields.enabled.value !== true || numberSum !== 1.75 || trueCount !== 2) return false;
    }
    return true;
  };
  function summarize(values, runs) {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const medianMs = sorted[Math.floor(sorted.length / 2)];
    return { samples: values.length, warmups, runsPerSample: runs, iterationsPerInvocation, totalRecordDecodesPerSample: runs * iterationsPerInvocation, targetSampleMs: targetMs, minMs: sorted[0], medianMs, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], maxMs: sorted.at(-1), coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)), nsPerRecordDecode: Number((medianMs * 1e6 / (runs * iterationsPerInvocation)).toFixed(2)) };
  }
  function calibrate(fn, label) {
    let runs = 1, elapsed = fn(runs);
    while (elapsed < targetMs && runs < 65536) { runs *= 2; elapsed = fn(runs); }
    if (elapsed < targetMs) throw new Error(`${label} calibration could not reach ${targetMs} ms`);
    return runs;
  }
  function measureNative(fn, runs) {
    for (let i = 0; i < warmups; i++) fn(runs);
    const values = [];
    for (let i = 0; i < samples; i++) values.push(fn(runs));
    return summarize(values, runs);
  }
  function runInProcess(fn, runs) { for (let i = 0; i < warmups; i++) if (fn(runs) !== true) throw new Error('Warmup result mismatch'); const values = []; for (let i = 0; i < samples; i++) { const start = performance.now(); if (fn(runs) !== true) throw new Error('Sample result mismatch'); values.push(performance.now() - start); } return summarize(values, runs); }
  const referenceRuns = calibrate(runs => { const start = performance.now(); const ok = referenceRun(runs); const elapsed = performance.now() - start; if (!ok) throw new Error('Reference result mismatch'); return elapsed; }, 'reference');
  const nodeRuns = calibrate(runs => { const start = performance.now(); const ok = nodeRun(runs); const elapsed = performance.now() - start; if (!ok) throw new Error('Node result mismatch'); return elapsed; }, 'Node');
  const nativeRuns = calibrate(nativeRun, 'native');
  const cppRuns = calibrate(cppRun, 'C++');
  const reference = runInProcess(referenceRun, referenceRuns);
  const node = runInProcess(nodeRun, nodeRuns);
  const native = measureNative(nativeRun, nativeRuns);
  const cpp = measureNative(cppRun, cppRuns);
  const revision = process.env.BMEC_BENCH_REVISION ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const cpu = cpus()[0]?.model ?? 'unknown';
  const output = {
    version: 1,
    benchmark: 'mixed primitive record/list JSON decode and aggregate',
    revision,
    platform: `${process.platform} ${process.arch}`,
    cpu,
    nodeVersion: process.version,
    nativeCompiler: compiler,
    nativeFlags: ['-O3', '-std=c11', ...(nativeProfile ? ['-pg'] : []), '-lm'],
    cppCompiler: execFileSync('g++', ['--version'], { encoding: 'utf8' }).split('\n')[0],
    cppFlags: ['-O3', '-std=c++17'],
    inputBytes: Buffer.byteLength(payload),
    inputSha256: createHash('sha256').update(payload).digest('hex'),
    expectedResult: true,
    iterationsPerInvocation,
    methods: {
      reference: { ...reference, result: true },
      native: { ...native, result: true, compileMs: nativeCompileMs, executableBytes: statSync(nativeExe).size },
      node: { ...node, result: true },
      cpp: { ...cpp, result: true, compileMs: cppCompileMs, executableBytes: statSync(cppExe).size },
    },
    ratiosToCpp: {
      reference: Number((reference.nsPerRecordDecode / cpp.nsPerRecordDecode).toFixed(3)),
      native: Number((native.nsPerRecordDecode / cpp.nsPerRecordDecode).toFixed(3)),
      node: Number((node.nsPerRecordDecode / cpp.nsPerRecordDecode).toFixed(3)),
    },
    loweringMs: Number(loweringMs.toFixed(3)),
    ...(nativeProfile && keepArtifacts ? { profileExecutable: nativeExe, profileData: join(work, 'gmon.out') } : {}),
  };
  console.log(JSON.stringify(output, null, 2));
} finally {
  if (!keepArtifacts) rmSync(work, { recursive: true, force: true });
}
