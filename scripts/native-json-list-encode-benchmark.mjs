#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const listItems = Number(process.env.BMEC_JSON_LIST_ITEMS ?? 64);
const elementKind = process.env.BMEC_JSON_LIST_TYPE ?? 'integer';
const numberPattern = process.env.BMEC_JSON_NUMBER_PATTERN ?? 'quarter';
const supportedKinds = ['integer', 'number', 'boolean', 'text'];
if (!Number.isInteger(samples) || samples < 5) throw new Error('BMEC_JSON_SAMPLES must be an integer of at least 5');
if (!Number.isInteger(warmups) || warmups < 1) throw new Error('BMEC_JSON_WARMUPS must be a positive integer');
if (!Number.isFinite(targetMs) || targetMs < 50 || targetMs > 500) throw new Error('BMEC_JSON_TARGET_MS must be between 50 and 500');
if (!Number.isInteger(listItems) || listItems < 1 || listItems > 512) throw new Error('BMEC_JSON_LIST_ITEMS must be an integer from 1 through 512');
if (!supportedKinds.includes(elementKind)) throw new Error(`BMEC_JSON_LIST_TYPE must be one of ${supportedKinds.join(', ')}`);
if (elementKind === 'number' && !['quarter', 'varied'].includes(numberPattern)) throw new Error('BMEC_JSON_NUMBER_PATTERN must be quarter or varied');

