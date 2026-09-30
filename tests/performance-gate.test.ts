import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})});

const runGate=(sqliteCrud:{p50Ms:number;p95Ms:number})=>{
 const root=mkdtempSync(join(tmpdir(),'bmec-performance-gate-'));roots.push(root);
 const baseline={
  compilerWarmCheck:{p95Ms:1},parser:{p95Ms:1},semanticAnalysis:{p95Ms:1},interpreter:{p95Ms:1},releaseBuild:{p95Ms:1},http:{p95Ms:1},
  sqliteCrud:{p50Ms:0.128,p95Ms:0.151},postgresCrud:{p95Ms:1},browserBundleBytes:{appJs:1000},
 };
 const result={
  compilerWarmCheck:{p95Ms:1},parser:{p95Ms:1},semanticAnalysis:{p95Ms:1},interpreter:{p95Ms:1},releaseBuild:{p95Ms:1},http:{p95Ms:1},
  sqliteCrud,postgresCrud:{p95Ms:1},browserBundleBytes:{appJs:1000},
 };
 const baselineFile=join(root,'baseline.json'),resultFile=join(root,'result.json');
 writeFileSync(baselineFile,JSON.stringify(baseline));writeFileSync(resultFile,JSON.stringify(result));
 return spawnSync(process.execPath,[resolve('scripts/performance-gate.mjs'),resultFile,baselineFile],{encoding:'utf8'});
};

describe('performance regression gate',()=>{
 it('does not fail SQLite CRUD on an isolated p95 scheduler outlier',()=>{
  const result=runGate({p50Ms:0.122,p95Ms:1.953});
  expect(result.status).toBe(0);expect(result.stdout).toContain('BMEC performance gate: PASS');
 });
 it('fails when the SQLite CRUD median shows a sustained regression',()=>{
  const result=runGate({p50Ms:0.5,p95Ms:0.6});
  expect(result.status).toBe(1);expect(result.stderr).toContain('SQLite CRUD: p50Ms 0.5ms exceeds 3x baseline 0.128ms');
 });
});
