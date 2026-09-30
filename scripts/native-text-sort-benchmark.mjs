#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../dist/compiler.js';
import { compileNativeSource, resolveNativeCompiler } from '../dist/native/build.js';
import { executeAsyncValue, publicValue } from '../dist/core/interpreter.js';
import { issueCapability } from '../dist/runtime/capabilities.js';
import { lowerNativeC } from '../dist/native/codegen.js';

const rootProject = resolve(fileURLToPath(new URL('../', import.meta.url)));
const samples = Number(process.env.BMEC_SORT_SAMPLES ?? 9);
const warmups = Number(process.env.BMEC_SORT_WARMUPS ?? 2);
const targetMs = Number(process.env.BMEC_SORT_TARGET_MS ?? 75);
const lines = Number(process.env.BMEC_SORT_LINES ?? 10000);
const prefixPadding = Number(process.env.BMEC_SORT_PREFIX_PADDING ?? 0);
if (!Number.isSafeInteger(lines) || lines < 2 || lines > 1_000_000) throw new Error('BMEC_SORT_LINES must be an integer from 2 through 1000000');
if (!Number.isSafeInteger(prefixPadding) || prefixPadding < 0 || prefixPadding > 100_000) throw new Error('BMEC_SORT_PREFIX_PADDING must be an integer from 0 through 100000');
const dataset = process.env.BMEC_SORT_DATASET ?? 'ascii';
if (!['ascii', 'unicode', 'unicode-full'].includes(dataset)) throw new Error('BMEC_SORT_DATASET must be ascii, unicode, or unicode-full');
const algorithm = process.env.BMEC_SORT_ALGORITHM ?? 'qsort';
if (!['qsort', 'merge', 'heap', 'adaptive'].includes(algorithm)) throw new Error('BMEC_SORT_ALGORITHM must be qsort, merge, heap, or adaptive');
const adaptiveThresholdBytes = Number(process.env.BMEC_SORT_ADAPTIVE_THRESHOLD_BYTES ?? 3_500_000);
if (!Number.isSafeInteger(adaptiveThresholdBytes) || adaptiveThresholdBytes < 0) throw new Error('BMEC_SORT_ADAPTIVE_THRESHOLD_BYTES must be a nonnegative integer');
const inputName = 'lines.txt';
const outputName = 'sorted.txt';
const frontendStart = performance.now();
const compiled = compileFile(join(rootProject, 'examples', 'text-sort', 'main.bmec'));
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));
const frontendMs = performance.now() - frontendStart;
const work = mkdtempSync(join(tmpdir(), 'bmec-text-sort-bench-'));
const root = join(work, 'root');
mkdirSync(root);
const unicodeMarkers = ['ASCII', 'café', 'Ωmega', '中間', '\uD7FF', '😀', '𐀀'];
const fullUnicodeMarkers = ['ASCII', 'café', 'Ωmega', '中間', '\uD7FF', '\uE000', '\uFFFF', '😀', '𐀀', '😁', '\u{10FFFF}'];
const markers = dataset === 'unicode-full' ? fullUnicodeMarkers : unicodeMarkers;
const commonPrefix = `${dataset === 'ascii' ? 'item-' : 'compare-'}${'x'.repeat(prefixPadding)}`;
const inputText = Array.from({ length: lines }, (_, index) => dataset === 'ascii'
  ? `${commonPrefix}${String((index * 7919) % lines).padStart(8, '0')}`
  : `${commonPrefix}${markers[index % markers.length]}-${String(Math.floor(index / markers.length)).padStart(8, '0')}`,
).join('\n');
writeFileSync(join(root, inputName), inputText, 'utf8');

