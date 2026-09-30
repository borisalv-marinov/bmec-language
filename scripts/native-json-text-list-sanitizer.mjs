#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../dist/compiler.js';
import { executeValue } from '../dist/core/interpreter.js';
import { lowerNativeC } from '../dist/native/codegen.js';
import { injectFixtureWireLiterals } from './native-fixture-wire.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const compiler = process.env.BMEC_CC ?? 'gcc';
const fixture = 'json-decode-text-list.bmec';
const compiled = compileFile(join(root, 'tests', 'native', 'fixtures', fixture));
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));
injectFixtureWireLiterals(compiled.ir, { '__BMEC_LONG_TEXT_LIST__': 'longWire' }, executeValue);
const expected = String(executeValue(compiled.ir.functions, 'main', []));
if (expected !== 'true') throw new Error(`Unexpected reference result: ${expected}`);

const temp = mkdtempSync(join(tmpdir(), 'bmec-json-text-list-asan-'));
try {
  const source = join(temp, 'fixture.c');
  const executable = join(temp, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
  writeFileSync(source, lowerNativeC(compiled.ir), 'utf8');
  const flags = ['-O1', '-g', '-std=c11', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', source, '-lm', '-o', executable];
  const build = spawnSync(compiler, flags, { encoding: 'utf8', windowsHide: true, cwd: temp });
  if (build.error || build.status !== 0) throw new Error(`Sanitizer build failed: ${build.stderr || build.error?.message || build.status}`);
  const run = spawnSync(executable, [], { encoding: 'utf8', windowsHide: true, cwd: temp, env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=1:abort_on_error=1', UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1' } });
  if (run.error || run.status !== 0 || run.stdout.trim() !== expected) throw new Error(`Sanitizer run failed: ${run.stderr || run.error?.message || run.status}`);
  const result = {
    version: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    compiler,
    compilerVersion: spawnSync(compiler, ['--version'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0],
    flags: ['-O1', '-g', '-std=c11', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-lm'],
    fixture,
    cases: 1,
    passed: 1,
    exercisedPaths: ['empty list', 'two-item unescaped list', '20-item list with UTF-8 text and heap-backed item storage', 'type mismatch rejection', 'escaped Unicode text fallback'],
    reference: expected,
    native: run.stdout.trim(),
    findings: [],
  };
  const destination = process.env.BMEC_NATIVE_SANITIZER_EVIDENCE;
  if (destination) writeFileSync(resolve(destination), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
