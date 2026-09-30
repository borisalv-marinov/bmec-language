#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, compileFile } from '../dist/compiler.js';
import { executeAsyncValue, publicValue } from '../dist/core/interpreter.js';
import { buildNative } from '../dist/native/build.js';
import { issueCapability } from '../dist/runtime/capabilities.js';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourcePath = join(projectRoot, 'examples', 'log-analyzer', 'main.bmec');
const compiled = compileFile(sourcePath);
if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join('\n'));
const work = mkdtempSync(join(tmpdir(), 'bmec-native-filesystem-diff-'));
const root = join(work, 'root Привет');
const outside = join(work, 'outside');
mkdirSync(root);
mkdirSync(outside);
mkdirSync(join(root, 'nested'));
const input = 'input.log';
const output = 'summary.log';
const text = 'INFO start\nERROR unicode Привет\nERROR failed "quoted"\nWARN done\n';
writeFileSync(join(root, input), text, 'utf8');
writeFileSync(join(root, 'no-errors.log'), 'INFO start\nWARN done', 'utf8');
writeFileSync(join(root, 'nested', 'input.log'), 'ERROR nested\n', 'utf8');
writeFileSync(join(root, 'unicode Привет.log'), 'ERROR unicode path\n', 'utf8');
writeFileSync(join(root, 'invalid-utf8.log'), Buffer.from([0x45, 0x52, 0x52, 0x4f, 0x52, 0x20, 0xff, 0x0a]));
writeFileSync(join(outside, 'secret.log'), 'ERROR outside\n', 'utf8');
symlinkSync(outside, join(root, 'leak'), process.platform === 'win32' ? 'junction' : 'dir');

