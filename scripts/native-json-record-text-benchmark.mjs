#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { compile } from '../dist/compiler.js';
import { executeValue } from '../dist/core/interpreter.js';
import { lowerNativeC } from '../dist/native/codegen.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sampleCount = Number(process.env.BMEC_JSON_SAMPLES ?? 9);
const warmupCount = Number(process.env.BMEC_JSON_WARMUPS ?? 2);
const targetMs = Number(process.env.BMEC_JSON_TARGET_MS ?? 75);
if (!Number.isInteger(sampleCount) || sampleCount < 3 || !Number.isInteger(warmupCount) || warmupCount < 0 || !Number.isFinite(targetMs) || targetMs < 50) throw new Error('Use at least 3 samples and a target of at least 50 ms');

const identity = 'examples/json-record-text-decode-bench/main.bmec';
const template = readFileSync(join(root, identity), 'utf8');
const seed = compile(template, identity);
if (seed.diagnostics.length) throw new Error(seed.diagnostics.map(item => item.message).join('\n'));
const payload = String(executeValue(seed.ir.functions, 'sampleWire', []));
const program = compile(template.replace(/^function sampleWire.*\r?\n/m, '').replaceAll('sampleWire()', JSON.stringify(payload)), identity);
if (program.diagnostics.length) throw new Error(program.diagnostics.map(item => item.message).join('\n'));
const run = program.ir.functions.find(fn => fn.name === 'run');
const entryPoint = program.ir.functions.find(fn => fn.name === 'main');
if (!run || run.parameters.length !== 1 || run.parameters[0].typeRef.kind !== 'primitive' || run.parameters[0].typeRef.name !== 'text' || run.returnTypeRef.kind !== 'primitive' || run.returnTypeRef.name !== 'boolean' || !entryPoint || entryPoint.parameters.length !== 0) throw new Error('Unexpected benchmark entry signature');
if (executeValue(program.ir.functions, 'run', [payload]) !== true) throw new Error('Reference benchmark workload did not validate its output');

