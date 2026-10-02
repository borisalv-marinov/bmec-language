import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})});

const fixture=()=>({
 compilerWarmCheck:{p95Ms:1},parser:{p95Ms:1},semanticAnalysis:{p95Ms:1},interpreter:{p95Ms:1},releaseBuild:{p95Ms:1},http:{p95Ms:1},
 sqliteCrud:{p50Ms:0.128,p95Ms:0.151},postgresCrud:{p95Ms:1},browserBundleBytes:{appJs:1000},
});
const runGate=(edit?:(result:Record<string,any>,baseline:Record<string,any>)=>void, rawResult?:string, rawBaseline?:string)=>{
 const root=mkdtempSync(join(tmpdir(),'bmec-performance-gate-'));roots.push(root);
 const baseline=fixture(),result=fixture();
 edit?.(result,baseline);
 const baselineFile=join(root,'baseline.json'),resultFile=join(root,'result.json');
 writeFileSync(baselineFile,rawBaseline??JSON.stringify(baseline));writeFileSync(resultFile,rawResult??JSON.stringify(result));
 return spawnSync(process.execPath,[resolve('scripts/performance-gate.mjs'),resultFile,baselineFile],{encoding:'utf8'});
};

describe('performance regression gate',()=>{
 it('does not fail SQLite CRUD on an isolated p95 scheduler outlier',()=>{
  const result=runGate(result=>{result.sqliteCrud={p50Ms:0.122,p95Ms:1.953}});
  expect(result.status).toBe(0);expect(result.stdout).toContain('BMEC performance gate: PASS');
 });
 it('fails when the SQLite CRUD median shows a sustained regression',()=>{
  const result=runGate(result=>{result.sqliteCrud={p50Ms:0.5,p95Ms:0.6}});
  expect(result.status).toBe(1);expect(result.stderr).toContain('SQLite CRUD: p50Ms 0.5ms exceeds 3x baseline 0.128ms');
 });
 it('rejects malformed, missing, and non-object JSON inputs',()=>{
  expect(runGate(undefined,'{')).toMatchObject({status:1});
  expect(runGate(undefined,'[]').stderr).toContain('result: expected a JSON object');
  expect(runGate(undefined,undefined,'null').stderr).toContain('baseline: expected a JSON object');
 });
 it('rejects each required timing measurement when missing',()=>{
  const result=runGate(value=>{delete value.http.p95Ms});
  expect(result.status).toBe(1);expect(result.stderr).toContain('HTTP: missing or invalid p95Ms measurement');
 });
 it.each([Number.NaN,Number.POSITIVE_INFINITY,-1])('rejects invalid timings (%s)',timing=>{
  const result=runGate(value=>{value.interpreter.p95Ms=timing});
  expect(result.status).toBe(1);expect(result.stderr).toContain('interpreter: p95Ms must be a finite non-negative number');
 });
 it('rejects malformed baseline measurements and invalid timing fields',()=>{
  const result=runGate((_value,baseline)=>{baseline.parser={p95Ms:-0.1}});
  expect(result.status).toBe(1);expect(result.stderr).toContain('parser baseline: p95Ms must be a finite non-negative number');
  const missing=runGate((_value,baseline)=>{delete baseline.releaseBuild});
  expect(missing.stderr).toContain('release build: missing or invalid baseline measurement object');
 });
 it.each([0,-1,1.5,Number.NaN,Number.POSITIVE_INFINITY])('rejects invalid browser bundle byte sizes (%s)',size=>{
  const result=runGate(value=>{value.browserBundleBytes.appJs=size});
  expect(result.status).toBe(1);expect(result.stderr).toContain('browser bundle: appJs must be a positive finite integer byte size');
 });
 it('requires valid result and baseline app.js bundle sizes',()=>{
  const result=runGate(value=>{delete value.browserBundleBytes.appJs});
  expect(result.stderr).toContain('browser bundle: missing appJs byte size');
  const baseline=runGate((_value,base)=>{base.browserBundleBytes.appJs=0});
  expect(baseline.stderr).toContain('browser bundle baseline: appJs must be a positive finite integer byte size');
 });
 it('still enforces the bundle regression threshold',()=>{
  const result=runGate(value=>{value.browserBundleBytes.appJs=1251});
  expect(result.status).toBe(1);expect(result.stderr).toContain('browser app.js: 1251 bytes exceeds 125% baseline 1000 bytes');
 });
 it('requires PostgreSQL measurements and rejects malformed objects',()=>{
  const missing=runGate(value=>{delete value.postgresCrud});
  expect(missing.stderr).toContain('PostgreSQL CRUD: required for the full performance gate');
  const malformed=runGate(value=>{value.postgresCrud=[]});
  expect(malformed.stderr).toContain('PostgreSQL CRUD: required for the full performance gate');
 });
});
