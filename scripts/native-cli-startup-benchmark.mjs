#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

if (process.platform !== 'linux') {
  console.log(JSON.stringify({ version: 1, platform: process.platform, skipped: 'Native CLI startup benchmark currently targets Linux.' }, null, 2));
  process.exit(0);
}

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const samples = Number(process.env.BMEC_CLI_STARTUP_SAMPLES ?? 15);
const warmups = Number(process.env.BMEC_CLI_STARTUP_WARMUPS ?? 2);
if (!Number.isSafeInteger(samples) || samples < 5 || samples > 100) throw new Error('BMEC_CLI_STARTUP_SAMPLES must be from 5 through 100');
if (!Number.isSafeInteger(warmups) || warmups < 0 || warmups > 20) throw new Error('BMEC_CLI_STARTUP_WARMUPS must be from 0 through 20');

const seedInput = '12345678';
const seed = seedInput.length * 100_000 + 1;
function collatzSteps(initial) { let value = initial; let steps = 0; while (value > 1) { if (value % 2 === 0) value /= 2; else value = value * 3 + 1; steps++; } return steps; }
const expected = collatzSteps(seed);
const source = `app NativeCliStartup\nfunction collatzSteps(initial integer) -> integer {\n  var value integer = initial\n  var steps integer = 0\n  while value > 1 {\n    if value % 2 == 0 { value = value / 2 } else { value = value * 3 + 1 }\n    steps = steps + 1\n  }\n  return steps\n}\nfunction main(fs capability<filesystem>, path text) -> result<boolean,text> {\n  let contents = readTextFile(fs, path)?\n  let parts = split(contents, "")\n  let initial = length(parts) * 100000 + 1\n  return ok(collatzSteps(initial) == ${expected})\n}\n`;
const nodeSource = `import { readFileSync } from 'node:fs';\nconst contents = readFileSync(process.argv[2], 'utf8');\nconst initial = [...contents].length * 100000 + 1;\nfunction collatzSteps(value) { let steps = 0; while (value > 1) { if (value % 2 === 0) value /= 2; else value = value * 3 + 1; steps++; } return steps; }\nprocess.stdout.write(String(collatzSteps(initial) === ${expected}) + '\\n');\n`;
const cppSource = `#include <cstdint>\n#include <cstdio>\n#include <fstream>\n#include <iterator>\n#include <string>\nint main(int argc, char **argv) { if (argc != 2) return 2; std::ifstream input(argv[1], std::ios::binary); if (!input) return 3; std::string contents((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>()); int64_t value = static_cast<int64_t>(contents.size()) * 100000 + 1; int64_t steps = 0; while (value > 1) { if (value % 2 == 0) value /= 2; else value = value * 3 + 1; ++steps; } std::printf("%s\\n", steps == ${expected} ? "true" : "false"); return 0; }\n`;
const work = mkdtempSync(join(tmpdir(), 'bmec-cli-startup-'));
const run = (command, args, cwd = root) => {
  const start = performance.now();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const elapsedMs = performance.now() - start;
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.error?.message || result.status}`);
  return { elapsedMs, stdout: result.stdout.trim() };
};
try {
  const sourceCopy = join(work, 'main.bmec');
  const inputRoot = join(work, 'fs-root');
  const inputPath = join(inputRoot, 'seed.txt');
  const nodePath = join(work, 'node-collatz.mjs');
  const cppPath = join(work, 'collatz.cpp');
  const cppExe = join(work, 'collatz-cpp');
  mkdirSync(inputRoot);
  writeFileSync(sourceCopy, source, 'utf8');
  writeFileSync(inputPath, seedInput, 'utf8');
  writeFileSync(nodePath, nodeSource, 'utf8');
  writeFileSync(cppPath, cppSource, 'utf8');

  const nativeBuild = run(process.execPath, [join(root, 'dist', 'cli', 'index.js'), 'build', sourceCopy, '--native']);
  const nativeBuildInfo = JSON.parse(readFileSync(join(work, 'native', 'build.json'), 'utf8'));
  const nativeExe = join(work, 'native', 'bmec-native');
  const cppCompileStart = performance.now();
  const cppCompile = spawnSync('g++', ['-O3', '-std=c++17', cppPath, '-o', cppExe], { cwd: work, encoding: 'utf8', windowsHide: true });
  const cppCompileMs = performance.now() - cppCompileStart;
  if (cppCompile.error || cppCompile.status !== 0) throw new Error(`g++ failed: ${cppCompile.stderr || cppCompile.error?.message || cppCompile.status}`);

  const implementations = {
    bmecCliReference: () => {
      const result = run(process.execPath, [join(root, 'dist', 'cli', 'index.js'), 'exec', sourceCopy, 'main', '--json', '--args', JSON.stringify(['seed.txt']), '--filesystem-root', inputRoot]);
      const parsed = JSON.parse(result.stdout);
      if (!parsed.ok || parsed.value?.state !== 'ok' || parsed.value.value !== true) throw new Error(`BMEC CLI returned unexpected result: ${result.stdout}`);
      return result.elapsedMs;
    },
    bmecNative: () => {
      const result = run(nativeExe, ['--fs-root', inputRoot, 'seed.txt']);
      const parsed = JSON.parse(result.stdout);
      if (parsed.state !== 'ok' || parsed.value !== true) throw new Error(`BMEC native returned ${result.stdout}, expected an ok true Result`);
      return result.elapsedMs;
    },
    node: () => {
      const result = run(process.execPath, [nodePath, inputPath]);
      if (result.stdout !== 'true') throw new Error(`Node returned ${result.stdout}, expected true`);
      return result.elapsedMs;
    },
    cpp: () => {
      const result = run(cppExe, [inputPath]);
      if (result.stdout !== 'true') throw new Error(`C++ returned ${result.stdout}, expected true`);
      return result.elapsedMs;
    },
  };

  for (const invoke of Object.values(implementations)) for (let i = 0; i < warmups; ++i) invoke();
  const names = Object.keys(implementations);
  const durations = Object.fromEntries(names.map(name => [name, []]));
  for (let sample = 0; sample < samples; ++sample) {
    const offset = sample % names.length;
    const order = [...names.slice(offset), ...names.slice(0, offset)];
    for (const name of order) durations[name].push(Number(implementations[name]().toFixed(3)));
  }
  const summarize = values => {
    const ordered = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return {
      samples: values.length,
      minMs: ordered[0],
      medianMs: ordered[Math.floor(ordered.length / 2)],
      p95Ms: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))],
      maxMs: ordered.at(-1),
      coefficientOfVariation: Number((Math.sqrt(variance) / mean).toFixed(4)),
      rawMs: values,
    };
  };
  const stats = Object.fromEntries(Object.entries(durations).map(([name, values]) => [name, summarize(values)]));
  const medians = Object.fromEntries(Object.entries(stats).map(([name, value]) => [name, value.medianMs]));
  const evidence = {
    version: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workload: 'fresh process start, read an 8-byte file, derive the Collatz seed from its runtime length, and execute one trajectory',
    input: { fileBytes: Buffer.byteLength(seedInput), derivedSeed: seed, expectedSteps: expected, expectedResult: true, sourceBytes: Buffer.byteLength(source) },
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    node: process.version,
    methodology: { samples, warmups, order: 'rotated implementation order each sample', timing: 'parent process wall time around spawn and completion; OS page cache may be warm' },
    implementations: stats,
    nativeBuild: { wallMs: Number(nativeBuild.elapsedMs.toFixed(3)), compiler: nativeBuildInfo.compiler, compilerVersion: nativeBuildInfo.compilerVersion, flags: nativeBuildInfo.flags, executableBytes: statSync(nativeExe).size },
    cppBuild: { compileMs: Number(cppCompileMs.toFixed(3)), compiler: 'g++', compilerVersion: execFileSync('g++', ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(), flags: ['-O3', '-std=c++17'], executableBytes: statSync(cppExe).size },
    ratios: Object.fromEntries(Object.entries(medians).filter(([name]) => name !== 'bmecNative').map(([name, medianMs]) => [name, Number((medians.bmecNative / medianMs).toFixed(3))])),
  };
  const output = join(root, 'docs', 'evidence', 'bmec-0.5-cli-startup-linux.json');
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
