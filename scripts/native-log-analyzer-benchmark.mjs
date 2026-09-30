#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../dist/compiler.js';
import { compileNativeSource, resolveNativeCompiler } from '../dist/native/build.js';
import { executeAsyncValue, publicValue } from '../dist/core/interpreter.js';
import { issueCapability } from '../dist/runtime/capabilities.js';
import { lowerNativeC } from '../dist/native/codegen.js';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const samples = Number(process.env.BMEC_LOG_SAMPLES ?? 9);
const warmups = Number(process.env.BMEC_LOG_WARMUPS ?? 2);
const targetMs = Number(process.env.BMEC_LOG_TARGET_MS ?? 75);
const lines = Number(process.env.BMEC_LOG_LINES ?? 10000);
const evidenceOutput = process.env.BMEC_LOG_OUTPUT ?? join(projectRoot, 'docs', 'evidence', `bmec-0.5-log-analyzer-${process.platform === 'win32' ? 'windows' : 'linux'}.json`);
if (!Number.isSafeInteger(lines) || lines < 1 || lines > 1_000_000) throw new Error('BMEC_LOG_LINES must be from 1 through 1,000,000');
const inputName = 'events.log';
const outputName = 'summary.log';
const frontendStart = performance.now();
const fixture = compileFile(join(projectRoot, 'examples', 'log-analyzer', 'main.bmec'));
if (fixture.diagnostics.length) throw new Error(fixture.diagnostics.map(item => item.message).join('\n'));
const frontendCompileMs = performance.now() - frontendStart;

const work = mkdtempSync(join(tmpdir(), 'bmec-log-analyzer-bench-'));
const root = join(work, 'root');
const input = Array.from({ length: lines }, (_, index) => {
  const kind = index % 17 === 0 ? 'ERROR' : 'INFO';
  const user = index % 7 === 0 ? 'Мария' : 'worker';
  return `2026-09-23T09:12:${String(index % 60).padStart(2, '0')}Z ${kind} request=${index} duration=${index % 113}ms user=${user}`;
}).join('\n');
mkdirSync(root);
writeFileSync(join(root, inputName), input, 'utf8');
const inputBytes = statSync(join(root, inputName)).size;

const digestFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const nodeTransform = () => {
  const contents = readFileSync(join(root, inputName), 'utf8');
  const output = contents.split('\n').filter(line => line.includes('ERROR')).sort().join('\n');
  writeFileSync(join(root, outputName), output, 'utf8');
  return { state: 'ok', value: true };
};
const referenceTransform = async () => publicValue(await executeAsyncValue(
  fixture.ir.functions,
  'summarize',
  [issueCapability('filesystem'), inputName, outputName],
  { filesystemRoot: root, maxSteps: 100_000 },
));