let randomState = 0x5eed1234;
const nextRandom = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
const values = Array.from({ length: listItems }, (_, index) => {
  switch (elementKind) {
    case 'integer': return index - Math.floor(listItems / 2);
    case 'number': return numberPattern === 'quarter' ? ((index % 101) - 50) / 4 : (nextRandom() - 0.5) * 1800;
    case 'boolean': return index % 3 !== 0;
    case 'text': return `row-${index} "λ"\\tail`;
  }
});
const valueToWire = value => elementKind === 'integer' || elementKind === 'text' ? String(value) : value;
const expected = JSON.stringify({
  version: 1,
  kind: 'list',
  elementType: { kind: 'primitive', name: elementKind },
  items: values.map(value => ({ version: 1, kind: elementKind, value: valueToWire(value) })),
});
const digest = createHash('sha256').update(expected).digest('hex');
const bmecItems = values.map(value => JSON.stringify(value)).join(', ');
const source = `function main() -> boolean { let values list<${elementKind}> = [${bmecItems}] return encodeJson(values) == ${JSON.stringify(expected)} }`;
const work = mkdtempSync(join(tmpdir(), 'bmec-json-list-encode-bench-'));
const sourcePath = join(work, 'json-list-encode.bmec');
writeFileSync(sourcePath, source, 'utf8');
const compiled = compileFile(sourcePath);
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));
const entry = compiled.ir.functions.find(fn => fn.name === 'main');
if (!entry || entry.returnTypeRef.kind !== 'primitive' || entry.returnTypeRef.name !== 'boolean') throw new Error('Unexpected native JSON list benchmark entry');
const entryC = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const loweringStart = performance.now();
const generated = lowerNativeC(compiled.ir).replace('#include <string.h>', '#include <string.h>\n#include <time.h>');
const loweringMs = performance.now() - loweringStart;
const prototype = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${entryC}\\(`, 'm').exec(generated);
if (!prototype) throw new Error('Native JSON list benchmark function prototype was not found');
const resultType = prototype[1];
const mainStart = generated.lastIndexOf('int main(');
if (mainStart < 0) throw new Error('Generated native main wrapper was not found');
const wrapper = `int main(int argc, char **argv) {
  if (argc != 2) return 2;
  char *end = NULL; int64_t runs = strtoll(argv[1], &end, 10);
  if (!end || *end || runs < 1 || runs > 10000000) return 2;
  struct timespec begin, finish; ${resultType} result = false;
  clock_gettime(CLOCK_MONOTONIC, &begin);
  for (int64_t i = 0; i < runs; ++i) { bmec_arena_release(); bmec_steps = 0; bmec_depth = 0; result = ${entryC}(); if (!result) return 1; }
  clock_gettime(CLOCK_MONOTONIC, &finish); bmec_arena_release();
  double elapsed = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0;
  printf("%.9f true\\n", elapsed); return 0;
}
`;
const cSource = join(work, 'json-list-encode.native.c');
writeFileSync(cSource, `${generated.slice(0, mainStart)}${wrapper}`, 'utf8');
const cppValues = elementKind === 'text'
  ? values.map(value => JSON.stringify(value)).join(', ')
  : values.map(value => elementKind === 'boolean' ? (value ? 'true' : 'false') : String(value)).join(', ');
const cppType = { integer: 'std::int64_t', number: 'double', boolean: 'bool', text: 'std::string' }[elementKind];
const cppSource = `#include <charconv>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <system_error>
#include <vector>
static const std::string expected = ${JSON.stringify(expected)};
static std::string escape_json(const std::string& input) {
  std::string output; static const char hex[] = "0123456789abcdef";
  for (unsigned char c : input) {
    if (c == '"' || c == '\\\\') { output.push_back('\\\\'); output.push_back(static_cast<char>(c)); }
    else if (c == '\\b') output += "\\\\b"; else if (c == '\\t') output += "\\\\t";
    else if (c == '\\n') output += "\\\\n"; else if (c == '\\f') output += "\\\\f"; else if (c == '\\r') output += "\\\\r";
    else if (c < 0x20) { output += "\\\\u00"; output.push_back(hex[c >> 4]); output.push_back(hex[c & 15]); }
    else output.push_back(static_cast<char>(c));
  }
  return output;
}
static std::string number_json(double value) {
  char buffer[64]; auto result = std::to_chars(buffer, buffer + sizeof(buffer), value, std::chars_format::general);
  if (result.ec != std::errc()) std::abort(); return std::string(buffer, result.ptr);
}
static std::string encode(const std::vector<${cppType}>& values) {
  std::string output = "{\\"version\\":1,\\"kind\\":\\"list\\",\\"elementType\\":{\\"kind\\":\\"primitive\\",\\"name\\":\\"${elementKind}\\"},\\"items\\":[";
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (i) output.push_back(',');
    output += "{\\"version\\":1,\\"kind\\":\\"${elementKind}\\",\\"value\\":";
    ${elementKind === 'integer' ? 'output += "\\\"" + std::to_string(values[i]) + "\\\"";' : ''}
    ${elementKind === 'number' ? 'output += number_json(values[i]);' : ''}
    ${elementKind === 'boolean' ? 'output += values[i] ? "true" : "false";' : ''}
    ${elementKind === 'text' ? 'output += "\\\"" + escape_json(values[i]) + "\\\"";' : ''}
    output.push_back('}');
  }
  output += "]}"; return output;
}
int main(int argc, char** argv) {
  if (argc != 2) return 2; char* end = nullptr; const long long runs = std::strtoll(argv[1], &end, 10);
  if (!end || *end || runs < 1 || runs > 10000000) return 2;
  const auto begin = std::chrono::steady_clock::now();
  for (long long i = 0; i < runs; ++i) { std::vector<${cppType}> values{${cppValues}}; if (encode(values) != expected) return 1; }
  const auto finish = std::chrono::steady_clock::now();
  std::cout << std::chrono::duration<double, std::milli>(finish - begin).count() << " true\\n";
}`;
const cppPath = join(work, 'json-list-encode.cpp');
writeFileSync(cppPath, cppSource, 'utf8');

const compiler = process.env.BMEC_CC ?? (spawnSync('clang', ['--version'], { encoding: 'utf8' }).status === 0 ? 'clang' : 'gcc');
const nativeExe = join(work, 'json-list-encode-native');
const cppExe = join(work, 'json-list-encode-cpp');
function compile(executable, args) {
  const start = performance.now();
  const result = spawnSync(args[0], [...args.slice(1), '-o', executable], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Compiler failed: ${result.stderr || result.error?.message || result.status}`);
  return Number((performance.now() - start).toFixed(3));
}
const nativeCompileMs = compile(nativeExe, [compiler, '-O3', '-std=c11', cSource, '-lm']);
const cppCompileMs = compile(cppExe, ['g++', '-O3', '-std=c++17', cppPath]);
const invoke = executable => runs => {
  const result = spawnSync(executable, [String(runs)], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.error?.message || result.status}`);
  const elapsed = Number(result.stdout.trim().split(/\s+/)[0]);
  if (!Number.isFinite(elapsed)) throw new Error(`${executable} returned invalid timing: ${result.stdout}`);
  return elapsed;
};
const nativeRun = invoke(nativeExe), cppRun = invoke(cppExe);
const nodeRun = () => {
  const encoded = JSON.stringify({ version: 1, kind: 'list', elementType: { kind: 'primitive', name: elementKind }, items: values.map(value => ({ version: 1, kind: elementKind, value: valueToWire(value) })) });
  return encoded === expected;
};
const referenceRun = () => executeValue(compiled.ir.functions, 'main', []);
function summarize(values, runs) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  return { samples: values.length, warmups, runsPerSample: runs, targetSampleMs: targetMs, minMs: sorted[0], medianMs, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], maxMs: sorted.at(-1), coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)), nsPerEncode: Number((medianMs * 1e6 / runs).toFixed(2)) };
}
function calibrate(fn, label) {
  let runs = 1, elapsed = fn(runs);
  while (elapsed < targetMs && runs < 8388608) { runs *= 2; elapsed = fn(runs); }
  if (elapsed < targetMs) throw new Error(`${label} calibration could not reach ${targetMs} ms`);
  return runs;
}
function measureProcess(fn, runs) {
  for (let i = 0; i < warmups; ++i) fn(runs);
  return summarize(Array.from({ length: samples }, () => fn(runs)), runs);
}
function measureJs(fn, runs) {
  for (let i = 0; i < warmups; ++i) for (let j = 0; j < runs; ++j) if (!fn()) throw new Error('Node JSON list checksum failed');
  const timings = [];
  for (let i = 0; i < samples; ++i) {
    const start = performance.now();
    for (let j = 0; j < runs; ++j) if (!fn()) throw new Error('Node JSON list checksum failed');
    timings.push(performance.now() - start);
  }
  return summarize(timings, runs);
}
function measureReference(runs) {
  for (let i = 0; i < warmups; ++i) for (let j = 0; j < runs; ++j) if (referenceRun() !== true) throw new Error('BMEC reference JSON list checksum failed');
  const timings = [];
  for (let i = 0; i < samples; ++i) {
    const start = performance.now();
    for (let j = 0; j < runs; ++j) if (referenceRun() !== true) throw new Error('BMEC reference JSON list checksum failed');
    timings.push(performance.now() - start);
  }
  return summarize(timings, runs);
}
function measureMemory(executable, name, runs) {
  const timed = spawnSync('/usr/bin/time', ['-f', 'BMEC_MAX_RSS_KIB=%M', executable, String(runs)], { encoding: 'utf8', windowsHide: true });
  if (timed.error || timed.status !== 0) throw new Error(`${name} memory run failed: ${timed.stderr || timed.error?.message || timed.status}`);
  const peakRssKiB = Number(/BMEC_MAX_RSS_KIB=(\d+)/.exec(timed.stderr)?.[1]);
  if (!Number.isFinite(peakRssKiB)) throw new Error(`${name} peak RSS was not reported`);
  return peakRssKiB;
}
try {
  if (referenceRun() !== true || !nodeRun()) throw new Error('Initial JSON list checksum failed');
  nativeRun(1); cppRun(1);
  const referenceRuns = calibrate(runs => { const start = performance.now(); for (let i = 0; i < runs; ++i) if (referenceRun() !== true) throw new Error('Reference checksum failed'); return performance.now() - start; }, 'BMEC reference');
  const nodeRuns = calibrate(runs => { const start = performance.now(); for (let i = 0; i < runs; ++i) if (!nodeRun()) throw new Error('Node checksum failed'); return performance.now() - start; }, 'Node');
  const nativeRuns = calibrate(nativeRun, 'BMEC native');
  const cppRuns = calibrate(cppRun, 'C++');
  const reference = measureReference(referenceRuns);
  const node = measureJs(nodeRun, nodeRuns);
  const native = measureProcess(nativeRun, nativeRuns);
  const cpp = measureProcess(cppRun, cppRuns);
  const memoryKiB = { native: measureMemory(nativeExe, 'BMEC native', nativeRuns), cpp: measureMemory(cppExe, 'C++', cppRuns), reference: 'not isolated', node: 'not isolated' };
  const evidence = {
    version: 1,
    benchmark: 'standalone primitive-list JSON encoding with exact wire comparison',
    workload: `encode a ${listItems}-item list<${elementKind}> into the canonical BMEC tagged JSON format`,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    node: process.version,
    elementKind,
    numberPattern: elementKind === 'number' ? numberPattern : undefined,
    listItems,
    inputBytes: Buffer.byteLength(JSON.stringify(values)),
    outputBytes: Buffer.byteLength(expected),
    outputSha256: digest,
    implementations: { reference, native, node, cpp },
    compilers: {
      native: { compiler, version: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c11', '-lm'], compileMs: nativeCompileMs },
      cpp: { compiler: 'g++', version: execFileSync('g++', ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c++17'], compileMs: cppCompileMs },
    },
    buildPipelineMs: { nativeLoweringAndCGeneration: Number(loweringMs.toFixed(3)), nativeCCompilation: nativeCompileMs, cppCompilation: cppCompileMs },
    executableBytes: { native: statSync(nativeExe).size, cpp: statSync(cppExe).size },
    peakRssKiB: memoryKiB,
    ratios: {
      nativeOverCpp: Number((native.nsPerEncode / cpp.nsPerEncode).toFixed(3)),
      nativeOverNode: Number((native.nsPerEncode / node.nsPerEncode).toFixed(3)),
      nativeOverReference: Number((native.nsPerEncode / reference.nsPerEncode).toFixed(3)),
    },
  };
  const suffix = elementKind === 'number' && numberPattern === 'varied' ? `number-varied-${listItems}` : `${elementKind}-${listItems}`;
  const outputName = process.env.BMEC_JSON_OUTPUT ?? `bmec-0.5-json-list-encode-${suffix}-${process.platform}.json`;
  writeFileSync(join(projectRoot, 'docs', 'evidence', outputName), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally { rmSync(work, { recursive: true, force: true }); }
