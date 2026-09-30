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
const compiler = process.env.BMEC_CC ?? 'gcc';
const compilerVersion = execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim();
const flags = ['-O1', '-g', '-std=c11', '-fsanitize=address,undefined', '-fno-omit-frame-pointer'];
if (process.platform !== 'win32') flags.push('-lm');
const temp = mkdtempSync(join(tmpdir(), 'bmec-money-asan-'));
try {
  const fixtures = [
    { file: 'money-exact-arithmetic.bmec', expected: '42', paths: ['arbitrary-precision literals', 'by-value helper parameters and returns', 'signed addition/subtraction/comparison', 'int64 boundary multiplication', 'division rounded half away from zero', 'negative divisors', 'exact cancellation'] },
    { file: 'money-json-encode.bmec', expected: 'true', paths: ['positive and negative money wire encoding', 'zero normalization', 'signed int64 wire boundaries'] },
    { file: 'json-encode-record-money.bmec', expected: 'true', paths: ['money as a plain-record field', 'positive and negative signed int64 money wire boundaries', 'zero record field'] },
    { file: 'json-encode-record-money-overflow.bmec', error: 'PIPE-CONTRACT-001', paths: ['money record-field wire overflow rejection'] },
    { file: 'money-json-encode-overflow-positive.bmec', error: 'PIPE-CONTRACT-001', paths: ['positive money wire overflow rejection'] },
    { file: 'money-json-encode-overflow-negative.bmec', error: 'PIPE-CONTRACT-001', paths: ['negative money wire overflow rejection'] },
  ];
  const results = [];
  for (const [index, fixture] of fixtures.entries()) {
    const compiled = compileFile(join(root, 'tests', 'native', 'fixtures', fixture.file));
    if (compiled.diagnostics.length) throw new Error(`${fixture.file}: ${compiled.diagnostics.map((item) => item.message).join('\n')}`);
    let expected, referenceError;
    try { expected = String(executeValue(compiled.ir.functions, 'main', [])); }
    catch (error) {
      const code = /PIPE-[A-Z0-9-]+/.exec(error instanceof Error ? error.message : String(error))?.[0];
      if (!code) throw error;
      referenceError = code;
    }
    if (fixture.error ? referenceError !== fixture.error : expected !== fixture.expected)
      throw new Error(`${fixture.file}: unexpected reference result ${referenceError ?? expected}`);
    const source = join(temp, `fixture-${index}.c`);
    const executable = join(temp, process.platform === 'win32' ? `fixture-${index}.exe` : `fixture-${index}`);
    writeFileSync(source, lowerNativeC(compiled.ir), 'utf8');
    const build = spawnSync(compiler, [...flags, source, '-o', executable], { encoding: 'utf8', windowsHide: true, cwd: temp });
    if (build.error || build.status !== 0) throw new Error(`${fixture.file}: sanitizer build failed: ${build.stderr || build.error?.message || build.status}`);
    const run = spawnSync(executable, [], {
      encoding: 'utf8',
      windowsHide: true,
      cwd: temp,
      env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=1:halt_on_error=1', UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1' },
    });
    const clean = !/AddressSanitizer|UndefinedBehaviorSanitizer|LeakSanitizer|runtime error:/.test(run.stderr ?? '');
    const nativeError = /PIPE-[A-Z0-9-]+/.exec(run.stderr ?? '')?.[0];
    const passed = fixture.error
      ? run.status === 70 && nativeError === fixture.error
      : run.status === 0 && run.stdout.trim() === expected;
    if (run.error || !passed || !clean)
      throw new Error(`${fixture.file}: sanitizer run failed: ${run.stderr || run.error?.message || run.status}`);
    results.push({ fixture: fixture.file, cases: 1, passed: 1, reference: referenceError ?? expected, native: nativeError ?? run.stdout.trim(), exercisedPaths: fixture.paths });
  }
  const result = {
    version: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    platform: `${process.platform} ${process.arch}`,
    compiler,
    compilerVersion,
    flags,
    cases: results.length,
    passed: results.length,
    results,
    findings: [],
  };
  const destination = process.env.BMEC_NATIVE_MONEY_SANITIZER_OUTPUT;
  if (destination) writeFileSync(resolve(destination), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
