#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../dist/compiler.js';
import { executeValue } from '../dist/core/interpreter.js';
import { lowerNativeC } from '../dist/native/codegen.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const fixture = 'enum-scalars.bmec';
const compiled = compileFile(join(root, 'tests', 'native', 'fixtures', fixture));
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map((item) => item.message).join('\n'));
const expected = String(executeValue(compiled.ir.functions, 'main', []));
if (expected !== 'true') throw new Error(`Unexpected reference result: ${expected}`);

const compiler = process.env.BMEC_CC ?? 'gcc';
const compilerVersion = execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim();
const flags = ['-O1', '-g', '-std=c11', '-fsanitize=address,undefined', '-fno-omit-frame-pointer'];
if (process.platform !== 'win32') flags.push('-lm');
const temp = mkdtempSync(join(tmpdir(), 'bmec-enum-asan-'));
try {
  const source = join(temp, 'fixture.c');
  const executable = join(temp, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
  writeFileSync(source, lowerNativeC(compiled.ir), 'utf8');
  const build = spawnSync(compiler, [...flags, source, '-o', executable], { encoding: 'utf8', windowsHide: true, cwd: temp });
  if (build.error || build.status !== 0) throw new Error(`Sanitizer build failed: ${build.stderr || build.error?.message || build.status}`);
  const run = spawnSync(executable, [], {
    encoding: 'utf8',
    windowsHide: true,
    cwd: temp,
    env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=1:halt_on_error=1', UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1' },
  });
  const clean = !/AddressSanitizer|UndefinedBehaviorSanitizer|LeakSanitizer|runtime error:/.test(run.stderr ?? '');
  if (run.error || run.status !== 0 || run.stdout.trim() !== expected || !clean)
    throw new Error(`Sanitizer run failed: ${run.stderr || run.error?.message || run.status}`);
  const result = {
    version: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    compiler,
    compilerVersion,
    flags,
    fixture,
    cases: 1,
    passed: 1,
    exercisedPaths: ['payload-free variant', 'integer payload', 'number payload', 'boolean payload', 'text payload', 'exhaustive tag matching', 'payload binding'],
    reference: expected,
    native: run.stdout.trim(),
    findings: [],
  };
  const destination = process.env.BMEC_NATIVE_ENUM_SANITIZER_OUTPUT;
  if (destination) writeFileSync(resolve(destination), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
