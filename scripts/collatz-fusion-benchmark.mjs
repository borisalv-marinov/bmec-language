#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../dist/compiler.js";
import { executeValue } from "../dist/core/interpreter.js";
import { lowerNativeC } from "../dist/native/codegen.js";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const source = readFileSync(join(root, "examples/native-compute-bench/main.bmec"), "utf8");
const compiled = compile(source);
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join("; "));

const input = 837799;
const expected = String(executeValue(compiled.ir.functions, "collatzSteps", [input], { maxSteps: 5_000_000 }));
if (expected !== "524") throw new Error(`Unexpected BMEC reference checksum: ${expected}`);
const entry = compiled.ir.functions.find(fn => fn.name === "collatzSteps");
if (!entry) throw new Error("Collatz workload function is missing");
const symbol = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
const runsLimit = 1_048_576;
const targetMs = Number(process.env.BMEC_COMPARISON_TARGET_MS ?? 100);
const samples = Number(process.env.BMEC_COMPARISON_SAMPLES ?? 9);
const compiler = process.env.BMEC_CC ?? (process.platform === "win32" ? "clang" : "clang");
const flags = ["-O3", "-std=c11"];
if (process.platform !== "win32") flags.push("-lm");

let generated = lowerNativeC(compiled.ir)
  .replace("#include <stdlib.h>", "#include <stdlib.h>\n#include <time.h>")
  .replaceAll("> 100000", "> INT64_C(5000000)");
const main = `int main(int argc, char **argv) { if (argc != 3) return 2; int64_t runs = strtoll(argv[1], NULL, 10); int64_t input = strtoll(argv[2], NULL, 10); int64_t result = 0; clock_t start = clock(); for (int64_t i = 0; i < runs; ++i) { bmec_steps = 0; bmec_depth = 0; result = ${symbol}(input); bmec_arena_release(); } double elapsed = (double)(clock() - start) / (double)CLOCKS_PER_SEC; printf("%" PRId64 " %.9f\\n", result, elapsed); return 0; }\n`;
generated = generated.replace(/int main\(void\) \{[\s\S]*?\n\}\n$/, main);
if (!generated.includes(main)) throw new Error("Could not install the benchmark batch entry point");
const baseline = generated.replace(/bmec_mul3_add1\((bmec_v_[A-Za-z0-9_]+)\)/g, "bmec_add(bmec_mul($1, INT64_C(3)), INT64_C(1))");
if (baseline === generated) throw new Error("Could not recover the unfused checked arithmetic expression");
const parityOptimized = generated.replace(/bmec_mod\((bmec_v_[A-Za-z0-9_]+), INT64_C\(2\)\)/g, "(((uint64_t)($1)) & UINT64_C(1))");
if (parityOptimized === generated) throw new Error("Could not recover the modulo-based parity expression");
const stepFusionMatches = [...generated.matchAll(/(\n\s*)if \(([^{}\n]+)\) \{\n(\s*)bmec_step_many\(2\);/g)];
if (stepFusionMatches.length !== 1) throw new Error(`Expected one fused branch guard, found ${stepFusionMatches.length}`);
const stepFusionBaseline = generated
  .replace(/(\n\s*)if \(([^{}\n]+)\) \{\n(\s*)bmec_step_many\(2\);/g, "$1bmec_step();$1if ($2) {\n$3bmec_step();")
  .replaceAll("bmec_step_many(2);", "bmec_step();");
const variants = [["baseline", baseline], ["fused", generated], ["stepFusionBaseline", stepFusionBaseline], ["parityOptimized", parityOptimized]];

const work = mkdtempSync(join(tmpdir(), "bmec-collatz-fusion-"));
try {
  const executables = [];
  for (const [label, code] of variants) {
    const cPath = join(work, `${label}.c`);
    const executable = join(work, `${label}${process.platform === "win32" ? ".exe" : ""}`);
    writeFileSync(cPath, code, "utf8");
    const build = spawnSync(compiler, [...flags, cPath, "-o", executable], { encoding: "utf8", windowsHide: true });
    if (build.error || build.status !== 0) throw new Error(`${label} C build failed: ${build.stderr || build.error?.message || build.status}`);
    executables.push({ label, executable });
  }

  const invoke = (executable, runs) => {
    const result = spawnSync(executable, [String(runs), String(input)], { encoding: "utf8", windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`Native benchmark invocation failed: ${result.stderr || result.error?.message || result.status}`);
    const [checksum, seconds] = result.stdout.trim().split(/\s+/);
    if (checksum !== expected) throw new Error(`Checksum mismatch: expected ${expected}, received ${checksum}`);
    return { checksum, nsPerTrajectory: Number(seconds) * 1e9 / runs, elapsedMs: Number(seconds) * 1e3 };
  };

  let runs = 1;
  let calibration = invoke(executables[0].executable, runs);
  while (calibration.elapsedMs < targetMs && runs < runsLimit) {
    runs = Math.min(runs * 2, runsLimit);
    calibration = invoke(executables[0].executable, runs);
  }
  if (calibration.elapsedMs < targetMs) throw new Error(`Could not reach ${targetMs} ms within ${runsLimit} runs`);

  for (const item of executables) for (let warmup = 0; warmup < 2; warmup++) invoke(item.executable, runs);
  const values = new Map(executables.map(item => [item.label, []]));
  for (let sample = 0; sample < samples; sample++) {
    const offset = sample % executables.length;
    const order = [...executables.slice(offset), ...executables.slice(0, offset)];
    for (const item of order) values.get(item.label).push(invoke(item.executable, runs));
  }

  const stats = list => {
    const sorted = list.map(item => item.nsPerTrajectory).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
    return {
      samples: list.length,
      medianNsPerTrajectory: Number(median.toFixed(3)),
      p95NsPerTrajectory: Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3)),
      coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)),
      rawNsPerTrajectory: list.map(item => Number(item.nsPerTrajectory.toFixed(3))),
      checksum: expected,
    };
  };
  const baselineStats = stats(values.get("baseline"));
  const fusedStats = stats(values.get("fused"));
  const stepFusionBaselineStats = stats(values.get("stepFusionBaseline"));
  const parityStats = stats(values.get("parityOptimized"));
  const output = {
    version: 1,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
    compiler,
    compilerVersion: execFileSync(compiler, ["--version"], { encoding: "utf8" }).split(/\r?\n/, 1)[0].trim(),
    flags,
    clock: "C clock() process CPU time inside native batch",
    targetSampleMs: targetMs,
    runsPerSample: runs,
    warmupSamples: 2,
    samplesPerVariant: samples,
    checksum: expected,
    baseline: baselineStats,
    fused: fusedStats,
    stepFusionBaseline: stepFusionBaselineStats,
    parityOptimized: parityStats,
    fusedVsBaselineRatio: Number((fusedStats.medianNsPerTrajectory / baselineStats.medianNsPerTrajectory).toFixed(4)),
    stepFusionVsBaselineRatio: Number((fusedStats.medianNsPerTrajectory / stepFusionBaselineStats.medianNsPerTrajectory).toFixed(4)),
    parityVsFusedRatio: Number((parityStats.medianNsPerTrajectory / fusedStats.medianNsPerTrajectory).toFixed(4)),
  };
  const destination = process.env.BMEC_COLLATZ_FUSION_OUTPUT;
  if (destination) writeFileSync(resolve(destination), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
