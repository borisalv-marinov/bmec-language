#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compile } from '../dist/compiler.js';
import { executeValue } from '../dist/core/interpreter.js';
import { lowerNativeC } from '../dist/native/codegen.js';

if (process.platform !== 'linux') {
  console.log(JSON.stringify({ version: 1, platform: process.platform, skipped: 'Native JSON transform benchmark currently targets Linux.' }, null, 2));
  process.exit(0);
}

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const samples = Number(process.env.BMEC_JSON_TRANSFORM_SAMPLES ?? 9);
const warmups = Number(process.env.BMEC_JSON_TRANSFORM_WARMUPS ?? 2);
const targetMs = Number(process.env.BMEC_JSON_TRANSFORM_TARGET_MS ?? 75);
const itemCount = Number(process.env.BMEC_JSON_TRANSFORM_ITEMS ?? 128);
const includeLto = process.env.BMEC_JSON_TRANSFORM_LTO === '1';
const evidenceOutput = process.env.BMEC_JSON_TRANSFORM_OUTPUT;
// Keep each reference-runtime entry below its interpreter step budget for larger records.
const iterationsPerInvocation = itemCount <= 128 ? 100 : 1;
if (!Number.isSafeInteger(samples) || samples < 5 || samples > 100) throw new Error('BMEC_JSON_TRANSFORM_SAMPLES must be from 5 through 100');
if (!Number.isSafeInteger(itemCount) || itemCount < 1 || itemCount > 4096) throw new Error('BMEC_JSON_TRANSFORM_ITEMS must be from 1 through 4096');

const templatePath = join(root, 'benchmarks', 'native', 'json-record-transform.bmec.in');
const template = readFileSync(templatePath, 'utf8');
const values = Array.from({ length: itemCount }, (_, index) => index + 1);
const expectedTotal = 17 + (itemCount * (itemCount + 1)) / 2;
const expectedOutput = JSON.stringify({
  count: { version: 1, kind: 'integer', value: String(18) },
  ratioDoubledIs2_5: { version: 1, kind: 'boolean', value: true },
  enabled: { version: 1, kind: 'boolean', value: false },
  total: { version: 1, kind: 'integer', value: String(expectedTotal) },
  label: { version: 1, kind: 'text', value: 'log-π!' },
  labels: { version: 1, kind: 'text', value: 'π|東京!' },
});
const source = template
  .replace('__BMEC_VALUES__', `[${values.join(', ')}]`)
  .replace('__BMEC_TRANSFORMS__', String(iterationsPerInvocation))
  .replace('__BMEC_EXPECTED__', JSON.stringify(expectedOutput));
