#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { cpus, tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { compile } from "../dist/compiler.js";
import { executeValue } from "../dist/core/interpreter.js";
import { lowerNativeC } from "../dist/native/codegen.js";
import { compileNativeSource, resolveNativeCompiler } from "../dist/native/build.js";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const size = Number(process.env.BMEC_NUMERIC_SORT_SIZE ?? 1024);
const samples = Number(process.env.BMEC_NUMERIC_SORT_SAMPLES ?? 9);
const targetMs = Number(process.env.BMEC_NUMERIC_SORT_TARGET_MS ?? 75);
const maxRuns = 1_048_576;
const validationSeeds = 512;
if (!Number.isSafeInteger(size) || size < 1 || size > 4096) throw new Error("BMEC_NUMERIC_SORT_SIZE must be from 1 through 4096");
if (!Number.isSafeInteger(samples) || samples < 3) throw new Error("BMEC_NUMERIC_SORT_SAMPLES must be at least 3");
if (!Number.isFinite(targetMs) || targetMs < 10) throw new Error("BMEC_NUMERIC_SORT_TARGET_MS must be at least 10");

const bases = Array.from({ length: size }, (_, index) => (index * 7919) % 1009);
const sortedBases = [...bases].sort((a, b) => a - b);
const listValues = bases.map((base) => `(seed * 0.25 + ${base}.0 * 0.25 - 126.0)`);
const sortedValues = sortedBases.map((base) => `(double)(${base}.0 * 0.25 - 126.0)`).join(",");
const source = `app NumericSortProfile
function buildChecksum(seed number) -> number {
  let values = [${listValues.join(", ")}]
  var checksum number = 0.0
  for value in values {
    checksum = (checksum * 33.0 + value) % 1000003.0
  }
  return checksum
}
function measure(seed number, shouldSort boolean) -> number {
  var values = [${listValues.join(", ")}]
  if shouldSort {
    values = sort(values)
  }
  var checksum number = 0.0
  for value in values {
    checksum = (checksum * 33.0 + value) % 1000003.0
  }
  return checksum
}
function main() -> number {
  return measure(0.0, true) + buildChecksum(0.0)
}`;
const compiled = compile(source);
if (compiled.diagnostics.length) throw new Error(JSON.stringify(compiled.diagnostics));
const ir = compiled.ir;
const reference = (seed) => executeValue(ir.functions, "measure", [seed, true], { maxSteps: 100_000 });
const digest = (values) => createHash("sha256").update(values.map((value) => String(value)).join("\n")).digest("hex");
const referenceOutputs = Array.from({ length: validationSeeds }, (_, seed) => reference(seed));
const referenceDigest = digest(referenceOutputs);

