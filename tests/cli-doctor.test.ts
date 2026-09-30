import {describe,expect,it} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const cli=join(process.cwd(),'dist','cli','index.js');

describe('BMEC doctor command',()=>{
 it('reports the local toolchain and a generated project without modifying it',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-doctor-'));
  const project=join(root,'sample');
  execFileSync(process.execPath,[cli,'new',project],{encoding:'utf8'});
  const lockPath=join(project,'bmec.lock'),before=readFileSync(lockPath,'utf8');
  const result=JSON.parse(execFileSync(process.execPath,[cli,'doctor',project,'--json'],{encoding:'utf8'}));
  expect(result).toMatchObject({schemaVersion:'bmec.doctor.v1',status:'pass'});
  expect(result.checks).toEqual(expect.arrayContaining([
   expect.objectContaining({name:'Node.js',status:'pass'}),
   expect.objectContaining({name:'SQLite runtime',status:'pass'}),
   expect.objectContaining({name:'Project manifest',status:'pass'}),
   expect.objectContaining({name:'Package lock',status:'pass'}),
   expect.objectContaining({name:'Source project',status:'pass'}),
  ]));
  expect(readFileSync(lockPath,'utf8')).toBe(before);
 });

 it('reports missing project entries with a failing exit code and a repair hint',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-doctor-missing-'));
  const project=join(root,'sample');
  execFileSync(process.execPath,[cli,'new',project],{encoding:'utf8'});
  unlinkSync(join(project,'main.bmec'));
  const result=spawnSync(process.execPath,[cli,'doctor',project,'--json'],{encoding:'utf8'});
  const report=JSON.parse(result.stdout);
  expect(result.status).toBe(1);
  expect(report.status).toBe('fail');
  expect(report.checks).toContainEqual(expect.objectContaining({name:'Project entry',status:'fail',action:expect.stringContaining('correct the package entry')}));
 });

 it('checks a source file directly when no package manifest exists',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-doctor-source-'));
  const source=join(root,'main.bmec');
  writeFileSync(source,'app Demo\npage Home {}\n');
  const report=JSON.parse(execFileSync(process.execPath,[cli,'doctor',source,'--json'],{encoding:'utf8'}));
  expect(report.status).toBe('warn');
  expect(report.checks).toContainEqual(expect.objectContaining({name:'Source project',status:'pass'}));
 });

 it('fails clearly when the requested project path does not exist',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-doctor-path-'));
  const result=spawnSync(process.execPath,[cli,'doctor',join(root,'missing'),'--json'],{encoding:'utf8'});
  const report=JSON.parse(result.stdout);
  expect(result.status).toBe(1);
  expect(report.checks).toContainEqual(expect.objectContaining({name:'Selected path',status:'fail',action:expect.stringContaining('Check the path')}));
 });
});