const digest = () => createHash('sha256').update(readFileSync(join(root, outputName))).digest('hex');
const reference = async () => publicValue(await executeAsyncValue(
  compiled.ir.functions, 'sortFile', [issueCapability('filesystem'), inputName, outputName], { filesystemRoot: root, maxSteps: 100_000 },
));
const nodeTransform = () => {
  writeFileSync(join(root, outputName), readFileSync(join(root, inputName), 'utf8').split('\n').sort().join('\n'), 'utf8');
  return { state: 'ok', value: true };
};
const entry = compiled.ir.functions.find(fn => fn.name === 'sortFile');
if (!entry || entry.returnTypeRef.kind !== 'result') throw new Error('Unexpected native text-sort entry ABI');
const entryC = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const loweringStart = performance.now();
let c = lowerNativeC(compiled.ir, 'sortFile').replace('#include <string.h>', '#include <string.h>\n#include <time.h>\n#if defined(_WIN32) && defined(BMEC_SORT_REPORT_PEAK_WORKING_SET)\n#include <windows.h>\n#ifndef PSAPI_VERSION\n#define PSAPI_VERSION 2\n#endif\n#include <psapi.h>\n#pragma comment(lib, "Psapi.lib")\n#endif');
if (algorithm === 'merge' || algorithm === 'adaptive') {
  const sortDefinition = 'static bmec_text_list bmec_text_sort(bmec_text_list input) {';
  const mergeSort = 'static void bmec_text_merge_sort(bmec_text *items, size_t count) { if (count < 2) return; if (count > SIZE_MAX / sizeof(bmec_text)) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded"); bmec_text *scratch = (bmec_text *)bmec_arena_alloc(count * sizeof(bmec_text)); bmec_text *source = items, *target = scratch; for (size_t width = 1; width < count;) { for (size_t base = 0; base < count;) { size_t middle = base + (width < count - base ? width : count - base); size_t end = middle + (width < count - middle ? width : count - middle); size_t left = base, right = middle, out = base; while (left < middle && right < end) target[out++] = bmec_text_compare_utf16(source[left], source[right]) <= 0 ? source[left++] : source[right++]; while (left < middle) target[out++] = source[left++]; while (right < end) target[out++] = source[right++]; base = end; } bmec_text *temporary = source; source = target; target = temporary; if (width >= count - width) break; width *= 2; } if (source != items) memcpy(items, source, count * sizeof(bmec_text)); }\n';
  if (!c.includes(sortDefinition) || !c.includes('qsort(items, input.length, sizeof(bmec_text), bmec_text_qsort_compare);')) throw new Error('Could not locate generated qsort implementation');
  if (algorithm === 'adaptive') {
    const adaptiveSort = `static void bmec_text_adaptive_sort(bmec_text *items, size_t count) { size_t total_bytes = 0; for (size_t i = 0; i < count; ++i) { if (items[i].length > SIZE_MAX - total_bytes) { total_bytes = SIZE_MAX; break; } total_bytes += items[i].length; } if (total_bytes <= ${adaptiveThresholdBytes}u) bmec_text_merge_sort(items, count); else qsort(items, count, sizeof(bmec_text), bmec_text_qsort_compare); }\n`;
    c = c.replace(sortDefinition, `${mergeSort}${adaptiveSort}${sortDefinition}`).replace('qsort(items, input.length, sizeof(bmec_text), bmec_text_qsort_compare);', 'bmec_text_adaptive_sort(items, input.length);');
  } else c = c.replace(sortDefinition, `${mergeSort}${sortDefinition}`).replace('qsort(items, input.length, sizeof(bmec_text), bmec_text_qsort_compare);', 'bmec_text_merge_sort(items, input.length);');
} else if (algorithm === 'heap') {
  const sortDefinition = 'static bmec_text_list bmec_text_sort(bmec_text_list input) {';
  const heapSort = 'static void bmec_text_heap_sift(bmec_text *items, size_t root, size_t count) { for (;;) { size_t child = root * 2 + 1; if (child >= count) return; if (child + 1 < count && bmec_text_compare_utf16(items[child], items[child + 1]) < 0) ++child; if (bmec_text_compare_utf16(items[root], items[child]) >= 0) return; bmec_text temporary = items[root]; items[root] = items[child]; items[child] = temporary; root = child; } } static void bmec_text_heap_sort(bmec_text *items, size_t count) { for (size_t start = count / 2; start > 0;) bmec_text_heap_sift(items, --start, count); for (size_t end = count; end > 1;) { --end; bmec_text temporary = items[0]; items[0] = items[end]; items[end] = temporary; bmec_text_heap_sift(items, 0, end); } }\n';
  if (!c.includes(sortDefinition) || !c.includes('qsort(items, input.length, sizeof(bmec_text), bmec_text_qsort_compare);')) throw new Error('Could not locate generated qsort implementation');
  c = c.replace(sortDefinition, `${heapSort}${sortDefinition}`).replace('qsort(items, input.length, sizeof(bmec_text), bmec_text_qsort_compare);', 'bmec_text_heap_sort(items, input.length);');
}
const loweringMs = performance.now() - loweringStart;
const prototype = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${entryC}\\(`, 'm').exec(c);
if (!prototype) throw new Error('Native text-sort entry prototype was not found');
const resultType = prototype[1];
const mainStart = c.lastIndexOf('#if defined(_WIN32)\nint wmain(');
if (mainStart < 0) throw new Error('Generated native main wrapper was not found');
const entryCall = `${entryC}((bmec_filesystem){ bmec_fs_root_fd }, (bmec_text){ (const unsigned char *)${JSON.stringify(inputName)}, sizeof(${JSON.stringify(inputName)}) - 1 }, (bmec_text){ (const unsigned char *)${JSON.stringify(outputName)}, sizeof(${JSON.stringify(outputName)}) - 1 })`;
const wrapper = `#if defined(_WIN32)
int wmain(int argc, wchar_t **argv) {
#else
int main(int argc, char **argv) {
#endif
  if (argc != 5) return 2;
#if defined(_WIN32)
  wchar_t *wide_end = NULL; int64_t runs = _wcstoi64(argv[4], &wide_end, 10);
  if (!wide_end || *wide_end || runs < 1 || runs > 100000) return 2;
  if (bmec_fs_init_root(argv[1]) != 0) return 66;
  LARGE_INTEGER frequency, begin, finish;
  if (!QueryPerformanceFrequency(&frequency) || !QueryPerformanceCounter(&begin)) { bmec_fs_close_root(); return 70; }
#else
  char *end = NULL; int64_t runs = strtoll(argv[4], &end, 10);
  if (!end || *end || runs < 1 || runs > 100000) return 2;
  if (bmec_fs_init_root(argv[1]) != 0) return 66;
  struct timespec begin, finish;
#endif
  ${resultType} result = {0};
#if !defined(_WIN32)
  if (clock_gettime(CLOCK_MONOTONIC, &begin) != 0) { bmec_fs_close_root(); return 70; }
#endif
  for (int64_t i = 0; i < runs; ++i) { bmec_arena_release(); bmec_steps = 0; bmec_depth = 0; result = ${entryCall}; if (!result.is_ok || !result.payload.ok) return 1; }
#if defined(_WIN32)
  if (!QueryPerformanceCounter(&finish)) { bmec_fs_close_root(); bmec_arena_release(); return 70; }
  const double elapsed = (double)(finish.QuadPart - begin.QuadPart) * 1000.0 / (double)frequency.QuadPart;
#else
  if (clock_gettime(CLOCK_MONOTONIC, &finish) != 0) { bmec_fs_close_root(); bmec_arena_release(); return 70; }
  const double elapsed = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0;
#endif
  bmec_fs_close_root();
#if defined(_WIN32) && defined(BMEC_SORT_REPORT_PEAK_WORKING_SET)
  PROCESS_MEMORY_COUNTERS counters = {0}; counters.cb = sizeof(counters);
  if (!GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters))) { bmec_arena_release(); return 71; }
  printf("%.9f true %llu\\n", elapsed, (unsigned long long)counters.PeakWorkingSetSize);
#else
  printf("%.9f true\\n", elapsed);
#endif
  bmec_arena_release(); return 0;
}
`;
const cSource = join(work, 'text-sort.native.c');
writeFileSync(cSource, `${c.slice(0, mainStart)}${wrapper}`, 'utf8');
const toolchain = resolveNativeCompiler();
const compiler = toolchain.path;
function resolveCxxToolchain(cCompiler) {
  if (process.platform === 'win32') return cCompiler;
  const derived = cCompiler.path.replace(/clang(?=($|[-\\/]))/, 'clang++').replace(/gcc(?=($|[-\\/]))/, 'g++');
  for (const candidate of [...new Set([process.env.BMEC_CXX, derived, 'g++', 'clang++', 'c++'].filter(Boolean))]) {
    try { return resolveNativeCompiler(candidate); } catch { /* Try the next installed C++ compiler. */ }
  }
  throw new Error('No C++ compiler found for the text-sort comparison. Set BMEC_CXX or install g++/clang++.');
}
const cxxToolchain = resolveCxxToolchain(toolchain);
const executableSuffix = process.platform === 'win32' ? '.exe' : '';
const nativeExe = join(work, `text-sort-native${executableSuffix}`);
const cxxExe = join(work, `text-sort-cpp${executableSuffix}`);
function compile(exe, sourcePath, language, compiler, extraFlags = []) {
  const start = performance.now();
  const flags = compileNativeSource(compiler, sourcePath, exe, language, extraFlags);
  const result = spawnSync(compiler.path, flags, { encoding: 'utf8', windowsHide: true, cwd: work, env: compiler.env });
  if (result.error || result.status !== 0) throw new Error(`Compiler failed: ${result.stderr || result.error?.message || result.status}`);
  return { ms: Number((performance.now() - start).toFixed(3)), flags };
}
const nativeCompile = compile(nativeExe, cSource, 'c', toolchain);
const cppSource = join(rootProject, 'benchmarks', 'native', 'text-sort.cpp');
const cppOrderingFlag = toolchain.kind === 'msvc' ? '/DBMEC_UTF16_ORDERING' : '-DBMEC_UTF16_ORDERING';
const cppMemoryFlag = toolchain.kind === 'msvc' ? '/DBMEC_SORT_REPORT_PEAK_WORKING_SET' : '-DBMEC_SORT_REPORT_PEAK_WORKING_SET';
const cppCompile = compile(cxxExe, cppSource, 'c++', cxxToolchain, dataset === 'unicode-full' ? [cppOrderingFlag] : []);
const nativeCompileMs = nativeCompile.ms, cppCompileMs = cppCompile.ms;
const invoke = exe => runs => {
  const result = spawnSync(exe, [root, inputName, outputName, String(runs)], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${exe} failed: ${result.stderr || result.error?.message || result.status}`);
  const elapsed = Number(result.stdout.trim().split(/\s+/)[0]);
  if (!Number.isFinite(elapsed)) throw new Error(`${exe} returned invalid timing: ${result.stdout}`);
  return elapsed;
};
const nativeRun = invoke(nativeExe), cppRun = invoke(cxxExe);
let runs = 1, calibration = nativeRun(runs);
while (calibration < targetMs && runs < 1024) { runs *= 2; calibration = nativeRun(runs); }
if (calibration < targetMs) throw new Error(`Native calibration could not reach ${targetMs} ms`);
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  return { samples: values.length, warmups, runsPerSample: runs, targetSampleMs: targetMs, minMs: sorted[0], medianMs, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], maxMs: sorted.at(-1), coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)), nsPerLine: Number((medianMs * 1e6 / (runs * lines)).toFixed(2)) };
};
async function measureAsync(fn) {
  for (let i = 0; i < warmups; ++i) for (let j = 0; j < runs; ++j) await fn();
  const times = [];
  for (let i = 0; i < samples; ++i) {
    const start = performance.now();
    for (let j = 0; j < runs; ++j) { const result = await fn(); if (result?.state !== 'ok' || result.value !== true) throw new Error(`BMEC reference failed: ${JSON.stringify(result)}`); }
    times.push(performance.now() - start);
  }
  return stats(times);
}
function measureProcess(fn) {
  for (let i = 0; i < warmups; ++i) fn(runs);
  return stats(Array.from({ length: samples }, () => fn(runs)));
}
function measureMemory(executable, label) {
  if (process.platform === 'win32') {
    const measured = spawnSync(executable, [root, inputName, outputName, String(runs)], { encoding: 'utf8', windowsHide: true });
    if (measured.error || measured.status !== 0) throw new Error(`${label} memory run failed: ${measured.stderr || measured.error?.message || measured.status}`);
    const [elapsed, success, peakWorkingSetBytes] = measured.stdout.trim().split(/\s+/);
    if (success !== 'true' || !Number.isFinite(Number(elapsed)) || !Number.isFinite(Number(peakWorkingSetBytes))) throw new Error(`${label} peak working set was not reported: ${measured.stdout}`);
    return { peakWorkingSetBytes: Number(peakWorkingSetBytes), peakWorkingSetKiB: Number((Number(peakWorkingSetBytes) / 1024).toFixed(2)) };
  }
  const timed = spawnSync('/usr/bin/time', ['-f', 'BMEC_MAX_RSS_KIB=%M', executable, root, inputName, outputName, String(runs)], { encoding: 'utf8', windowsHide: true });
  if (timed.error || timed.status !== 0) throw new Error(`${label} memory run failed: ${timed.stderr || timed.error?.message || timed.status}`);
  const peakRssKiB = Number(/BMEC_MAX_RSS_KIB=(\d+)/.exec(timed.stderr)?.[1]);
  if (!Number.isFinite(peakRssKiB)) throw new Error(`${label} peak RSS was not reported`);
  return { peakRssKiB };
}
try {
  const referenceResult = await measureAsync(reference);
  const nodeResult = await measureAsync(async () => nodeTransform());
  const nativeResult = measureProcess(nativeRun);
  const cppResult = measureProcess(cppRun);
  const nativeMemoryExe = join(work, `text-sort-native-memory${executableSuffix}`);
  const nativeMemoryFlag = toolchain.kind === 'msvc' ? '/DBMEC_SORT_REPORT_PEAK_WORKING_SET' : '-DBMEC_SORT_REPORT_PEAK_WORKING_SET';
  const nativeMemoryCompile = compile(nativeMemoryExe, cSource, 'c', toolchain, process.platform === 'win32' ? [nativeMemoryFlag] : []);
  const cppMemoryExe = join(work, `text-sort-cpp-memory${executableSuffix}`);
  const cppMemoryCompile = compile(cppMemoryExe, cppSource, 'c++', cxxToolchain, process.platform === 'win32' ? [cppMemoryFlag] : []);
  const nativeMemory = measureMemory(process.platform === 'win32' ? nativeMemoryExe : nativeExe, 'BMEC native');
  const cppMemory = measureMemory(process.platform === 'win32' ? cppMemoryExe : cxxExe, 'C++');
  const startupSamples = { native: [], cpp: [] };
  for (let i = 0; i < 7; ++i) {
    let start = performance.now(); nativeRun(1); startupSamples.native.push(performance.now() - start);
    start = performance.now(); cppRun(1); startupSamples.cpp.push(performance.now() - start);
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const hashes = { reference: digest(), native: digest(), node: digest(), cpp: digest() };
  if (new Set(Object.values(hashes)).size !== 1) throw new Error(`Output hashes differ: ${JSON.stringify(hashes)}`);
  let profile;
  if (process.env.BMEC_SORT_PROFILE === '1') {
    if (process.platform !== 'linux') throw new Error('The gprof profile mode is available on Linux only.');
    const profileRuns = Number(process.env.BMEC_SORT_PROFILE_RUNS ?? 64);
    if (!Number.isSafeInteger(profileRuns) || profileRuns < 1 || profileRuns > 100_000) throw new Error('BMEC_SORT_PROFILE_RUNS must be an integer from 1 through 100000');
    const profileExe = join(work, 'text-sort-native-profile');
    const profileCompile = spawnSync(compiler, ['-O3', '-pg', '-std=c11', cSource, '-lm', '-o', profileExe], { encoding: 'utf8', windowsHide: true, cwd: work });
    if (profileCompile.error || profileCompile.status !== 0) throw new Error(`Native profile build failed: ${profileCompile.stderr || profileCompile.error?.message || profileCompile.status}`);
    const profileRun = spawnSync(profileExe, [root, inputName, outputName, String(profileRuns)], { cwd: work, encoding: 'utf8', windowsHide: true });
    if (profileRun.error || profileRun.status !== 0 || digest() !== hashes.reference) throw new Error(`Profiled native output mismatch: ${profileRun.stderr || profileRun.stdout || profileRun.status}`);
    profile = {
      runs: profileRuns,
      compilerFlags: ['-O3', '-pg', '-std=c11', '-lm'],
      tool: execFileSync('gprof', ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(),
      flatProfile: execFileSync('gprof', ['-b', '-p', profileExe, join(work, 'gmon.out')], { encoding: 'utf8' }),
    };
    const profilePath = resolve(process.env.BMEC_SORT_PROFILE_OUTPUT ?? join(rootProject, 'docs', 'evidence', `bmec-0.5-text-sort-profile-${dataset}-linux.json`));
    mkdirSync(dirname(profilePath), { recursive: true });
    writeFileSync(profilePath, `${JSON.stringify({ version: 1, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootProject, encoding: 'utf8' }).trim(), platform: `${process.platform} ${process.arch}`, cpu: cpus()[0]?.model ?? 'unknown', lines, dataset, inputBytes: statSync(join(root, inputName)).size, outputSha256: hashes.reference, profile }, null, 2)}\n`, 'utf8');
  }
  const evidence = {
    version: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootProject, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    node: process.version,
    lines,
    prefixPadding,
    dataset,
    algorithm,
    adaptiveThresholdBytes: algorithm === 'adaptive' ? adaptiveThresholdBytes : undefined,
    unicodeOrderingNote: dataset === 'unicode' ? 'This selected Unicode set excludes BMP code points U+E000..U+FFFF. The C++ comparator implements BMEC UTF-16 ordering; native differential fixtures cover the ordering inversion.' : dataset === 'unicode-full' ? 'This set includes BMP private-use and maximum-plane characters. C++ uses a scalar decoder that compares in BMEC UTF-16 code-unit order, matching native BMEC and JavaScript string ordering.' : undefined,
    cppOrdering: dataset === 'unicode-full'
      ? 'ASCII-prefix fast path and Unicode scalar decoder with BMEC UTF-16 code-unit ordering'
      : 'std::string byte ordering, equivalent to BMEC UTF-16 order for this dataset',
    inputBytes: statSync(join(root, inputName)).size,
    outputBytes: statSync(join(root, outputName)).size,
    outputSha256: hashes.reference,
    samples: { reference: referenceResult, native: nativeResult, node: nodeResult, cpp: cppResult },
    profile,
    compilers: { native: { compiler: toolchain.path, version: toolchain.version, flags: nativeCompile.flags, compileMs: nativeCompileMs, memoryFlags: process.platform === 'win32' ? nativeMemoryCompile.flags : undefined }, cpp: { compiler: cxxToolchain.path, version: cxxToolchain.version, flags: cppCompile.flags, compileMs: cppCompileMs, memoryFlags: process.platform === 'win32' ? cppMemoryCompile.flags : undefined } },
    buildPipelineMs: { bmecFrontendAndIR: Number(frontendMs.toFixed(3)), nativeLoweringAndCGeneration: Number(loweringMs.toFixed(3)), nativeCCompilation: nativeCompileMs, cppCompilation: cppCompileMs },
    executableBytes: { native: statSync(nativeExe).size, cpp: statSync(cxxExe).size },
    memory: { native: nativeMemory, cpp: cppMemory, reference: 'not isolated', node: 'not isolated' },
    processLaunchPlusOneTransformMedianMs: { native: Number(median(startupSamples.native).toFixed(3)), cpp: Number(median(startupSamples.cpp).toFixed(3)) },
    ratios: { nativeOverCpp: Number((nativeResult.medianMs / cppResult.medianMs).toFixed(3)), nativeOverNode: Number((nativeResult.medianMs / nodeResult.medianMs).toFixed(3)), nativeOverReference: Number((nativeResult.medianMs / referenceResult.medianMs).toFixed(3)) },
    warmups,
    targetMs,
  };
  const sizeSuffix = lines === 10000 && prefixPadding === 0 ? '' : `-n${lines}-p${prefixPadding}`;
  const platformSuffix = process.platform === 'win32' ? 'windows' : 'linux';
  const evidenceFile = process.env.BMEC_SORT_OUTPUT ?? (algorithm === 'qsort'
    ? (dataset === 'ascii' ? 'bmec-0.5-text-sort' : dataset === 'unicode' ? 'bmec-0.5-text-sort-unicode' : 'bmec-0.5-text-sort-unicode-full') + `${sizeSuffix}-${platformSuffix}.json`
    : `bmec-0.5-text-sort-${dataset}-${algorithm}${sizeSuffix}-${platformSuffix}.json`);
  writeFileSync(resolve(evidenceFile), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally { rmSync(work, { recursive: true, force: true }); }
