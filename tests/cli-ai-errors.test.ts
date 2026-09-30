import {describe,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

describe('CLI AI error contracts',()=>{
 it('exposes the versioned global capability inventory without a source file',()=>{
  const cli=join(process.cwd(),'dist','cli','index.js');const output=JSON.parse(execFileSync(process.execPath,[cli,'capabilities','--json'],{encoding:'utf8'}));
  expect(output.version).toBe('bmec.capabilities.v1');
  expect(output.capabilities.map((item:{name:string})=>item.name)).toEqual(['http','database','environment','time','random','secureRandom','filesystem','email']);
  expect(output.capabilities.find((item:{name:string})=>item.name==='random').stdlib).toEqual(expect.arrayContaining(['randomId','randomNumber']));
 });
 it('reports missing graph nodes as structured JSON errors',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-ai-error-'));const file=join(root,'main.bmec');const cli=join(process.cwd(),'dist','cli','index.js');
  writeFileSync(file,'app Demo\nmodel Item {}\n');let stderr='';
  try{execFileSync(process.execPath,[cli,'inspect','DB-999',file,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});throw new Error('inspect unexpectedly passed')}catch(error){stderr=String((error as {stderr?:unknown}).stderr)}
  expect(JSON.parse(stderr)).toMatchObject({ok:false,diagnostics:[{code:'PIPE-AI-001',expected:'a canonical graph node ID',received:'DB-999'}]});
  stderr='';
  try{execFileSync(process.execPath,[cli,'affected','DB-999',file,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});throw new Error('affected unexpectedly passed')}catch(error){stderr=String((error as {stderr?:unknown}).stderr)}
 expect(JSON.parse(stderr)).toMatchObject({ok:false,diagnostics:[{code:'PIPE-AI-001',expected:'a canonical graph node ID',received:'DB-999'}]});
 });
 it('returns structured compiler diagnostics for JSON introspection commands',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-ai-json-error-'));const file=join(root,'main.bmec');const cli=join(process.cwd(),'dist','cli','index.js');
  writeFileSync(file,'app Demo\nstyle glow\n');
  for(const command of ['project','symbols','types','models','routes','pages','styles','capabilities','expand','graph','ir']){
   try{execFileSync(process.execPath,[cli,command,file,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});throw new Error(`${command} unexpectedly passed`)}catch(error){
    expect(JSON.parse(String((error as {stderr?:unknown}).stderr))).toMatchObject({schemaVersion:'bmec.diagnostics.v1',languageVersion:'0.1',ok:false,diagnostics:[expect.objectContaining({code:'PIPE-STYLE-001',file,kind:'style_value'})]});
   }
  }
 });
 it('preserves repair, related, suggestion, expected, and actual fields',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-ai-diagnostic-fields-'));const cli=join(process.cwd(),'dist','cli','index.js');
  const main=join(root,'main.bmec');const lib=join(root,'lib.bmec');
  writeFileSync(lib,'function hidden() -> integer { return 1 }');
  writeFileSync(main,'import { hidden } from "./lib.bmec"\nfunction main() -> integer { return hidden() }');
  let stderr='';
  try{execFileSync(process.execPath,[cli,'check',main,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});throw new Error('missing-export source unexpectedly passed')}catch(error){stderr=String((error as {stderr?:unknown}).stderr)}
  const missingExport=JSON.parse(stderr);const missingDiagnostic=missingExport.diagnostics[0];
  expect(missingDiagnostic).toMatchObject({code:'PIPE-MOD-007',repair:{type:'visibility'}});
  expect(missingDiagnostic.suggestions).toEqual(expect.arrayContaining([expect.stringContaining('public')]));
  expect(missingDiagnostic.related).toEqual(expect.arrayContaining([expect.objectContaining({message:expect.stringContaining('lib.bmec'),span:expect.any(Object)})]));
  writeFileSync(main,'function main() -> integer { return "wrong" }');stderr='';
  try{execFileSync(process.execPath,[cli,'check',main,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});throw new Error('type-invalid source unexpectedly passed')}catch(error){stderr=String((error as {stderr?:unknown}).stderr)}
  expect(JSON.parse(stderr)).toMatchObject({ok:false,diagnostics:[expect.objectContaining({code:'PIPE-FUNC-006',expected:'integer',actual:'text'})]});
 });
 it('keeps required diagnostic fields across syntax, semantic, module, and package failures',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-ai-diagnostic-schema-'));const file=join(root,'main.bmec');const cli=join(process.cwd(),'dist','cli','index.js');
  const check=(source:string)=>{
   writeFileSync(file,source);let stderr='';
   try{execFileSync(process.execPath,[cli,'check',file,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});throw new Error('invalid source unexpectedly passed')}catch(error){stderr=String((error as {stderr?:unknown}).stderr)}
   const payload=JSON.parse(stderr) as {ok:boolean;diagnostics:Array<Record<string,any>>};
   expect(payload).toMatchObject({ok:false});
   expect(payload.diagnostics.length).toBeGreaterThan(0);
   for(const diagnostic of payload.diagnostics){
    expect(diagnostic).toEqual(expect.objectContaining({code:expect.any(String),severity:expect.any(String),message:expect.any(String),file:expect.any(String),line:expect.any(Number),column:expect.any(Number),span:expect.objectContaining({start:expect.objectContaining({file:expect.any(String),line:expect.any(Number),column:expect.any(Number),offset:expect.any(Number)}),end:expect.objectContaining({file:expect.any(String),line:expect.any(Number),column:expect.any(Number),offset:expect.any(Number)})})}));
   }
   return payload;
  };
  check('crud Task');
  check('function main() -> integer { return "wrong" }');
  writeFileSync(join(root,'lib.bmec'),'function hidden() -> integer { return 1 }');
  const moduleFailure=check('import { hidden } from "./lib.bmec"\nfunction main() -> integer { return hidden() }');
  expect(moduleFailure.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({repair:expect.objectContaining({type:'visibility'}),related:expect.any(Array)})]));
  writeFileSync(join(root,'bmec.toml'),'[package]\nname = "demo"\nversion = "0.1.0"\nlanguage = "0.1"\nentry = "main.bmec"\n[dependencies]\nmissing = "./missing"\n');
  expect(check('app Demo').diagnostics.map(diagnostic=>diagnostic.code)).toContain('PIPE-PKG-011');
 });
});
