#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../dist/compiler.js';
import { executeValue } from '../dist/core/interpreter.js';
import { lowerNativeC } from '../dist/native/codegen.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const compiler = process.env.BMEC_CC ?? 'gcc';
const runs = Number(process.env.BMEC_PROFILE_RUNS ?? 1_000_000);
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('BMEC_PROFILE_RUNS must be a positive safe integer');
const input = 837799;
const source = readFileSync(join(root, 'examples/native-compute-bench/main.bmec'), 'utf8');
const compiled = compile(source);
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('; '));
const expected = String(executeValue(compiled.ir.functions, 'collatzSteps', [input], { maxSteps: 5_000_000 }));
if (expected !== '524') throw new Error(`Unexpected BMEC checksum ${expected}`);
const entry = compiled.ir.functions.find(fn => fn.name === 'collatzSteps');
if (!entry) throw new Error('Collatz workload function is missing');
const symbol = `bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const main = `int main(int argc, char **argv) { if (argc != 1) return 2; int64_t result = 0; for (int64_t i = 0; i < INT64_C(${runs}); ++i) { bmec_steps = 0; bmec_depth = 0; result = ${symbol}(INT64_C(${input})); bmec_arena_release(); } printf("%" PRId64 "\\n", result); return result == INT64_C(${expected}) ? 0 : 1; }\n`;
let generated = lowerNativeC(compiled.ir).replace(/int main\(void\) \{[\s\S]*?\n\}\n$/, main);
if (!generated.includes(main)) throw new Error('Could not install the profiling batch entry point');

const work = mkdtempSync(join(tmpdir(), 'bmec-native-collatz-profile-'));
try {
  const cPath = join(work, 'profile.c');
  const executable = join(work, 'profile');
  writeFileSync(cPath, generated, 'utf8');
  const flags = ['-O3', '-pg', '-std=c11', '-lm'];
  const build = spawnSync(compiler, [...flags.slice(0, 3), cPath, '-o', executable, '-lm'], { encoding: 'utf8' });
  if (build.error || build.status !== 0) throw new Error(`Profiling build failed: ${build.stderr || build.error?.message || build.status}`);
  const execution = spawnSync(executable, [], { cwd: work, encoding: 'utf8' });
  if (execution.error || execution.status !== 0 || execution.stdout.trim() !== expected)
    throw new Error(`Profiled execution mismatch: ${execution.stderr || execution.stdout || execution.status}`);
  const compilerVersion = execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim();
  const report = execFileSync('gprof', ['-b', '-p', executable, join(work, 'gmon.out')], { encoding: 'utf8' });
  const symbols = execFileSync('nm', ['--defined-only', executable], { encoding: 'utf8' }).split(/\r?\n/);
  const profiledSymbol = symbols.map(line => line.trim().split(/\s+/).at(-1)).find(name => name?.startsWith(symbol));
  if (!profiledSymbol) throw new Error(`Could not find the generated workload symbol ${symbol}`);
  const disassembly = execFileSync('objdump', ['-d', `--disassemble=${profiledSymbol}`, executable], { encoding: 'utf8' });
  const output = {
    version: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    compiler,
    compilerVersion,
    flags,
    profileTool: execFileSync('gprof', ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim(),
    workload: 'Collatz stopping length of 837799',
    runs,
    checksum: expected,
    note: 'Instrumentation profile for call counts and sampled hotspots; not a timing benchmark.',
    profiledSymbol,
    flatProfile: report,
    workloadDisassembly: disassembly,
  };
  const destination = process.env.BMEC_NATIVE_PROFILE_OUTPUT;
  if (destination) {
    const target = resolve(destination);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(output, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
