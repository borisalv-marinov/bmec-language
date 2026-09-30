#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../dist/compiler.js';
import { PipeRuntimeError, executeValue } from '../dist/core/interpreter.js';
import { injectFixtureWireLiterals } from './native-fixture-wire.mjs';
import { lowerNativeC } from '../dist/native/codegen.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const compiler = process.env.BMEC_CC || 'gcc';
const version = execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim();
const flags = ['-O1', '-g', '-std=c11', '-fsanitize=address,undefined', '-fno-omit-frame-pointer'];
if (process.platform !== 'win32') flags.push('-lm');
const fixtures = [
  { file: 'text-concat.bmec', expected: 'true' },
  { file: 'text-length.bmec', expected: 'true' },
  { file: 'text-index-of.bmec', expected: 'true' },
  { file: 'text-prefix-suffix.bmec', expected: 'true' },
  { file: 'text-substring.bmec', expected: 'true' },
  { file: 'text-substring-negative.bmec', error: 'PIPE-RUNTIME-002' },
  { file: 'text-substring-reversed.bmec', error: 'PIPE-RUNTIME-002' },
  { file: 'text-map-lambda.bmec', expected: 'true' },
  { file: 'primitive-map-cross-type.bmec', expected: 'true' },
  { file: 'text-concat-allocation-error.bmec', error: 'PIPE-RUNTIME-007', reference: 'true', allocationLimit: 40 },
  { file: 'text-split-join.bmec', expected: '1' },
  { file: 'text-filter-lambda.bmec', expected: '2' },
  { file: 'text-fold-lambda.bmec', expected: '2' },
  { file: 'text-sort.bmec', expected: 'true' },
  { file: 'nested-record-values.bmec', expected: 'true' },
  { file: 'json-encode-primitives.bmec', expected: 'true' },
  { file: 'json-encode-lists.bmec', expected: 'true' },
  { file: 'json-encode-lists.bmec', error: 'PIPE-RUNTIME-007', reference: 'true', allocationLimit: 64 },
  { file: 'json-encode-record.bmec', expected: 'true' },
  { file: 'json-encode-record-optional.bmec', expected: 'true' },
  { file: 'json-encode-numbers.bmec', expected: 'true' },
  { file: 'number-constant-fold.bmec', expected: '1853.75' },
  { file: 'numeric-sort.bmec', expected: 'true' },
  { file: 'json-decode-primitives.bmec', expected: 'true' },
  { file: 'json-decode-optional.bmec', expected: 'true' },
  { file: 'json-decode-result.bmec', expected: 'true' },
  { file: 'json-decode-text-list.bmec', expected: 'true', recordWireFunctions: { '__BMEC_LONG_TEXT_LIST__': 'longWire' } },
  { file: 'json-decode-primitive-list.bmec', expected: 'true' },
  { file: 'json-decode-record-integer-list.bmec', expected: 'true', recordWireFunctions: { '__BMEC_RECORD_LIST_WIRE__': 'sampleWire', '__BMEC_NONCANONICAL_RECORD_LIST_WIRE__': 'nonCanonicalWire' } },
  { file: 'json-decode-record-mixed-scalar-list.bmec', expected: 'true', recordWireFunctions: { '__BMEC_MIXED_RECORD_WIRE__': 'sampleWire', '__BMEC_NONCANONICAL_MIXED_RECORD_WIRE__': 'nonCanonicalWire', '__BMEC_ESCAPED_TEXT_WIRE__': 'escapedTextWire' } },
  { file: 'json-decode-record.bmec', expected: 'true', recordWireFunctions: { '__BMEC_PAYLOAD_WIRE__': 'payloadWire', '__BMEC_OTHER_WIRE__': 'otherWire', '__BMEC_ABSENT_SCORE_WIRE__': 'absentScoreWire', '__BMEC_NONCANONICAL_LIST_WIRE__': 'nonCanonicalPayloadWire' } },
  { file: 'checked-mod2-parity.bmec', expected: 'true' },
  { file: 'checked-mul3-add1-boundaries.bmec', expected: 'true' },
  { file: 'checked-mul3-add1-overflow-low.bmec', error: 'PIPE-RUNTIME-004' },
  { file: 'checked-mul3-add1-overflow-high.bmec', error: 'PIPE-RUNTIME-004' },
  { file: 'base64-encode.bmec', expected: 'true' },
  { file: 'base64-decode.bmec', expected: 'true' },
  { file: 'text-split-empty-separator.bmec', expected: '1' },
  { file: 'text-split-runtime-error.bmec', error: 'PIPE-RUNTIME-003' },
  { file: 'step-limit-textcontains.bmec', error: 'PIPE-RUNTIME-006' },
  { file: 'text-split-allocation-error.bmec', error: 'PIPE-RUNTIME-007', reference: '1', allocationLimit: 40 },
];
const work = mkdtempSync(join(tmpdir(), 'bmec-native-text-sanitize-'));
const results = [];
try {
  for (const fixture of fixtures) {
    const source = join(root, 'tests', 'native', 'fixtures', fixture.file);
    const compiled = compileFile(source);
    if (compiled.diagnostics.length) throw new Error(`${fixture.file}: ${compiled.diagnostics.map(item => item.message).join('; ')}`);
    injectFixtureWireLiterals(compiled.ir, fixture.recordWireFunctions, executeValue);
    const cPath = join(work, fixture.file.replace(/\.bmec$/, '.c'));
    const executable = join(work, fixture.file.replace(/\.bmec$/, process.platform === 'win32' ? '.exe' : ''));
    writeFileSync(cPath, lowerNativeC(compiled.ir), 'utf8');
    const buildFlags = fixture.allocationLimit ? [`-DBMEC_NATIVE_ARENA_LIMIT=${fixture.allocationLimit}`] : [];
    const build = spawnSync(compiler, [...flags, ...buildFlags, cPath, '-o', executable], { encoding: 'utf8', windowsHide: true });
    if (build.error || build.status !== 0) throw new Error(`${fixture.file}: sanitizer compilation failed: ${build.stderr || build.error?.message}`);
    let reference, referenceError;
    try { reference = String(executeValue(compiled.ir.functions, 'main', [])); }
    catch (error) { if (error instanceof PipeRuntimeError) referenceError = error.code; else throw error; }
    const native = spawnSync(executable, [], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=1:halt_on_error=1', UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1' },
    });
    if (native.error) throw native.error;
    const nativeError = /PIPE-[A-Z0-9-]+/.exec(native.stderr)?.[0];
    const clean = !/AddressSanitizer|UndefinedBehaviorSanitizer|LeakSanitizer|runtime error:/.test(native.stderr);
    const passed = fixture.error
      ? (fixture.reference !== undefined ? reference === fixture.reference && referenceError === undefined : referenceError === fixture.error) && nativeError === fixture.error && native.status === 70 && clean
      : reference === fixture.expected && native.status === 0 && native.stdout.trim() === fixture.expected && clean;
    results.push({ fixture: fixture.file, expected: fixture.error ?? fixture.expected, allocationLimit: fixture.allocationLimit, reference: referenceError ?? reference, native: nativeError ?? native.stdout.trim(), exitCode: native.status, sanitizerClean: clean, passed });
    if (!passed) throw new Error(`${fixture.file}: sanitizer mismatch ${JSON.stringify(results.at(-1))}\n${native.stderr}`);
  }
} finally { rmSync(work, { recursive: true, force: true }); }

const output = {
  version: 1,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: `${process.platform} ${process.arch}`,
  compiler,
  compilerVersion: version,
  flags,
  cases: results.length,
  passed: results.filter(item => item.passed).length,
  results,
};
const destination = process.env.BMEC_NATIVE_TEXT_SANITIZER_OUTPUT;
if (destination) writeFileSync(resolve(destination), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