const seed = compile(source.replaceAll('__BMEC_PAYLOAD__', '""'), 'benchmarks/native/json-record-transform.bmec.in');
if (seed.diagnostics.length) throw new Error(seed.diagnostics.map(item => item.message).join('\n'));
const payload = String(executeValue(seed.ir.functions, 'sampleWire', []));
const benchmarkSource = source.replaceAll('__BMEC_PAYLOAD__', JSON.stringify(payload));
const compiled = compile(benchmarkSource, 'benchmarks/native/json-record-transform.bmec.in');
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));
if (String(executeValue(compiled.ir.functions, 'transform', [payload])) !== expectedOutput) throw new Error('BMEC transform output did not match the canonical expected JSON');
const entry = compiled.ir.functions.find(fn => fn.name === 'main');
if (!entry || entry.returnTypeRef.kind !== 'primitive' || entry.returnTypeRef.name !== 'boolean') throw new Error('Unexpected JSON transform entry type');
const entryC = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const work = mkdtempSync(join(tmpdir(), 'bmec-json-transform-bench-'));
try {
  const c = lowerNativeC(compiled.ir).replace('#include <string.h>', '#include <string.h>\n#include <time.h>');
  const mainStart = c.lastIndexOf('int main(');
  const prototype = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${entryC}\\(`, 'm').exec(c);
  if (mainStart < 0 || !prototype) throw new Error('Could not locate generated native entry');
  const wrapper = `int main(int argc, char **argv) {\n  if (argc != 2) return 2;\n  char *end = NULL; int64_t runs = strtoll(argv[1], &end, 10);\n  if (!end || *end || runs < 1 || runs > 100000) return 2;\n  struct timespec begin, finish; ${prototype[1]} result = false;\n  clock_gettime(CLOCK_MONOTONIC, &begin);\n  for (int64_t i = 0; i < runs; ++i) { bmec_arena_release(); bmec_steps = 0; bmec_depth = 0; result = ${entryC}(); if (!result) return 1; }\n  clock_gettime(CLOCK_MONOTONIC, &finish); bmec_arena_release();\n  double elapsed = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0;\n  printf("%.9f true\\n", elapsed); return 0;\n}\n`;
  const cPath = join(work, 'json-transform.c');
  const cppPath = join(work, 'json-transform.cpp');
  const inputPath = join(work, 'input.json');
  const nativeExe = join(work, 'json-transform-native');
  const cppExe = join(work, 'json-transform-cpp');
  const nativeLtoExe = join(work, 'json-transform-native-lto');
  const cppLtoExe = join(work, 'json-transform-cpp-lto');
  writeFileSync(cPath, `${c.slice(0, mainStart)}${wrapper}`, 'utf8');
  writeFileSync(inputPath, payload, 'utf8');
  const cppSource = `#include <charconv>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>
#include <string_view>
static bool integer_field(std::string_view json, std::string_view field, int64_t& out) {
  const auto key = json.find(field); if (key == json.npos) return false;
  auto at = json.find("\\\"value\\\":\\\"", key); if (at == json.npos) return false; at += 9;
  const auto end = json.find('"', at); if (end == json.npos) return false;
  auto parsed = std::from_chars(json.data() + at, json.data() + end, out);
  return parsed.ec == std::errc{} && parsed.ptr == json.data() + end;
}
static bool number_field(std::string_view json, std::string_view field, double& out) {
  const auto key = json.find(field); if (key == json.npos) return false;
  auto at = json.find("\\\"value\\\":", key); if (at == json.npos) return false; at += 8;
  std::string remaining(json.substr(at)); char *end = nullptr; out = std::strtod(remaining.c_str(), &end);
  return end && end != remaining.c_str();
}
static bool boolean_field(std::string_view json, std::string_view field, bool& out) {
  const auto key = json.find(field); if (key == json.npos) return false;
  auto at = json.find("\\\"value\\\":", key); if (at == json.npos) return false; at += 8;
  if (json.substr(at, 4) == "true") { out = true; return true; }
  if (json.substr(at, 5) == "false") { out = false; return true; }
  return false;
}
static bool text_field(std::string_view json, std::string_view field, std::string_view& out) {
  const auto key = json.find(field); if (key == json.npos) return false;
  auto at = json.find("\\\"value\\\":\\\"", key); if (at == json.npos) return false; at += 9;
  const auto end = json.find('"', at); if (end == json.npos) return false;
  out = json.substr(at, end - at); return true;
}
static bool text_list_field(std::string_view json, std::string_view field, std::string& out) {
  const auto key = json.find(field); if (key == json.npos) return false;
  auto items = json.find("\\\"items\\\":[", key); if (items == json.npos) return false; items += 9;
  const auto items_end = json.find(']', items); if (items_end == json.npos) return false;
  size_t cursor = items; bool first = true;
  while (true) {
    const auto value = json.find("\\\"value\\\":\\\"", cursor);
    if (value == json.npos || value >= items_end) break;
    const auto start = value + 9;
    const auto end = json.find('"', start);
    if (end == json.npos || end > items_end) return false;
    if (!first) out.push_back('|');
    out.append(json.data() + start, end - start); first = false; cursor = end + 1;
  }
  out.push_back('!'); return !first;
}
static bool transform(std::string_view json, int64_t expectedTotal) {
  if (json.find("\\\"name\\\":\\\"Sample\\\"") == json.npos || json.find("\\\"kind\\\":\\\"record\\\"") == json.npos) { std::fputs("C++ record header mismatch\\n", stderr); return false; }
  int64_t count = 0; double ratio = 0; bool enabled = false; std::string_view label; std::string labels;
  if (!integer_field(json, "\\\"count\\\"", count) || !number_field(json, "\\\"ratio\\\"", ratio) || !boolean_field(json, "\\\"enabled\\\"", enabled)) { std::fputs("C++ scalar parse mismatch\\n", stderr); return false; }
  if (!text_field(json, "\\\"label\\\"", label)) { std::fputs("C++ text field parse mismatch\\n", stderr); return false; }
  if (!text_list_field(json, "\\\"labels\\\"", labels)) { std::fputs("C++ text list parse mismatch\\n", stderr); return false; }
  auto items = json.find("\\\"items\\\":["); if (items == json.npos) { std::fputs("C++ list missing\\n", stderr); return false; } items += 9;
  const auto itemsEnd = json.find(']', items); if (itemsEnd == json.npos) return false;
  int64_t total = count; size_t found = 0; size_t at = items;
  while ((at = json.find("\\\"value\\\":\\\"", at)) != json.npos && at < itemsEnd) {
    const auto end = json.find('"', at + 9); if (end == json.npos) return false;
    int64_t value = 0; auto parsed = std::from_chars(json.data() + at + 9, json.data() + end, value);
    if (parsed.ec != std::errc{} || parsed.ptr != json.data() + end) return false;
    total += value; ++found; at = end + 1;
    if (at < json.size() && json[at] == ']') break;
  }
  if (found != ${itemCount} || total != expectedTotal) { std::fprintf(stderr, "C++ list mismatch found=%zu total=%lld\\n", found, (long long)total); return false; }
  const std::string out = "{\\\"count\\\":{\\\"version\\\":1,\\\"kind\\\":\\\"integer\\\",\\\"value\\\":\\\"" + std::to_string(count + 1) + "\\\"},\\\"ratioDoubledIs2_5\\\":{\\\"version\\\":1,\\\"kind\\\":\\\"boolean\\\",\\\"value\\\":" + ((ratio * 2.0 == 2.5) ? "true" : "false") + "},\\\"enabled\\\":{\\\"version\\\":1,\\\"kind\\\":\\\"boolean\\\",\\\"value\\\":" + (enabled ? "false" : "true") + "},\\\"total\\\":{\\\"version\\\":1,\\\"kind\\\":\\\"integer\\\",\\\"value\\\":\\\"" + std::to_string(total) + "\\\"},\\\"label\\\":{\\\"version\\\":1,\\\"kind\\\":\\\"text\\\",\\\"value\\\":\\\"" + std::string(label) + "!\\\"},\\\"labels\\\":{\\\"version\\\":1,\\\"kind\\\":\\\"text\\\",\\\"value\\\":\\\"" + labels + "\\\"}}";
  if (out != R"BMEC(${expectedOutput})BMEC") { std::fprintf(stderr, "C++ output mismatch: %s\\n", out.c_str()); return false; }
  return true;
}
static bool transform_many(std::string_view json) { for (int i = 0; i < ${iterationsPerInvocation}; ++i) if (!transform(json, ${expectedTotal})) return false; return true; }
int main(int argc, char **argv) {
  if (argc != 3) return 2; char *end = nullptr; long long runs = std::strtoll(argv[1], &end, 10); if (!end || *end || runs < 1 || runs > 100000) return 2;
  std::ifstream file(argv[2], std::ios::binary); if (!file) return 2; const std::string json((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>()); if (json.empty()) return 2;
  const auto begin = std::chrono::steady_clock::now(); for (long long i = 0; i < runs; ++i) if (!transform_many(json)) return 1; const auto finish = std::chrono::steady_clock::now();
  std::printf("%.9f true\\n", std::chrono::duration<double, std::milli>(finish - begin).count()); return 0;
}`;
  writeFileSync(cppPath, cppSource, 'utf8');
  const compiler = process.env.BMEC_CC ?? (spawnSync('clang', ['--version'], { encoding: 'utf8' }).status === 0 ? 'clang' : 'gcc');
  const build = (exe, args) => {
    const start = performance.now(); const result = spawnSync(args[0], [...args.slice(1), '-o', exe], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`Compiler failed: ${result.stderr || result.error?.message || result.status}`);
    return Number((performance.now() - start).toFixed(3));
  };
  const nativeCompileMs = build(nativeExe, [compiler, '-O3', '-std=c11', cPath, '-lm']);
  const cppCompileMs = build(cppExe, ['g++', '-O3', '-std=c++17', cppPath]);
  let nativeLtoCompileMs, cppLtoCompileMs;
  if (includeLto) {
    nativeLtoCompileMs = build(nativeLtoExe, [compiler, '-O3', '-flto', '-std=c11', cPath, '-lm']);
    cppLtoCompileMs = build(cppLtoExe, ['g++', '-O3', '-flto', '-std=c++17', cppPath]);
  }
  const nativeRunFor = (exe, name) => runs => {
    const result = spawnSync(exe, [String(runs)], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`${name} failed: ${result.stderr || result.error?.message || result.status}`);
    const elapsed = Number(result.stdout.trim().split(/\s+/)[0]); if (!Number.isFinite(elapsed)) throw new Error(`Invalid native timing: ${result.stdout}`); return elapsed;
  };
  const cppRunFor = (exe, name) => runs => {
    const result = spawnSync(exe, [String(runs), inputPath], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`${name} failed: ${result.stderr || result.error?.message || result.status}`);
    const elapsed = Number(result.stdout.trim().split(/\s+/)[0]); if (!Number.isFinite(elapsed)) throw new Error(`Invalid C++ timing: ${result.stdout}`); return elapsed;
  };
  const nativeRun = nativeRunFor(nativeExe, 'BMEC native');
  const cppRun = cppRunFor(cppExe, 'C++');
  const nativeLtoRun = includeLto ? nativeRunFor(nativeLtoExe, 'BMEC native LTO') : undefined;
  const cppLtoRun = includeLto ? cppRunFor(cppLtoExe, 'C++ LTO') : undefined;
  const referenceRun = () => executeValue(compiled.ir.functions, 'main', []);
  const nodeRun = () => {
    for (let i = 0; i < iterationsPerInvocation; ++i) {
      const wire = JSON.parse(payload);
      if (wire.version !== 1 || wire.kind !== 'record' || wire.type?.name !== 'Sample' || !wire.type.symbol) return false;
      const fields = wire.fields;
      if (Object.keys(fields).length !== 6 || fields.count?.kind !== 'integer' || fields.ratio?.kind !== 'number' || fields.enabled?.kind !== 'boolean' || fields.values?.kind !== 'list' || fields.values.items.length !== itemCount || fields.label?.kind !== 'text' || fields.labels?.kind !== 'list' || fields.labels.items.length !== 2 || fields.labels.items.some(item => item.kind !== 'text')) return false;
      let total = BigInt(fields.count.value);
      for (const item of fields.values.items) { if (item.kind !== 'integer' || typeof item.value !== 'string') return false; total += BigInt(item.value); }
      const output = JSON.stringify({ count: { version: 1, kind: 'integer', value: String(Number(fields.count.value) + 1) }, ratioDoubledIs2_5: { version: 1, kind: 'boolean', value: Number(fields.ratio.value) * 2 === 2.5 }, enabled: { version: 1, kind: 'boolean', value: !fields.enabled.value }, total: { version: 1, kind: 'integer', value: String(total) }, label: { version: 1, kind: 'text', value: fields.label.value + '!' }, labels: { version: 1, kind: 'text', value: fields.labels.items.map(item => item.value).join('|') + '!' } });
      if (output !== expectedOutput) return false;
    }
    return true;
  };
  function summarize(times, runs) {
    const sorted = [...times].sort((a, b) => a - b); const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
    const variance = times.reduce((sum, value) => sum + (value - mean) ** 2, 0) / times.length; const medianMs = sorted[Math.floor(sorted.length / 2)];
    return { samples: times.length, warmups, runsPerSample: runs, transformsPerInvocation: iterationsPerInvocation, totalTransformsPerSample: runs * iterationsPerInvocation, targetSampleMs: targetMs, minMs: sorted[0], medianMs, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], maxMs: sorted.at(-1), coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)), nsPerTransform: Number((medianMs * 1e6 / (runs * iterationsPerInvocation)).toFixed(2)) };
  }
  const calibrate = (fn, name) => {
    let runs = 1; let elapsed = fn(runs);
    while (elapsed < targetMs && runs < 65536) { runs *= 2; elapsed = fn(runs); }
    if (elapsed < targetMs) throw new Error(`${name} could not reach ${targetMs} ms`);
    return runs;
  };
  const referenceBatch = runs => { const start = performance.now(); for (let i = 0; i < runs; ++i) if (referenceRun() !== true) throw new Error('BMEC reference transform failed'); return performance.now() - start; };
  const nodeBatch = runs => { const start = performance.now(); for (let i = 0; i < runs; ++i) if (!nodeRun()) throw new Error('Node transform failed'); return performance.now() - start; };
  const referenceRuns = calibrate(referenceBatch, 'BMEC reference'); const nodeRuns = calibrate(nodeBatch, 'Node'); const nativeRuns = calibrate(nativeRun, 'BMEC native'); const cppRuns = calibrate(cppRun, 'C++');
  const nativeLtoRuns = includeLto ? calibrate(nativeLtoRun, 'BMEC native LTO') : undefined;
  const cppLtoRuns = includeLto ? calibrate(cppLtoRun, 'C++ LTO') : undefined;
  const measureJs = (fn, runs) => { for (let i = 0; i < warmups; ++i) fn(runs); const times = []; for (let i = 0; i < samples; ++i) times.push(fn(runs)); return summarize(times, runs); };
  for (let i = 0; i < warmups; ++i) { referenceBatch(referenceRuns); nodeBatch(nodeRuns); nativeRun(nativeRuns); cppRun(cppRuns); if (includeLto) { nativeLtoRun(nativeLtoRuns); cppLtoRun(cppLtoRuns); } }
  const referenceTimes = [], nativeTimes = [], cppTimes = [], nativeLtoTimes = [], cppLtoTimes = [];
  for (let i = 0; i < samples; ++i) { referenceTimes.push(referenceBatch(referenceRuns)); nativeTimes.push(nativeRun(nativeRuns)); cppTimes.push(cppRun(cppRuns)); if (includeLto) { nativeLtoTimes.push(nativeLtoRun(nativeLtoRuns)); cppLtoTimes.push(cppLtoRun(cppLtoRuns)); } }
  if (!nodeRun() || referenceRun() !== true) throw new Error('Final differential confirmation failed');
  const reference = summarize(referenceTimes, referenceRuns); const node = measureJs(nodeBatch, nodeRuns); const native = summarize(nativeTimes, nativeRuns); const cpp = summarize(cppTimes, cppRuns);
  const nativeLto = includeLto ? summarize(nativeLtoTimes, nativeLtoRuns) : undefined;
  const cppLto = includeLto ? summarize(cppLtoTimes, cppLtoRuns) : undefined;
  const peakRssKiB = {};
  const memoryRuns = [['native', nativeExe, [String(nativeRuns)]], ['cpp', cppExe, [String(cppRuns), inputPath]]];
  if (includeLto) memoryRuns.push(['nativeLto', nativeLtoExe, [String(nativeLtoRuns)]], ['cppLto', cppLtoExe, [String(cppLtoRuns), inputPath]]);
  for (const [name, exe, args] of memoryRuns) {
    const timed = spawnSync('/usr/bin/time', ['-f', 'BMEC_MAX_RSS_KIB=%M', exe, ...args], { encoding: 'utf8', windowsHide: true });
    if (timed.error || timed.status !== 0) throw new Error(`${name} memory run failed: ${timed.stderr || timed.error?.message || timed.status}`);
    const rss = Number(/BMEC_MAX_RSS_KIB=(\d+)/.exec(timed.stderr)?.[1]); if (!Number.isFinite(rss)) throw new Error(`${name} peak RSS was unavailable`); peakRssKiB[name] = rss;
  }
  const inputSha256 = createHash('sha256').update(payload).digest('hex'); const outputSha256 = createHash('sha256').update(expectedOutput).digest('hex');
  const startup = { native: [], cpp: [], nativeLto: [], cppLto: [] };
  for (let i = 0; i < 7; ++i) { let start = performance.now(); nativeRun(1); startup.native.push(performance.now() - start); start = performance.now(); cppRun(1); startup.cpp.push(performance.now() - start); if (includeLto) { start = performance.now(); nativeLtoRun(1); startup.nativeLto.push(performance.now() - start); start = performance.now(); cppLtoRun(1); startup.cppLto.push(performance.now() - start); } }
  const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const goProbe = spawnSync('go', ['version'], { encoding: 'utf8', windowsHide: true });
  const result = {
    version: 1, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), workload: 'decode canonical mixed integer/number/boolean/text record, integer list, and UTF-8 text list; sum integers, join text, and serialize transformed fields',
    platform: `${process.platform} ${process.arch}`, cpu: cpus()[0]?.model ?? 'unknown', node: process.version, itemCount, inputBytes: Buffer.byteLength(payload), inputSha256, outputSha256, expectedTotal: String(expectedTotal), samples: { reference, native, node, cpp },
    compilers: { native: { compiler, version: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c11', '-lm'], compileMs: nativeCompileMs }, cpp: { compiler: 'g++', version: execFileSync('g++', ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c++17'], compileMs: cppCompileMs } },
    executableBytes: { native: statSync(nativeExe).size, cpp: statSync(cppExe).size, ...(includeLto ? { nativeLto: statSync(nativeLtoExe).size, cppLto: statSync(cppLtoExe).size } : {}) }, peakRssKiB: { ...peakRssKiB, reference: 'not isolated', node: 'not isolated' }, processLaunchPlusOneTransformMedianMs: { native: Number(median(startup.native).toFixed(3)), cpp: Number(median(startup.cpp).toFixed(3)), ...(includeLto ? { nativeLto: Number(median(startup.nativeLto).toFixed(3)), cppLto: Number(median(startup.cppLto).toFixed(3)) } : {}) }, ratios: { nativeOverCpp: Number((native.nsPerTransform / cpp.nsPerTransform).toFixed(3)), nativeOverNode: Number((native.nsPerTransform / node.nsPerTransform).toFixed(3)), nativeOverReference: Number((native.nsPerTransform / reference.nsPerTransform).toFixed(3)) },
    ...(includeLto ? { lto: { samples: { native: nativeLto, cpp: cppLto }, compilers: { native: { flags: ['-O3', '-flto', '-std=c11', '-lm'], compileMs: nativeLtoCompileMs }, cpp: { flags: ['-O3', '-flto', '-std=c++17'], compileMs: cppLtoCompileMs } }, peakRssKiB: { native: peakRssKiB.nativeLto, cpp: peakRssKiB.cppLto }, processLaunchPlusOneTransformMedianMs: { native: Number(median(startup.nativeLto).toFixed(3)), cpp: Number(median(startup.cppLto).toFixed(3)) }, ratios: { nativeLtoOverNative: Number((nativeLto.nsPerTransform / native.nsPerTransform).toFixed(3)), cppLtoOverCpp: Number((cppLto.nsPerTransform / cpp.nsPerTransform).toFixed(3)), nativeLtoOverCppLto: Number((nativeLto.nsPerTransform / cppLto.nsPerTransform).toFixed(3)) } } } : {}),
    go: goProbe.status === 0 ? { available: true, version: (goProbe.stdout || goProbe.stderr).trim() } : { available: false, reason: 'Go toolchain not installed in the Linux benchmark environment; no Go timing collected.' },
  };
  const suffix = `${itemCount === 128 ? '' : `-${itemCount}`}${includeLto ? '-lto' : ''}`;
  writeFileSync(evidenceOutput ? resolve(evidenceOutput) : join(root, 'docs', 'evidence', 'bmec-0.5-json-transform' + suffix + '-linux.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally { if (process.env.BMEC_JSON_TRANSFORM_KEEP === '1') console.log('Kept benchmark artifacts in ' + work); else rmSync(work, { recursive: true, force: true }); }
