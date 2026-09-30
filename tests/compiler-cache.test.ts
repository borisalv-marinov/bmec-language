import {describe,expect,it} from 'vitest';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {compileFileCached} from '../src/cli/cache.js';
import {execFileSync} from 'node:child_process';

describe('BMEC content-hash compiler cache',()=>{
 it('reuses valid results and invalidates when source changes',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-cache-'));mkdirSync(join(root,'.bmec'));
  const file=join(root,'main.bmec');writeFileSync(file,'app Demo\nmodel Item { name text required }\n');
  const first=compileFileCached(file);expect(first.hit).toBe(false);expect(first.result.diagnostics).toEqual([]);
  const cache=join(root,'.bmec','check-cache.json');expect(JSON.parse(readFileSync(cache,'utf8')).version).toBe(1);
  const second=compileFileCached(file);expect(second.hit).toBe(true);expect(second.result.ir).toEqual(first.result.ir);
  expect(execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'check',file,'--cache'],{encoding:'utf8'})).toContain('OK');
  writeFileSync(file,'app Demo\nmodel Item { name integer required }\n');
  const third=compileFileCached(file);expect(third.hit).toBe(false);expect(third.result.diagnostics).toEqual([]);
  writeFileSync(join(root,'bmec.toml'),'[package]\nname = "demo"\nversion = "0.1.0"\nlanguage = "0.1"\nentry = "main.bmec"\n');
  const fourth=compileFileCached(file);expect(fourth.hit).toBe(false);
  const fifth=compileFileCached(file);expect(fifth.hit).toBe(true);
  writeFileSync(join(root,'bmec.lock'),'{}');
  expect(compileFileCached(file).hit).toBe(false);
 });
 it('invalidates a cached imported-module syntax failure when that module is repaired',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-cache-import-'));const file=join(root,'main.bmec');const imported=join(root,'broken.bmec');
  writeFileSync(file,'import { value } from "./broken.bmec"\napp Demo\n');writeFileSync(imported,'crud Missing');
  const first=compileFileCached(file);expect(first.hit).toBe(false);expect(first.result.diagnostics.map(diagnostic=>diagnostic.code)).toContain('PIPE-SYN-005');
  expect(compileFileCached(file).hit).toBe(true);
  writeFileSync(imported,'public function value() -> integer { return 1 }');
  const repaired=compileFileCached(file);expect(repaired.hit).toBe(false);expect(repaired.result.diagnostics).toEqual([]);
 });
 it('keeps CLI JSON results identical between cached and uncached checks',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-cache-json-'));const file=join(root,'main.bmec');const cli=join(process.cwd(),'dist','cli','index.js');
  const failed=(args:string[])=>{try{execFileSync(process.execPath,[cli,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});throw new Error('check unexpectedly passed')}catch(error){return JSON.parse(String((error as {stderr?:unknown}).stderr))}};
  writeFileSync(file,'app Demo\nmodel Item { name text required }\n');
  expect(JSON.parse(execFileSync(process.execPath,[cli,'check',file,'--json'],{encoding:'utf8'}))).toEqual(JSON.parse(execFileSync(process.execPath,[cli,'check',file,'--json','--cache'],{encoding:'utf8'})));
  writeFileSync(file,'crud Missing');
  const uncached=failed(['check',file,'--json']);const cached=failed(['check',file,'--json','--cache']);
  expect(cached).toEqual(uncached);
 });
});
