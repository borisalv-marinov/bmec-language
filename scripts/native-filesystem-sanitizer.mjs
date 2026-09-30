#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../dist/compiler.js';
import { lowerNativeC } from '../dist/native/codegen.js';

if (process.platform === 'win32') throw new Error('Run the native filesystem sanitizer on Linux; Windows security coverage is in the native filesystem differential gate.');

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const compiler = process.env.BMEC_CC || 'gcc';
const compilerVersion = execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim();
const flags = ['-O1', '-g', '-std=c11', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-lm'];
const compiled = compileFile(join(projectRoot, 'examples', 'log-analyzer', 'main.bmec'));
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));

const work = mkdtempSync(join(tmpdir(), 'bmec-native-filesystem-sanitize-'));
const root = join(work, 'root');
const outside = join(work, 'outside');
mkdirSync(root);
mkdirSync(outside);
const outsideSentinel = 'outside sentinel\n';
writeFileSync(join(root, 'input.log'), 'ERROR safe\n', 'utf8');
writeFileSync(join(root, 'invalid.log'), Buffer.from([0x45, 0x52, 0x52, 0x4f, 0x52, 0xff]));
writeFileSync(join(outside, 'secret.log'), outsideSentinel, 'utf8');
symlinkSync(outside, join(root, 'escape'), 'dir');

const results = [];
try {
  const cPath = join(work, 'filesystem.c');
  const executable = join(work, 'filesystem');
  writeFileSync(cPath, lowerNativeC(compiled.ir, 'summarize'), 'utf8');
  const build = spawnSync(compiler, [...flags, cPath, '-o', executable], { encoding: 'utf8' });
  if (build.error || build.status !== 0) throw new Error(`Sanitizer compilation failed: ${build.stderr || build.error?.message}`);
  const cases = [
    { name: 'read-and-write', input: 'input.log', output: 'summary.log', expected: { state: 'ok', value: true }, outputText: 'ERROR safe' },
    { name: 'missing-file', input: 'missing.log', output: 'summary.log', expected: { state: 'err', error: 'not_found' } },
    { name: 'parent-traversal', input: '../outside/secret.log', output: 'summary.log', expected: { state: 'err', error: 'path_outside_root' } },
    { name: 'symlink-read-escape', input: 'escape/secret.log', output: 'summary.log', expected: { state: 'err', error: 'path_outside_root' } },
    { name: 'symlink-write-escape', input: 'input.log', output: 'escape/secret.log', expected: { state: 'err', error: 'path_outside_root' }, outsideUnchanged: true },
    { name: 'malformed-utf8', input: 'invalid.log', output: 'summary.log', expected: { state: 'err', error: 'invalid_utf8' } },
  ];
  for (const item of cases) {
    if (item.outsideUnchanged) writeFileSync(join(outside, 'secret.log'), outsideSentinel, 'utf8');
    const native = spawnSync(executable, ['--fs-root', root, item.input, item.output], {
      encoding: 'utf8',
      env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=1:halt_on_error=1', UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1' },
    });
    if (native.error) throw native.error;
    let value;
    try { value = JSON.parse(native.stdout); } catch { throw new Error(`${item.name}: invalid native JSON output: ${native.stdout} ${native.stderr}`); }
    const clean = !/AddressSanitizer|UndefinedBehaviorSanitizer|LeakSanitizer|runtime error:/.test(native.stderr);
    const outputText = item.outputText === undefined ? undefined : readFileSync(join(root, item.output), 'utf8');
    const outsideText = item.outsideUnchanged ? readFileSync(join(outside, 'secret.log'), 'utf8') : undefined;
    const passed = native.status === 0 && JSON.stringify(value) === JSON.stringify(item.expected) && clean &&
      (item.outputText === undefined || outputText === item.outputText) &&
      (!item.outsideUnchanged || outsideText === outsideSentinel);
    results.push({ case: item.name, expected: item.expected, native: value, exitCode: native.status, sanitizerClean: clean, outputMatches: item.outputText === undefined ? undefined : outputText === item.outputText, outsideUnchanged: item.outsideUnchanged ? outsideText === outsideSentinel : undefined, passed });
    if (!passed) throw new Error(`${item.name}: sanitizer mismatch ${JSON.stringify(results.at(-1))}\n${native.stderr}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const evidence = {
  version: 1,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
  platform: `${process.platform} ${process.arch}`,
  compiler,
  compilerVersion,
  flags,
  cases: results.length,
  passed: results.filter(result => result.passed).length,
  results,
};
const evidencePath = join(projectRoot, 'docs', 'evidence', 'bmec-0.5-native-filesystem-sanitizer-linux.json');
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