const outputDirectory = join(work, 'build');
const built = buildNative(compiled.ir, { outputDirectory, entry: 'summarize' });
const cases = [
  { name: 'read-filter-write-unicode', input, expectedOutput: 'ERROR failed "quoted"\nERROR unicode Привет' },
  { name: 'nested-relative-path', input: 'nested/input.log', output: 'nested/summary.log', expectedOutput: 'ERROR nested' },
  { name: 'unicode-relative-path', input: 'unicode Привет.log', expectedOutput: 'ERROR unicode path' },
  { name: 'dot-path-is-not-a-file', input: 'nested/.', expectedState: 'err', expectedError: 'read_failed' },
  { name: 'fold-zero-errors', input: 'no-errors.log', expectedBoolean: false, expectedOutput: '' },
  { name: 'overwrite-existing-file', input, output: 'summary.log', preexistingOutput: 'old summary\n', expectedOutput: 'ERROR failed "quoted"\nERROR unicode Привет' },
  { name: 'missing-input', input: 'absent.log', expectedState: 'err', expectedError: 'not_found' },
  { name: 'parent-traversal', input: '../outside/secret.log', expectedState: 'err', expectedError: 'path_outside_root' },
  { name: 'absolute-path', input: join(outside, 'secret.log'), expectedState: 'err', expectedError: 'path_outside_root' },
  { name: 'missing-output-parent', input, output: 'absent/output.log', expectedState: 'err', expectedError: 'not_found' },
  { name: 'junction-or-symlink-escape', input: 'leak/secret.log', expectedState: 'err', expectedError: 'path_outside_root' },
  { name: 'write-through-junction-escape', input, output: 'leak/secret.log', expectedState: 'err', expectedError: 'path_outside_root', expectedOutsideContents: 'ERROR outside\n' },
  { name: 'malformed-utf8', input: 'invalid-utf8.log', expectedState: 'err', expectedError: 'invalid_utf8' },
];
const results = [];
try {
  for (const item of cases) {
    const outputArgument = item.output ?? output;
    const targetOutput = join(root, outputArgument);
    if (item.preexistingOutput !== undefined) writeFileSync(targetOutput, item.preexistingOutput, 'utf8');
    else rmSync(targetOutput, { force: true });
    const reference = publicValue(await executeAsyncValue(
      compiled.ir.functions,
      'summarize',
      [issueCapability('filesystem'), item.input, outputArgument],
      { filesystemRoot: root },
    ));
    if (item.expectedOutsideContents !== undefined) writeFileSync(join(outside, 'secret.log'), item.expectedOutsideContents, 'utf8');
    const native = spawnSync(built.executable, ['--fs-root', root, item.input, outputArgument], { encoding: 'utf8', windowsHide: true });
    if (native.error) throw native.error;
    let nativeValue;
    try { nativeValue = JSON.parse(native.stdout); }
    catch { throw new Error(`${item.name}: native stdout was not Result JSON: ${native.stdout} ${native.stderr}`); }
    const referenceParity = JSON.stringify(nativeValue) === JSON.stringify(reference);
    const expectedValue = item.expectedState === 'err'
      ? { state: 'err', error: item.expectedError }
      : { state: 'ok', value: item.expectedBoolean ?? true };
    const outputContents = nativeValue.state === 'ok' ? readFileSync(targetOutput, 'utf8') : undefined;
    const outsideContents = item.expectedOutsideContents === undefined ? undefined : readFileSync(join(outside, 'secret.log'), 'utf8');
    const passed = referenceParity && JSON.stringify(reference) === JSON.stringify(expectedValue) && JSON.stringify(nativeValue) === JSON.stringify(expectedValue) && native.status === 0 &&
      (item.expectedOutput === undefined || outputContents === item.expectedOutput) &&
      (item.expectedOutsideContents === undefined || outsideContents === item.expectedOutsideContents);
    results.push({
      case: item.name,
      reference,
      native: nativeValue,
      referenceParity: referenceParity ? 'match' : 'mismatch',
      outputContents,
      outputMatches: item.expectedOutput === undefined ? undefined : outputContents === item.expectedOutput,
      outsideContents,
      outsideUnchanged: item.expectedOutsideContents === undefined ? undefined : outsideContents === item.expectedOutsideContents,
      exitCode: native.status,
      passed,
    });
    if (!passed) throw new Error(`${item.name}: differential mismatch ${JSON.stringify(results.at(-1))}`);
  }

  const textReader = compile(`app NativeTextResult
    function read(fs capability<filesystem>, path text) -> result<text,text> {
      return readTextFile(fs, path)
    }`);
  if (textReader.diagnostics.length) throw new Error(textReader.diagnostics.map(item => item.message).join('\n'));
  const textBuild = buildNative(textReader.ir, { outputDirectory: join(work, 'text-build'), entry: 'read' });
  const jsonText = 'quote " slash \\ tab\t line\nUnicode Привет';
  writeFileSync(join(root, 'json.log'), jsonText, 'utf8');
  const textReference = publicValue(await executeAsyncValue(
    textReader.ir.functions,
    'read',
    [issueCapability('filesystem'), 'json.log'],
    { filesystemRoot: root },
  ));
  const textNative = spawnSync(textBuild.executable, ['--fs-root', root, 'json.log'], { encoding: 'utf8', windowsHide: true });
  if (textNative.error) throw textNative.error;
  let textNativeValue;
  try { textNativeValue = JSON.parse(textNative.stdout); }
  catch { throw new Error(`text-result-json-escaping: invalid native JSON ${textNative.stdout} ${textNative.stderr}`); }
  const textPassed = textNative.status === 0 && JSON.stringify(textNativeValue) === JSON.stringify(textReference) &&
    textReference.state === 'ok' && textReference.value === jsonText;
  results.push({
    case: 'text-result-json-escaping',
    reference: textReference,
    native: textNativeValue,
    referenceParity: JSON.stringify(textNativeValue) === JSON.stringify(textReference) ? 'match' : 'mismatch',
    exitCode: textNative.status,
    passed: textPassed,
  });
  if (!textPassed) throw new Error(`text-result-json-escaping: differential mismatch ${JSON.stringify(results.at(-1))}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const evidence = {
  version: 1,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
  platform: `${process.platform} ${process.arch}`,
  compiler: built.compilerVersion,
  cases: results.length,
  passed: results.filter(item => item.passed).length,
  results,
};
const evidenceName = process.platform === 'win32' ? 'bmec-0.7-native-filesystem-differential-windows-msvc.json' : 'bmec-0.7-native-filesystem-differential-linux.json';
writeFileSync(join(projectRoot, 'docs', 'evidence', evidenceName), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
