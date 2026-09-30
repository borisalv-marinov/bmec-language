#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { compile } from '../dist/compiler.js';
import { executeValue } from '../dist/core/interpreter.js';
import { lowerNativeC } from '../dist/native/codegen.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sampleCount = Number(process.env.BMEC_JSON_SAMPLES ?? 9);
const warmups = Number(process.env.BMEC_JSON_WARMUPS ?? 2);
const targetMs = Number(process.env.BMEC_JSON_TARGET_MS ?? 75);
if (!Number.isInteger(sampleCount) || sampleCount < 3 || !Number.isInteger(warmups) || warmups < 0 || !Number.isFinite(targetMs) || targetMs < 50) throw new Error('Use at least three samples and a target of at least 50 ms');

const identity = 'examples/json-text-list-decode-bench/main.bmec';
const sourceTemplate = readFileSync(join(root, identity), 'utf8');
const seed = compile(sourceTemplate, identity);
if (seed.diagnostics.length) throw new Error(seed.diagnostics.map(item => item.message).join('\n'));
const payload = String(executeValue(seed.ir.functions, 'sampleWire', []));
const programSource = sourceTemplate.replace(/^function sampleWire\(\)[\s\S]*?^\}\r?\n/m, '').replaceAll('sampleWire()', '""');
const program = compile(programSource, identity);
if (program.diagnostics.length) throw new Error(program.diagnostics.map(item => item.message).join('\n'));
if (executeValue(program.ir.functions, 'countMatches', [payload]) !== true) throw new Error('Reference decoder checksum failed');
const decoder = program.ir.functions.find(fn => fn.name === 'countMatches');
if (!decoder || decoder.parameters.length !== 1) throw new Error('Unexpected decoder function signature');
const decoderC = `bmec_fn_${[...new TextEncoder().encode(String(decoder.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;

const temp = mkdtempSync(join(tmpdir(), 'bmec-json-text-list-decode-'));
try {
  let generated = lowerNativeC(program.ir).replace('#include <string.h>', '#include <string.h>\n#include <time.h>');
  generated = generated.replace('\nint main(void) {', '\nstatic int bmec_generated_main(void) {');
  if (!generated.includes('static int bmec_generated_main(void) {') || !new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${decoderC}\\(`, 'm').test(generated)) throw new Error('Generated native decoder/main was not found');
  let disabledFastPath = false;
  const fallbackSource = generated.replace(/bmec_json_fast_primitive_list_at\(source, &fast_cursor, 4, &fast_items, &fast_length, &fast_error\)/, call => {
    disabledFastPath = true;
    return call.replace(', 4,', ', 0,');
  });
  if (!disabledFastPath) throw new Error('Could not make the generic-parser comparison variant');
  const wrapper = `int main(int argc, char **argv) {\n  if (argc != 3) return 2;\n  char *end = NULL; int64_t runs = strtoll(argv[1], &end, 10); if (!end || *end || runs < 1 || runs > 1000000) return 2;\n  FILE *file = fopen(argv[2], "rb"); if (!file || fseek(file, 0, SEEK_END) != 0) return 2; long n = ftell(file); if (n < 0 || fseek(file, 0, SEEK_SET) != 0) return 2;\n  unsigned char *data = (unsigned char *)malloc((size_t)n + 1); if (!data || fread(data, 1, (size_t)n, file) != (size_t)n) return 2; fclose(file); bmec_text input = { data, (size_t)n };\n  struct timespec begin, finish; bool valid = true; clock_gettime(CLOCK_MONOTONIC, &begin);\n  for (int64_t i = 0; i < runs; ++i) { bmec_arena_release(); bmec_steps = 0; bmec_depth = 0; valid = ${decoderC}(input); if (!valid) return 1; }\n  clock_gettime(CLOCK_MONOTONIC, &finish); bmec_arena_release(); free(data); double elapsed = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0; printf("%.9f true\\n", elapsed); return 0;\n}\n`;
  const inputPath = join(temp, 'text-list.json');
  writeFileSync(inputPath, payload, 'utf8');
  const compiler = process.env.BMEC_CC ?? (spawnSync('clang', ['--version'], { encoding: 'utf8' }).status === 0 ? 'clang' : 'gcc');
  const nativeVariants = [
    { key: 'nativeFallback', name: 'native general parser', source: fallbackSource },
    { key: 'native', name: 'native text-list fast path', source: generated },
  ];
  for (let index = 0; index < nativeVariants.length; index++) {
    const variant = nativeVariants[index];
    const cPath = join(temp, `${index}.c`);
    variant.executable = join(temp, `${index}-native`);
    writeFileSync(cPath, `${variant.source}\n${wrapper}`, 'utf8');
    const start = performance.now();
    const build = spawnSync(compiler, ['-O3', '-std=c11', cPath, '-lm', '-o', variant.executable], { encoding: 'utf8', windowsHide: true, cwd: temp });
    variant.compileMs = Number((performance.now() - start).toFixed(3));
    if (build.error || build.status !== 0) throw new Error(`Native compiler failed: ${build.stderr || build.error?.message || build.status}`);
  }
  const cppPath = join(root, 'benchmarks', 'native', 'json-decode-text-list.cpp');
  const cppExe = join(temp, 'text-list-cpp');
  const cppStart = performance.now();
  const cppBuild = spawnSync('g++', ['-O3', '-std=c++17', cppPath, '-o', cppExe], { encoding: 'utf8', windowsHide: true, cwd: temp });
  const cppCompileMs = Number((performance.now() - cppStart).toFixed(3));
  if (cppBuild.error || cppBuild.status !== 0) throw new Error(`C++ compiler failed: ${cppBuild.stderr || cppBuild.error?.message || cppBuild.status}`);

  const processTime = (executable, runs) => {
    const result = spawnSync(executable, [String(runs), inputPath], { encoding: 'utf8', windowsHide: true, cwd: temp });
    if (result.error || result.status !== 0 || !result.stdout.trim().endsWith('true')) throw new Error(`Benchmark executable failed: ${result.stderr || result.error?.message || result.status}`);
    const elapsed = Number(result.stdout.trim().split(/\s+/)[0]);
    if (!Number.isFinite(elapsed)) throw new Error(`Invalid timing result: ${result.stdout}`);
    return elapsed;
  };
  const referenceOne = () => executeValue(program.ir.functions, 'countMatches', [payload]) === true;
  const nodeOne = () => {
    const wire = JSON.parse(payload);
    if (wire.version !== 1 || wire.kind !== 'list' || wire.elementType?.kind !== 'primitive' || wire.elementType?.name !== 'text' || !Array.isArray(wire.items) || wire.items.length !== 20) return false;
    let found = false;
    for (const item of wire.items) {
      if (item?.version !== 1 || item.kind !== 'text' || typeof item.value !== 'string') return false;
      if (item.value === 'β') found = true;
    }
    return found;
  };
  if (!nodeOne()) throw new Error('Node decoder checksum failed');
  const jsTime = (one, runs) => {
    const start = performance.now();
    for (let i = 0; i < runs; i++) if (!one()) throw new Error('Decoder checksum failed');
    return performance.now() - start;
  };
  const calibrate = (time, label) => {
    let runs = 1;
    while (time(runs) < targetMs) {
      runs *= 2;
      if (runs > 1000000) throw new Error(`Could not calibrate ${label} to ${targetMs} ms`);
    }
    return runs;
  };
  const summarize = (samples, runs) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const cv = Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length) / mean;
    const medianMs = sorted[Math.floor(sorted.length / 2)];
    return { runsPerSample: runs, sampleCount: samples.length, warmups, targetMs, medianNsPerDecode: Number((medianMs * 1e6 / runs).toFixed(3)), p95NsPerDecode: Number((sorted[Math.ceil(sorted.length * .95) - 1] * 1e6 / runs).toFixed(3)), minNsPerDecode: Number((sorted[0] * 1e6 / runs).toFixed(3)), maxNsPerDecode: Number((sorted.at(-1) * 1e6 / runs).toFixed(3)), coefficientOfVariation: Number(cv.toFixed(5)), samplesNsPerDecode: samples.map(ms => Number((ms * 1e6 / runs).toFixed(3))) };
  };
  const measureProcess = (time, label) => {
    const runs = calibrate(time, label);
    for (let i = 0; i < warmups; i++) time(runs);
    return summarize(Array.from({ length: sampleCount }, () => time(runs)), runs);
  };
  const measureJs = (one, label) => {
    const runs = calibrate(count => jsTime(one, count), label);
    for (let i = 0; i < warmups; i++) jsTime(one, runs);
    return summarize(Array.from({ length: sampleCount }, () => jsTime(one, runs)), runs);
  };
  const baseline = measureProcess(runs => processTime(nativeVariants[0].executable, runs), 'native fallback');
  const native = measureProcess(runs => processTime(nativeVariants[1].executable, runs), 'native fast path');
  const cpp = measureProcess(runs => processTime(cppExe, runs), 'C++');
  const reference = measureJs(referenceOne, 'BMEC reference');
  const node = measureJs(nodeOne, 'Node');
  const evidence = {
    version: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workload: 'decode a canonical BMEC list<text> JSON payload of 20 items, count items, and find a Unicode sentinel',
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    node: process.version,
    payloadBytes: Buffer.byteLength(payload),
    payloadSha256: createHash('sha256').update(payload).digest('hex'),
    checksum: true,
    compiler: { native: { path: compiler, version: spawnSync(compiler, ['--version'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0], flags: ['-O3', '-std=c11', '-lm'], compileMs: nativeVariants.map(item => item.compileMs) }, cpp: { path: 'g++', version: spawnSync('g++', ['--version'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0], flags: ['-O3', '-std=c++17'], compileMs: cppCompileMs } },
    executableBytes: { nativeFallback: statSync(nativeVariants[0].executable).size, native: statSync(nativeVariants[1].executable).size, cpp: statSync(cppExe).size },
    implementations: { nativeFallback: baseline, native, cpp, node, reference },
    ratios: { nativeOverFallback: Number((native.medianNsPerDecode / baseline.medianNsPerDecode).toFixed(5)), nativeOverCpp: Number((native.medianNsPerDecode / cpp.medianNsPerDecode).toFixed(5)), nativeOverNode: Number((native.medianNsPerDecode / node.medianNsPerDecode).toFixed(5)), nativeOverReference: Number((native.medianNsPerDecode / reference.medianNsPerDecode).toFixed(5)) },
  };
  const destination = process.env.BMEC_JSON_EVIDENCE;
  if (destination) writeFileSync(resolve(destination), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