const cName = (fn) => `bmec_fn_${[...new TextEncoder().encode(String(fn.id))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
const findFunction = (name) => {
  const fn = ir.functions.find((candidate) => candidate.name === name);
  if (!fn) throw new Error(`Missing benchmark function ${name}`);
  return fn;
};
const buildC = cName(findFunction("buildChecksum"));
const measureC = cName(findFunction("measure"));
let cSource = lowerNativeC(ir).replace(
  "#include <stdlib.h>",
  "#include <stdlib.h>\n#include <time.h>\n#ifdef _WIN32\n#include <windows.h>\nstatic double bmec_profile_seconds(void) { LARGE_INTEGER frequency, counter; QueryPerformanceFrequency(&frequency); QueryPerformanceCounter(&counter); return (double)counter.QuadPart/(double)frequency.QuadPart; }\n#else\nstatic double bmec_profile_seconds(void) { struct timespec value; clock_gettime(CLOCK_MONOTONIC,&value); return (double)value.tv_sec+(double)value.tv_nsec/1000000000.0; }\n#endif",
);
const nativeMain = `int main(int argc, char **argv) {
  if (argc != 3) return 2;
  const int64_t runs = strtoll(argv[1], NULL, 10);
  const int phase = atoi(argv[2]);
  if (runs < 1 || phase < -1 || phase > 2) return 2;
  if (phase == -1) {
    for (int64_t i = 0; i < runs; ++i) { bmec_steps = 0; bmec_depth = 0; double value = ${measureC}((double)(i % 1024), true); printf("%.17g\\n", value); bmec_arena_release(); }
    return 0;
  }
  static const double sorted_input[${size}] = { ${sortedValues} };
  volatile double sink = 0.0;
  const double start = bmec_profile_seconds();
  double value = 0.0;
  for (int64_t i = 0; i < runs; ++i) {
    bmec_steps = 0; bmec_depth = 0;
    if (phase == 0) value = ${buildC}((double)(i % 1024));
    else if (phase == 1) value = ${measureC}((double)(i % 1024), true);
    else { value = 0.0; for (size_t j = 0; j < ${size}; ++j) value = bmec_number_mod(value * 33.0 + sorted_input[j], 1000003.0); }
    sink = value;
    bmec_arena_release();
  }
  printf("%.17g %.9f\\n", value, bmec_profile_seconds() - start);
  return 0;
}
`;
const wrappedC = cSource.replace(/int main\(void\) \{[\s\S]*\n\}\n$/, nativeMain);
if (wrappedC === cSource) throw new Error("Could not install native profiling entry point");

const cppSource = `#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
constexpr int size = ${size};
constexpr int bases[size] = { ${bases.join(",")} };
constexpr double base_values[size] = { ${bases.map((base) => `(${base}.0 * 0.25 - 126.0)`).join(",")} };
constexpr double sorted_values[size] = { ${sortedBases.map((base) => `(${base}.0 * 0.25 - 126.0)`).join(",")} };
volatile double sink = 0.0;
inline double bmec_number(double value) { if (!std::isfinite(value)) throw std::runtime_error("PIPE-RUNTIME-005: Invalid numeric value"); return value; }
inline double bmec_number_add(double a, double b) { return bmec_number(a + b); }
inline double bmec_number_mul(double a, double b) { return bmec_number(a * b); }
inline double bmec_number_mod(double a, double b) { if (b == 0.0) throw std::runtime_error("PIPE-RUNTIME-003: Division by zero"); return bmec_number(std::fmod(a, b)); }
std::array<double,size> make_values(long long seed) { std::array<double,size> values{}; const double scaledSeed=bmec_number_mul(static_cast<double>(seed),0.25); for (int i=0;i<size;++i) values[i]=bmec_number_add(scaledSeed,base_values[i]); return values; }
double checksum_values(const double *values) { double checksum=0.0; for(int i=0;i<size;++i) checksum=bmec_number_mod(bmec_number_add(bmec_number_mul(checksum,33.0),values[i]),1000003.0); return checksum; }
double measure(long long seed) { auto values=make_values(seed); std::sort(values.begin(),values.end()); return checksum_values(values.data()); }
int main(int argc,char **argv) { if(argc!=3)return 2; const long long runs=std::strtoll(argv[1],nullptr,10); const int phase=std::atoi(argv[2]); if(runs<1||phase< -1||phase>2)return 2; if(phase==-1){for(long long i=0;i<runs;++i)std::printf("%.17g\\n",measure(i%1024));return 0;} const auto start=std::chrono::steady_clock::now(); double value=0.0; for(long long i=0;i<runs;++i){if(phase==0){auto values=make_values(i%1024);value=checksum_values(values.data());}else if(phase==1)value=measure(i%1024);else value=checksum_values(sorted_values);sink=value;} const double elapsed=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();std::printf("%.17g %.9f\\n",value,elapsed);return 0; }
`;

const work = mkdtempSync(join(tmpdir(), "bmec-numeric-sort-profile-"));
try {
  const nativeCompiler = resolveNativeCompiler();
  const cPath = join(work, "numeric-sort-profile.c");
  const cExe = join(work, process.platform === "win32" ? "numeric-sort-profile.exe" : "numeric-sort-profile");
  writeFileSync(cPath, wrappedC, "utf8");
  const cFlags = compileNativeSource(nativeCompiler, cPath, cExe, "c");
  const cppPath = join(work, process.platform === "win32" ? "numeric-sort-profile.cpp" : "numeric-sort-profile.cc");
  const cppExe = join(work, process.platform === "win32" ? "numeric-sort-profile-cpp.exe" : "numeric-sort-profile-cpp");
  writeFileSync(cppPath, cppSource, "utf8");
  let cppCompiler;
  let cppFlags;
  if (process.platform === "win32") {
    cppCompiler = nativeCompiler;
    cppFlags = compileNativeSource(cppCompiler, cppPath, cppExe, "c++");
  } else {
    const version = execFileSync("g++", ["--version"], { encoding: "utf8" }).split(/\r?\n/, 1)[0].trim();
    cppCompiler = { path: "g++", version, kind: "gnu" };
    const build = spawnSync("g++", ["-O3", "-std=c++17", cppPath, "-o", cppExe], { encoding: "utf8" });
    if (build.error || build.status !== 0) throw new Error(build.stderr || build.error?.message || "C++ profile build failed");
    cppFlags = ["-O3", "-std=c++17"];
  }

  const run = (exe, runs, phase) => {
    const output = execFileSync(exe, [String(runs), String(phase)], { encoding: "utf8", windowsHide: true }).trim();
    return output.split(/\s+/).filter(Boolean);
  };
  for (const [label, values] of [
    ["native C", run(cExe, validationSeeds, -1)],
    ["C++", run(cppExe, validationSeeds, -1)],
  ]) {
    if (values.length !== validationSeeds) throw new Error(`${label} returned ${values.length} validation values`);
    const actual = values.map(Number);
    for (let seed = 0; seed < validationSeeds; ++seed)
      if (!Number.isFinite(actual[seed]) || actual[seed] !== referenceOutputs[seed])
        throw new Error(`${label} checksum mismatch at seed ${seed}: expected ${referenceOutputs[seed]}, got ${values[seed]}`);
    if (digest(actual) !== referenceDigest) throw new Error(`${label} validation digest mismatch`);
  }

  const summarize = (times, runs) => {
    const ordered = [...times].sort((a, b) => a - b);
    const median = ordered[Math.floor(ordered.length / 2)];
    const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
    const variance = times.reduce((sum, value) => sum + (value - mean) ** 2, 0) / times.length;
    return {
      samples: times.length,
      warmups: 2,
      targetSampleMs: targetMs,
      runsPerSample: runs,
      minMs: Number(ordered[0].toFixed(4)),
      medianMs: Number(median.toFixed(4)),
      p95Ms: Number(ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))].toFixed(4)),
      maxMs: Number(ordered.at(-1).toFixed(4)),
      coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)),
      nsPerOperation: Number((median * 1e6 / runs).toFixed(3)),
    };
  };
  const measure = (label, exe, phase) => {
    const invoke = (runs) => {
      const values = run(exe, runs, phase);
      if (values.length !== 2) throw new Error(`${label} returned an invalid timing record`);
      return { checksum: Number(values[0]), elapsedMs: Number(values[1]) * 1000 };
    };
    for (let i = 0; i < 2; ++i) invoke(1);
    let runs = 1;
    let trial;
    while (true) {
      trial = invoke(runs);
      if (trial.elapsedMs >= targetMs || runs >= maxRuns) break;
      runs = Math.min(runs * 2, maxRuns);
    }
    if (trial.elapsedMs < targetMs) throw new Error(`${label} could not reach the ${targetMs} ms sample target`);
    const times = [];
    let finalChecksum;
    for (let sample = 0; sample < samples; ++sample) {
      const result = invoke(runs);
      times.push(result.elapsedMs);
      finalChecksum = result.checksum;
    }
    return { ...summarize(times, runs), finalChecksum };
  };

  const phases = ["constructPlusChecksum", "constructSortPlusChecksum", "checksumOnly"];
  const native = Object.fromEntries(phases.map((phase, index) => [phase, measure(`native ${phase}`, cExe, index)]));
  const cpp = Object.fromEntries(phases.map((phase, index) => [phase, measure(`C++ ${phase}`, cppExe, index)]));
  for (const phase of phases) {
    if (native[phase].finalChecksum !== cpp[phase].finalChecksum)
      throw new Error(`${phase} checksum mismatch: native ${native[phase].finalChecksum}, C++ ${cpp[phase].finalChecksum}`);
  }
  const result = {
    version: 1,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    machine: { cpu: cpus()[0]?.model ?? "unknown" },
    compiler: { nativeC: nativeCompiler.version, cpp: cppCompiler.version, nativeFlags: cFlags, cppFlags },
    dataset: { values: size, validationSeeds, outputSha256: referenceDigest, targetSampleMs: targetMs, samples, warmups: 2 },
    phases: {
      native,
      cpp,
      estimatedSortDeltaNs: {
        native: Number((native.constructSortPlusChecksum.nsPerOperation - native.constructPlusChecksum.nsPerOperation).toFixed(3)),
        cpp: Number((cpp.constructSortPlusChecksum.nsPerOperation - cpp.constructPlusChecksum.nsPerOperation).toFixed(3)),
        note: "Derived by subtracting paired construction-plus-checksum medians from construction-sort-checksum medians; includes sort-call and timing noise, not a standalone sort measurement.",
      },
      nativeOverCpp: Object.fromEntries(phases.map((phase) => [phase, Number((native[phase].nsPerOperation / cpp[phase].nsPerOperation).toFixed(3))])),
    },
  };
  const destination = process.env.BMEC_NUMERIC_SORT_PROFILE_OUTPUT ?? join(root, "docs", "evidence", `bmec-0.5-native-numeric-sort-profile-n${size}-${process.platform}.json`);
  writeFileSync(resolve(destination), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