function nativeBatchSource(ir) {
  const entry = ir.functions.find(fn => fn.name === 'summarize');
  if (!entry || entry.parameters.length !== 3 || entry.returnTypeRef.kind !== 'result') throw new Error('Unexpected Log Analyzer native ABI');
  const entryC = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const sourcePath = join(work, 'log-analyzer.native.c');
  const lowerStart = performance.now();
  let c = lowerNativeC(ir, 'summarize').replace('#include <string.h>', '#include <string.h>\n#include <time.h>\n#if defined(_WIN32) && defined(BMEC_NATIVE_REPORT_PEAK_WORKING_SET)\n#include <windows.h>\n#ifndef PSAPI_VERSION\n#define PSAPI_VERSION 2\n#endif\n#include <psapi.h>\n#endif');
  const loweringMs = performance.now() - lowerStart;
  const prototype = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) ${entryC}\\(`, 'm').exec(c);
  if (!prototype) throw new Error('Generated Log Analyzer entry prototype was not found');
  const resultType = prototype[1];
  const mainStart = c.lastIndexOf('#if defined(_WIN32)\nint wmain(');
  if (mainStart < 0) throw new Error('Generated native main wrapper was not found');
  const entryCall = `${entryC}((bmec_filesystem){ bmec_fs_root_fd }, (bmec_text){ (const unsigned char *)${JSON.stringify(inputName)}, sizeof(${JSON.stringify(inputName)}) - 1 }, (bmec_text){ (const unsigned char *)${JSON.stringify(outputName)}, sizeof(${JSON.stringify(outputName)}) - 1 })`;
  const main = `#if defined(_WIN32)
int wmain(int argc, wchar_t **argv) {
#else
int main(int argc, char **argv) {
#endif
  if (argc != 5) { fputs("usage: ROOT INPUT OUTPUT RUNS\\n", stderr); return 2; }
  int64_t runs = 0;
#if defined(_WIN32)
  wchar_t *wide_end = NULL; runs = _wcstoi64(argv[4], &wide_end, 10);
  if (!wide_end || *wide_end || runs < 1 || runs > 100000) return 2;
  if (bmec_fs_init_root(argv[1]) != 0) { fputs("native_filesystem_root_unavailable\\n", stderr); return 66; }
  LARGE_INTEGER frequency, begin, finish;
  if (!QueryPerformanceFrequency(&frequency) || !QueryPerformanceCounter(&begin)) { bmec_fs_close_root(); return 70; }
#else
  char *end = NULL; runs = strtoll(argv[4], &end, 10);
  if (!end || *end || runs < 1 || runs > 100000) return 2;
  if (bmec_fs_init_root(argv[1]) != 0) { fputs("native_filesystem_root_unavailable\\n", stderr); return 66; }
  struct timespec begin, finish;
  if (clock_gettime(CLOCK_MONOTONIC, &begin) != 0) { bmec_fs_close_root(); return 70; }
#endif
  ${resultType} result = {0};
  for (int64_t i = 0; i < runs; ++i) {
    bmec_arena_release(); bmec_steps = 0; bmec_depth = 0;
    result = ${entryCall};
    if (!result.is_ok) { fputs("native Result error: ", stderr); bmec_json_text(result.payload.error); fputc('\\n', stderr); bmec_fs_close_root(); bmec_arena_release(); return 1; }
  }
#if defined(_WIN32)
  if (!QueryPerformanceCounter(&finish)) { bmec_fs_close_root(); bmec_arena_release(); return 70; }
  const double elapsed_ms = (double)(finish.QuadPart - begin.QuadPart) * 1000.0 / (double)frequency.QuadPart;
#else
  if (clock_gettime(CLOCK_MONOTONIC, &finish) != 0) { bmec_fs_close_root(); bmec_arena_release(); return 70; }
  const double elapsed_ms = (finish.tv_sec - begin.tv_sec) * 1000.0 + (finish.tv_nsec - begin.tv_nsec) / 1000000.0;
#endif
  bmec_arena_report(); bmec_arena_release(); bmec_fs_close_root();
#if defined(_WIN32) && defined(BMEC_NATIVE_REPORT_PEAK_WORKING_SET)
  PROCESS_MEMORY_COUNTERS counters = {0}; counters.cb = sizeof(counters);
  if (!GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters))) { bmec_fs_close_root(); bmec_arena_release(); return 71; }
  printf("%.9f %s %llu\\n", elapsed_ms, result.payload.ok ? "true" : "false", (unsigned long long)counters.PeakWorkingSetSize);
#else
  printf("%.9f %s\\n", elapsed_ms, result.payload.ok ? "true" : "false");
#endif
  return result.payload.ok ? 0 : 1;
}
`;
  writeFileSync(sourcePath, `${c.slice(0, mainStart)}${main}`, 'utf8');
  return { sourcePath, loweringMs };
}

const toolchain = resolveNativeCompiler();
const nativeCompiler = toolchain.path;
function resolveCxxToolchain(cCompiler) {
  if (process.platform === 'win32') return cCompiler;
  const derived = cCompiler.path.replace(/clang(?=($|[-\\/]))/, 'clang++').replace(/gcc(?=($|[-\\/]))/, 'g++');
  for (const candidate of [...new Set([process.env.BMEC_CXX, derived, 'g++', 'clang++', 'c++'].filter(Boolean))]) {
    try { return resolveNativeCompiler(candidate); } catch { /* Try the next installed C++ compiler. */ }
  }
  throw new Error('No C++ compiler found for the Log Analyzer comparison. Set BMEC_CXX or install g++/clang++.');
}
const cxxToolchain = resolveCxxToolchain(toolchain);
const executableSuffix = process.platform === 'win32' ? '.exe' : '';
const cxxExe = join(work, `log-analyzer-cpp${executableSuffix}`);
const cxxSource = join(projectRoot, 'benchmarks', 'native', 'log-analyzer.cpp');
const cxxCompileStart = performance.now();
const cxxFlags = compileNativeSource(cxxToolchain, cxxSource, cxxExe, 'c++');
const cxxCompileMs = performance.now() - cxxCompileStart;
const cxxVersion = cxxToolchain.version;
const nativeGenerated = nativeBatchSource(fixture.ir);
const nativeSource = nativeGenerated.sourcePath;
const nativeExe = join(work, `log-analyzer-native${executableSuffix}`);
const nativeCompileStart = performance.now();
const nativeFlags = compileNativeSource(toolchain, nativeSource, nativeExe, 'c');
const nativeCompileMs = performance.now() - nativeCompileStart;
const nativeMemoryExe = join(work, `log-analyzer-native-memory${executableSuffix}`);
let nativeMemoryCompileMs = null;
const nativeMemoryBuildStart = performance.now();
const arenaMetricsFlag = toolchain.kind === 'msvc' ? '/DBMEC_NATIVE_ARENA_METRICS' : '-DBMEC_NATIVE_ARENA_METRICS';
const peakWorkingSetFlag = toolchain.kind === 'msvc' ? '/DBMEC_NATIVE_REPORT_PEAK_WORKING_SET' : '-DBMEC_NATIVE_REPORT_PEAK_WORKING_SET';
compileNativeSource(toolchain, nativeSource, nativeMemoryExe, 'c', [arenaMetricsFlag, ...(process.platform === 'win32' ? [peakWorkingSetFlag] : [])]);
nativeMemoryCompileMs = performance.now() - nativeMemoryBuildStart;
const cppMemoryExe = process.platform === 'win32' ? join(work, `log-analyzer-cpp-memory${executableSuffix}`) : null;
let cppMemoryCompileMs = null;
if (cppMemoryExe) {
  const cppMemorySource = readFileSync(cxxSource, 'utf8');
  const cppMemoryPath = join(work, `log-analyzer-cpp-memory${executableSuffix === '.exe' ? '.cpp' : '.cc'}`);
  writeFileSync(cppMemoryPath, cppMemorySource, 'utf8');
  const cppMemoryBuildStart = performance.now();
  compileNativeSource(cxxToolchain, cppMemoryPath, cppMemoryExe, 'c++', [peakWorkingSetFlag]);
  cppMemoryCompileMs = performance.now() - cppMemoryBuildStart;
}
const nativeVersion = toolchain.version;

function parseBatchOutput(result, name) {
  if (result.error || result.status !== 0) throw new Error(`${name} failed: ${result.stderr || result.error?.message || result.status}`);
  const [elapsed, value] = result.stdout.trim().split(/\s+/);
  if (value !== 'true' || !Number.isFinite(Number(elapsed))) throw new Error(`${name} returned invalid batch output: ${result.stdout}`);
  return Number(elapsed);
}
const invokeNative = runs => parseBatchOutput(spawnSync(nativeExe, [root, inputName, outputName, String(runs)], { encoding: 'utf8', windowsHide: true }), 'BMEC native');
const invokeCpp = runs => parseBatchOutput(spawnSync(cxxExe, [root, inputName, outputName, String(runs)], { encoding: 'utf8', windowsHide: true }), 'C++');

let runs = 1;
let nativeCalibrationMs = invokeNative(runs);
while (nativeCalibrationMs < targetMs && runs < 1024) {
  runs *= 2;
  nativeCalibrationMs = invokeNative(runs);
}
if (nativeCalibrationMs < targetMs) throw new Error(`Native calibration could not reach ${targetMs} ms within 1,024 runs`);

async function measureAsyncBatch(name, fn) {
  for (let i = 0; i < warmups; ++i)
    for (let j = 0; j < runs; ++j) await fn();
  const values = [];
  for (let i = 0; i < samples; ++i) {
    const start = performance.now();
    for (let j = 0; j < runs; ++j) {
      const value = await fn();
      if (value?.state !== 'ok' || value.value !== true) throw new Error(`${name} returned ${JSON.stringify(value)}`);
    }
    values.push(performance.now() - start);
  }
  return { ...summarize(values, runs * lines), outputSha256: digestFile(join(root, outputName)) };
}
function measureProcess(name, invoke) {
  for (let i = 0; i < warmups; ++i) invoke(runs);
  const values = [];
  for (let i = 0; i < samples; ++i) values.push(invoke(runs));
  return { ...summarize(values, runs * lines), outputSha256: digestFile(join(root, outputName)) };
}
function measureMemory(executable, args, name) {
  if (process.platform === 'win32') {
    const measured = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true });
    if (measured.error || measured.status !== 0) throw new Error(`${name} memory run failed: ${measured.stderr || measured.error?.message || measured.status}`);
    const [elapsed, success, peakWorkingSetBytes] = measured.stdout.trim().split(/\s+/);
    if (success !== 'true' || !Number.isFinite(Number(elapsed)) || !Number.isFinite(Number(peakWorkingSetBytes)))
      throw new Error(`${name} working-set run returned an invalid record: ${measured.stdout}`);
    const arena = /BMEC_NATIVE_ARENA_METRICS allocations=(\d+) allocated_bytes=(\d+) peak_bytes=(\d+)/.exec(measured.stderr);
    return {
      peakWorkingSetBytes: Number(peakWorkingSetBytes),
      peakWorkingSetKiB: Number((Number(peakWorkingSetBytes) / 1024).toFixed(2)),
      outputSha256: digestFile(join(root, outputName)),
      ...(arena ? { arena: { allocations: Number(arena[1]), allocatedBytes: Number(arena[2]), peakPayloadBytes: Number(arena[3]) } } : {}),
    };
  }
  const timed = spawnSync('/usr/bin/time', ['-f', 'BMEC_MAX_RSS_KIB=%M', executable, ...args], { encoding: 'utf8', windowsHide: true });
  if (timed.error || timed.status !== 0) throw new Error(`${name} memory run failed: ${timed.stderr || timed.error?.message || timed.status}`);
  const maxRssKiB = Number(/BMEC_MAX_RSS_KIB=(\d+)/.exec(timed.stderr)?.[1]);
  if (!Number.isFinite(maxRssKiB)) throw new Error(`${name} peak RSS was not reported by /usr/bin/time`);
  const arena = /BMEC_NATIVE_ARENA_METRICS allocations=(\d+) allocated_bytes=(\d+) peak_bytes=(\d+)/.exec(timed.stderr);
  return { peakRssKiB: maxRssKiB, outputSha256: digestFile(join(root, outputName)), ...(arena ? { arena: { allocations: Number(arena[1]), allocatedBytes: Number(arena[2]), peakPayloadBytes: Number(arena[3]) } } : {}) };
}
function summarize(values, operations) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    samples: values.length,
    warmups,
    runsPerSample: runs,
    targetSampleMs: targetMs,
    minMs: sorted[0],
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1),
    coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)),
    nsPerInputLine: Number((percentile(0.5) * 1e6 / operations).toFixed(2)),
    timing: 'elapsed processing batch; native and C++ clocks start inside their processes, reference and Node use performance.now',
  };
}

try {
  const reference = await measureAsyncBatch('BMEC reference', referenceTransform);
  const node = await measureAsyncBatch('Node', async () => nodeTransform());
  const native = measureProcess('BMEC native', invokeNative);
  const cpp = measureProcess('C++', invokeCpp);
  const nativeMemory = measureMemory(nativeMemoryExe, [root, inputName, outputName, String(runs)], 'BMEC native');
  const cppMemory = measureMemory(cppMemoryExe ?? cxxExe, [root, inputName, outputName, String(runs)], 'C++');
  const expectedDigest = digestFile(join(root, outputName));
  for (const [name, measurement] of Object.entries({ nativeMemory, cppMemory }))
    if (measurement.outputSha256 !== expectedDigest) throw new Error(`${name} output checksum differs from C++`);
  for (const [name, measurement] of Object.entries({ reference, native, node, cpp }))
    if (measurement.outputSha256 !== expectedDigest) throw new Error(`${name} output checksum differs from C++`);
  for (const [name, invoke] of [['reference', referenceTransform], ['Node', nodeTransform]]) {
    const value = await invoke();
    if (value?.state !== 'ok' || value.value !== true) throw new Error(`${name} final result differs`);
    if (digestFile(join(root, outputName)) !== expectedDigest) throw new Error(`${name} output checksum differs from C++`);
  }
  const nativeSingleStart = [];
  const cppSingleStart = [];
  for (let i = 0; i < 7; ++i) {
    let start = performance.now(); invokeNative(1); nativeSingleStart.push(performance.now() - start);
    start = performance.now(); invokeCpp(1); cppSingleStart.push(performance.now() - start);
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const outputBytes = statSync(join(root, outputName)).size;
  const result = {
    version: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    node: process.version,
    lines,
    inputBytes,
    outputBytes,
    outputSha256: digestFile(join(root, outputName)),
    methods: { reference: 'executeAsyncValue on the existing Log Analyzer IR', native: 'validated IR -> generated C -> platform C compiler with optimized release flags', node: 'readFileSync/split/filter/sort/join/writeFileSync', cpp: 'ifstream/string_view/filter/sort/ofstream with optimized release flags' },
    buildPipelineMs: { bmecFrontendAndIR: Number(frontendCompileMs.toFixed(3)), nativeLoweringAndCGeneration: Number(nativeGenerated.loweringMs.toFixed(3)), nativeCCompilation: Number(nativeCompileMs.toFixed(3)), cppCompilation: Number(cxxCompileMs.toFixed(3)) },
    compilers: { native: { compiler: nativeCompiler, version: nativeVersion, flags: nativeFlags, compileMs: Number(nativeCompileMs.toFixed(3)), instrumentedMemoryBuildMs: Number(nativeMemoryCompileMs.toFixed(3)) }, cpp: { compiler: cxxToolchain.path, version: cxxVersion, flags: cxxFlags, compileMs: Number(cxxCompileMs.toFixed(3)), ...(cppMemoryCompileMs === null ? {} : { instrumentedMemoryBuildMs: Number(cppMemoryCompileMs.toFixed(3)) }) } },
    executableBytes: { native: statSync(nativeExe).size, cpp: statSync(cxxExe).size },
    calibration: { targetMs, runsPerSample: runs, nativeMsAtCalibration: nativeCalibrationMs },
    workloads: { reference, native, node, cpp },
    memory: { native: nativeMemory, cpp: cppMemory, reference: 'not isolated', node: 'not isolated' },
    processLaunchPlusOneTransformMedianMs: { native: Number(median(nativeSingleStart).toFixed(3)), cpp: Number(median(cppSingleStart).toFixed(3)) },
    ratios: { nativeOverCpp: Number((native.medianMs / cpp.medianMs).toFixed(3)), nativeOverNode: Number((native.medianMs / node.medianMs).toFixed(3)), nativeOverReference: Number((native.medianMs / reference.medianMs).toFixed(3)) },
    limitations: ['Native and C++ batch timings exclude process launch with in-process clocks; one-transform process launch plus work is reported separately. Reference and Node processing batches use performance.now.', ...(process.platform === 'win32' ? ['Peak working set is isolated for native and C++; reference and Node memory are not isolated. Windows working set can include loaded executable and runtime pages.'] : ['Peak RSS is isolated for native and C++ only; reference and Node run inside the measurement host.'])],
  };
  writeFileSync(resolve(evidenceOutput), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