const sourceBytes = new TextEncoder().encode(String(run.id));
const entry = `bmec_fn_${[...sourceBytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const temp = mkdtempSync(join(tmpdir(), 'bmec-json-record-text-'));
try {
  let generated = lowerNativeC(program.ir).replace('#include <string.h>', '#include <string.h>\n#include <time.h>');
  generated = generated.replace('\nint main(void) {', '\nstatic int bmec_generated_main(void) {');
  if (!generated.includes('static int bmec_generated_main(void) {') || !new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${entry}\\(`, 'm').test(generated)) throw new Error('Generated native entry/main was not found');
  let disabledTextListPath = false;
  const baselineSource = generated.replace(/bmec_json_fast_primitive_list_at\(source, &fast_record_cursor, 4, &fast_record_field_\d+_items, &fast_record_field_\d+_length, &fast_record_error\)/, call => {
    disabledTextListPath = true;
    return call.replace(', 4,', ', 0,');
  });
  if (!disabledTextListPath) throw new Error('Could not construct the text-list general-parser comparison variant');
  const wrapper = `int main(int argc, char **argv) {\n  if (argc != 3) return 2;\n  char *end = NULL; int64_t runs = strtoll(argv[1], &end, 10); if (!end || *end || runs < 1 || runs > 100000) return 2;\n  FILE *file = fopen(argv[2], "rb"); if (!file || fseek(file, 0, SEEK_END) != 0) return 2; long n = ftell(file); if (n < 0 || fseek(file, 0, SEEK_SET) != 0) return 2;\n  unsigned char *data = (unsigned char *)malloc((size_t)n + 1); if (!data || fread(data, 1, (size_t)n, file) != (size_t)n) return 2; fclose(file); bmec_text input = { data, (size_t)n };\n  struct timespec begin, finish; bool valid = true; clock_gettime(CLOCK_MONOTONIC, &begin);\n  for (int64_t i = 0; i < runs; ++i) { bmec_arena_release(); bmec_steps = 0; bmec_depth = 0; valid = ${entry}(input); if (!valid) return 1; }\n  clock_gettime(CLOCK_MONOTONIC, &finish); bmec_arena_release(); free(data); double elapsed = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0; printf("%.9f true\\n", elapsed); return 0;\n}\n`;
  const inputPath = join(temp, 'message.json');
  writeFileSync(inputPath, payload, 'utf8');
  const compiler = process.env.BMEC_CC ?? (spawnSync('clang', ['--version'], { encoding: 'utf8' }).status === 0 ? 'clang' : 'gcc');
  const variants = [
    { name: 'text-list general parser', source: baselineSource },
    { name: 'safe text-span list fast path', source: generated },
  ];
  for (const variant of variants) {
    const sourcePath = join(temp, `${variants.indexOf(variant)}.c`);
    variant.executable = join(temp, `${variants.indexOf(variant)}-bench`);
    const nativeSource = `${variant.source}\n${wrapper}`;
    writeFileSync(sourcePath, nativeSource, 'utf8');
    const result = spawnSync(compiler, ['-O3', '-std=c11', sourcePath, '-lm', '-o', variant.executable], { encoding: 'utf8', windowsHide: true, cwd: temp });
    if (result.error || result.status !== 0) throw new Error(`Compiler failed: ${result.stderr || result.error?.message || result.status}\nTail:\n${nativeSource.slice(-500)}`);
  }
  const time = (variant, runs) => {
    const result = spawnSync(variant.executable, [String(runs), inputPath], { encoding: 'utf8', windowsHide: true, cwd: temp });
    if (result.error || result.status !== 0 || !result.stdout.trim().endsWith('true')) throw new Error(`Benchmark failed: ${result.stderr || result.stdout || result.error?.message || result.status}`);
    const elapsedMs = Number(result.stdout.trim().split(/\s+/)[0]);
    if (!Number.isFinite(elapsedMs)) throw new Error(`Invalid timing: ${result.stdout}`);
    return elapsedMs;
  };
  const results = variants.map(variant => {
    let runs = 1;
    while (time(variant, runs) < targetMs) {
      runs *= 2;
      if (runs > 100000) throw new Error('Unable to calibrate benchmark target');
    }
    for (let i = 0; i < warmupCount; i++) time(variant, runs);
    const samples = Array.from({ length: sampleCount }, () => Number((time(variant, runs) * 1e6 / (runs * 100)).toFixed(3)));
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const cv = Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length) / mean;
    return { implementation: variant.name, runsPerSample: runs, decodesPerSample: runs * 100, medianNsPerDecode: sorted[Math.floor(sorted.length / 2)], p95NsPerDecode: sorted[Math.ceil(sorted.length * 0.95) - 1], minNsPerDecode: sorted[0], maxNsPerDecode: sorted.at(-1), coefficientOfVariation: Number(cv.toFixed(5)), samplesNsPerDecode: samples };
  });
  const ratio = results[1].medianNsPerDecode / results[0].medianNsPerDecode;
  const evidence = {
    version: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    benchmark: 'canonical BMEC record JSON decode with text lists, including empty and 20-item lists, read back with iteration checks',
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    compiler,
    compilerVersion: spawnSync(compiler, ['--version'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0],
    flags: ['-O3', '-std=c11', '-lm'],
    payloadBytes: Buffer.byteLength(payload),
    payloadSha256: (await import('node:crypto')).createHash('sha256').update(payload).digest('hex'),
    checksum: true,
    warmups: warmupCount,
    sampleCount,
    targetMs,
    variants: results,
    optimizedToBaselineRatio: Number(ratio.toFixed(5)),
    reductionPercent: Number(((1 - ratio) * 100).toFixed(2)),
    caveat: 'Paired variants use the same generated program, payload, input buffer, compiler, and loop. Both retain the scalar text span fast path; the baseline disables only the text-list fast reader, forcing that record field through the general parser.'
  };
  const destination = process.env.BMEC_JSON_EVIDENCE;
  if (destination) writeFileSync(resolve(destination), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
