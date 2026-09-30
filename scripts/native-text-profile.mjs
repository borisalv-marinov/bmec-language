#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { compile } from '../dist/compiler.js';
import { executeValue } from '../dist/core/interpreter.js';
import { lowerNativeC } from '../dist/native/codegen.js';

if (process.platform !== 'linux') throw new Error('Native text profiling currently requires Linux `/usr/bin/time`.');
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const compiler = process.env.BMEC_CC || 'gcc';
const compilerVersion = execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split(/\r?\n/, 1)[0].trim();
const flags = ['-O3', '-std=c11', '-DBMEC_NATIVE_ARENA_METRICS'];
const temp = mkdtempSync(join(tmpdir(), 'bmec-native-text-profile-'));
const results = [];
try {
  for (const count of [64, 4096, 32768]) {
    for (const filtered of [false, true]) {
      const data = Array.from({ length: count }, (_, index) => `${filtered && index % 2 === 0 ? 'ERROR' : 'INFO'} entry-${String(index).padStart(5, '0')}`).join('|');
      const predicate = filtered
        ? 'let selected = filter(pieces, lambda(line text) -> boolean { return textContains(line, "ERROR") })'
        : 'let selected = pieces';
      const needle = filtered ? 'ERROR entry-00000,ERROR entry-00002' : 'INFO entry-00000,INFO entry-00001';
      const source = `function main() -> integer {\n  let pieces = split(${JSON.stringify(data)}, "|")\n  ${predicate}\n  let joined = join(selected, ",")\n  var seen integer = 0\n  for piece in selected { seen = seen + 1 }\n  if textContains(joined, ${JSON.stringify(needle)}) { return seen } else { return 0 }\n}`;
      const label = `${filtered ? 'filter' : 'split'}-${count}`;
      const compiled = compile(source);
      if (compiled.diagnostics.length) throw new Error(`${label}: ${compiled.diagnostics.map(item => item.message).join('; ')}`);
      const expectedCount = filtered ? count / 2 : count;
      const expected = String(executeValue(compiled.ir.functions, 'main', []));
      if (expected !== String(expectedCount)) throw new Error(`${label}: reference result was ${expected}`);
      const cPath = join(temp, `${label}.c`);
      const executable = join(temp, label);
      const rssPath = join(temp, `${label}.rss`);
      writeFileSync(cPath, lowerNativeC(compiled.ir), 'utf8');
      const build = spawnSync(compiler, [...flags, cPath, '-lm', '-o', executable], { encoding: 'utf8', windowsHide: true });
      if (build.error || build.status !== 0) throw new Error(`${label}: native compile failed: ${build.stderr || build.error?.message}`);
      const started = performance.now();
      const native = spawnSync('/usr/bin/time', ['-f', '%M', '-o', rssPath, executable], { encoding: 'utf8', windowsHide: true });
      const startupAndRunMs = Number((performance.now() - started).toFixed(3));
      if (native.error || native.status !== 0) throw new Error(`${label}: native run failed: ${native.stderr || native.error?.message}`);
      const metrics = /BMEC_NATIVE_ARENA_METRICS allocations=(\d+) allocated_bytes=(\d+) peak_bytes=(\d+)/.exec(native.stderr);
      if (!metrics) throw new Error(`${label}: generated program did not report arena metrics`);
      const rssKiB = Number(readFileSync(rssPath, 'utf8').trim());
      const output = native.stdout.trim();
      const allocationCount = filtered ? 3 : 2;
      const passed = output === expected && Number(metrics[1]) === allocationCount && Number(metrics[2]) === Number(metrics[3]);
      results.push({ workload: filtered ? 'split-filter-join' : 'split-join', itemCount: count, inputBytes: Buffer.byteLength(data), expected, native: output, allocationCount: Number(metrics[1]), allocatedPayloadBytes: Number(metrics[2]), peakLivePayloadBytes: Number(metrics[3]), peakRssKiB: rssKiB, processStartupAndRunMs: startupAndRunMs, passed });
      if (!passed) throw new Error(`${label}: profile mismatch ${JSON.stringify(results.at(-1))}`);
    }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }

const output = {
  version: 1,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: `${process.platform} ${process.arch}`,
  compiler,
  compilerVersion,
  flags: [...flags, '-lm'],
  metrics: 'Cumulative and peak invocation arena payload bytes; peak RSS from /usr/bin/time, KiB.',
  results,
};
const destination = process.env.BMEC_NATIVE_TEXT_PROFILE_OUTPUT;
if (destination) writeFileSync(resolve(destination), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
