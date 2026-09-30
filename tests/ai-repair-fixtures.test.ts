import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterAll,describe,it,expect} from 'vitest';

const root=mkdtempSync(join(tmpdir(),'bmec-ai-repair-'));
const cli=resolve('dist/cli/index.js');
const cases=[
 {id:'wrong-type',codes:['PIPE-FUNC-006'],source:'function value() -> integer { return "wrong" }'},
 {id:'misspelled-symbol',codes:['PIPE-FUNC-007'],source:'function main() -> integer { return calculte(1) }'},
 {id:'invalid-ui-property',codes:['PIPE-STYLE-003'],source:'style named Card { background is chartreuse }'},
 {id:'invalid-route',codes:['PIPE-SYN-005'],source:'function health() -> boolean { return true }\nserve TRACE /health requiring authenticated with health'},
 {id:'invalid-model-relation',codes:['PIPE-TYPE-001'],source:'model Task { owner Usre }'},
 {id:'invalid-capability',codes:['PIPE-FUNC-009'],source:'function read(db capability<database>) -> boolean { return true }\nfunction main(env capability<environment>) -> boolean { return read(env) }'},
 {id:'invalid-database-query',codes:['PIPE-FUNC-009'],source:'model User { active boolean required }\nfunction list(db capability<database>) -> list<User> { return wait for get users from User where active is 1 using db }'},
 {id:'missing-required-value',codes:['PIPE-TYPE-011'],source:'type Person { name text required age integer }\nfunction make() -> Person { return Person { age: 4 } }'},
] as const;
afterAll(()=>rmSync(root,{recursive:true,force:true}));

describe('AI repair discovery fixtures through the public CLI',()=>{
 it.each(cases)('$id produces locatable public diagnostic evidence',fixture=>{
  const file=join(root,`${fixture.id}.bmec`);writeFileSync(file,fixture.source);
  const result=spawnSync(process.execPath,[cli,'check',file,'--json'],{encoding:'utf8'});
  expect(result.status, result.stderr).not.toBe(0);
  let envelope:unknown;
  try{envelope=JSON.parse(result.stderr)}catch{throw new Error(`CLI did not return structured diagnostic JSON: ${result.stderr}`)}
  expect(envelope).toMatchObject({schemaVersion:'bmec.diagnostics.v1',languageVersion:'0.1',ok:false});
  const diagnostics=(envelope as {diagnostics?:Array<Record<string,unknown>>}).diagnostics;
  expect(diagnostics?.map(d=>d.code)).toEqual(expect.arrayContaining(fixture.codes));
  if(fixture.id==='misspelled-symbol'||fixture.id==='invalid-model-relation'){
   expect(diagnostics?.find(d=>d.code==='PIPE-MOD-010')?.repair).toBeUndefined();
  }
  if(fixture.id==='invalid-capability'||fixture.id==='invalid-database-query'){
   const argumentType=diagnostics?.find(d=>d.code==='PIPE-FUNC-009');
   expect(argumentType).toMatchObject({expected:expect.any(String),actual:expect.any(String),received:expect.any(String)});
  }
  if(fixture.id==='invalid-ui-property'||fixture.id==='invalid-route'){
   expect(diagnostics?.[0]).toMatchObject({expected:expect.any(String),received:expect.any(String)});
  }
  const evidence=(diagnostics??[]).map(diagnostic=>({code:diagnostic.code,locatable:Boolean(diagnostic.span),expectedActual:['expected','received','actual'].some(key=>diagnostic[key]!==undefined),repairOffered:diagnostic.repair!==undefined}));
  expect(evidence.every(item=>item.locatable)).toBe(true);
  for(const diagnostic of diagnostics??[]){
   expect(diagnostic).toMatchObject({code:expect.any(String),severity:expect.any(String),message:expect.any(String),file:expect.any(String),line:expect.any(Number),column:expect.any(Number),span:{start:{line:expect.any(Number),column:expect.any(Number)},end:{line:expect.any(Number),column:expect.any(Number)}}});
  }
 });
 it('records the boundary case as unavailable through the CLI contract',()=>{
  const spec=JSON.parse(execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'}));
  expect(spec.commandOptions.check).toEqual(expect.arrayContaining(['--json','--cache']));
  expect(spec.commandUsage.build).toBe('bmec build file.bmec');
 });
 it('offers an import repair only for one known external declaration',()=>{
  const project=join(root,'unique-import');mkdirSync(project);
  writeFileSync(join(project,'main.bmec'),'import { Something } from "./b.bmec"\napp Example\npage Home { crud SecretThing }\n');
  writeFileSync(join(project,'b.bmec'),'import { SecretThing } from "./c.bmec"\nmodel Something {}\n');
  writeFileSync(join(project,'c.bmec'),'model SecretThing { name text }\n');
  const result=spawnSync(process.execPath,[cli,'check',join(project,'main.bmec'),'--json'],{encoding:'utf8'});
  const envelope=JSON.parse(result.stderr) as {diagnostics:Array<Record<string,unknown>>};
  expect(envelope.diagnostics.find(d=>d.code==='PIPE-MOD-010')).toMatchObject({repair:{type:'import',value:'Import SecretThing from "./c.bmec" before use'},related:[{message:expect.stringContaining('Candidate declaration')}]});
 });
});
