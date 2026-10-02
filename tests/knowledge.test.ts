import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createKnowledgeContext, createKnowledgeIndex } from '../src/cli/knowledge.js';
import { PUBLIC_STDLIB_CONTRACTS } from '../src/stdlib/stdlib.js';
import { describe, expect, it } from 'vitest';

const examples=JSON.parse(readFileSync('ai/examples.json','utf8'));
const diagnostics=JSON.parse(readFileSync('ai/diagnostics.json','utf8'));
const index=createKnowledgeIndex({examples,diagnostics},'0.9.1-beta.3');

describe('BMEC task knowledge',()=>{
 it('finds stable cursor pagination metadata for an unfamiliar orders task',()=>{
  const result=createKnowledgeContext('paginate orders',index);
  expect(result.schemaVersion).toBe('bmec.knowledge-context.v1');
  expect(result.relevant_symbols[0]).toMatchObject({id:'DB-CURSOR-001',name:'server-side keyset pagination'});
  expect(result.syntax.some(value=>value.includes('ordered by'))).toBe(true);
  expect(result.limitations.join(' ')).toContain('composite cursor support is not provided');
  expect(result.diagnostics).toContainEqual({code:'PIPE-MODEL',category:'data models'});
  expect(result.diagnostic_guidance.join(' ')).toContain('mismatched cursor types');
  expect(result.examples.length).toBeGreaterThan(0);
 });
 it('finds capability-gated standard-library functions and HTTP contracts',()=>{
  const result=createKnowledgeContext('send email',index);
  expect(result.relevant_symbols[0]).toMatchObject({id:'STDLIB-sendEmail',effects:['email']});
  expect(result.relevant_symbols[0]!.types).toContain('capability<email>');
  expect(createKnowledgeContext('authenticated route',index).relevant_symbols.map(symbol=>symbol.id)).toContain('HTTP-ROUTE-001');
 });
 it('covers every public standard-library function in its searchable index and stays bounded per task',()=>{
  expect(index.symbols.filter(symbol=>symbol.kind==='stdlib')).toHaveLength(PUBLIC_STDLIB_CONTRACTS.length);
  const result=createKnowledgeContext('responsive card',index);
  expect(result.relevant_symbols.length).toBeLessThanOrEqual(6);
  expect(result.examples.length).toBeLessThanOrEqual(3);
  expect(JSON.stringify(result).length).toBeLessThan(16000);
  expect(result.version).toEqual({package:'0.9.1-beta.3',language:'0.1',compatibility:'0.1-alpha'});
 });
 it('returns a deterministic machine-readable CLI context pack',()=>{
  const cli='dist/cli/index.js';
  const first=execFileSync(process.execPath,[cli,'knowledge','transaction rollback','--json'],{encoding:'utf8'});
  expect(execFileSync(process.execPath,[cli,'knowledge','transaction rollback','--json'],{encoding:'utf8'})).toBe(first);
  const result=JSON.parse(first);
  expect(result).toMatchObject({schemaVersion:'bmec.knowledge-context.v1',task:'transaction rollback',version:{package:'0.9.1-beta.3',language:'0.1'}});
  expect(result.relevant_symbols.map((symbol:{name:string})=>symbol.name).join(' ').toLocaleLowerCase()).toContain('transaction');
 });
 it('filters by category before applying the result limit and keeps local-auth workflows discoverable',()=>{
  const query='configured local authenticated users owner scoped CRUD workflow';
  const direct=createKnowledgeContext(query,index,{category:'workflow',limit:1});
  expect(direct.relevant_symbols).toHaveLength(1);
  expect(direct.relevant_symbols[0]).toMatchObject({id:'WORKFLOW-LOCAL-AUTH-CONFIGURED-USERS',kind:'workflow'});
  expect(direct.examples).toEqual([]);
  const cli='dist/cli/index.js';
  const knowledge=JSON.parse(execFileSync(process.execPath,[cli,'knowledge',query,'--json','--category','workflow','--limit','1'],{encoding:'utf8'}));
  const ai=JSON.parse(execFileSync(process.execPath,[cli,'ai','context',query,'--json','--category','workflow','--limit','1'],{encoding:'utf8'}));
  expect(knowledge.relevant_symbols).toHaveLength(1);
  expect(knowledge.relevant_symbols[0]).toMatchObject({id:'WORKFLOW-LOCAL-AUTH-CONFIGURED-USERS',kind:'workflow'});
  expect(ai).toMatchObject({schemaVersion:'bmec.ai-task-context.v1',task:query,knowledge:{relevant_symbols:[expect.objectContaining({id:'WORKFLOW-LOCAL-AUTH-CONFIGURED-USERS',kind:'workflow'})]}});
  expect(ai.knowledge.relevant_symbols).toHaveLength(1);
  const authQuery='configured local authenticated users';
  const authKnowledge=JSON.parse(execFileSync(process.execPath,[cli,'knowledge',authQuery,'--json','--limit','1'],{encoding:'utf8'}));
  const authAi=JSON.parse(execFileSync(process.execPath,[cli,'ai','context',authQuery,'--json','--limit','1'],{encoding:'utf8'}));
  expect(authKnowledge.relevant_symbols[0]).toMatchObject({id:'WORKFLOW-LOCAL-AUTH-CONFIGURED-USERS',kind:'workflow'});
  expect(authAi.knowledge.relevant_symbols[0]).toMatchObject({id:'WORKFLOW-LOCAL-AUTH-CONFIGURED-USERS',kind:'workflow'});
 });
 it('runs the documented generic starter recipe from an empty directory',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-public-starter-recipe-'));
  const cli=join(process.cwd(),'dist/cli/index.js');
  let child:ReturnType<typeof spawn>|undefined;
  try{
   expect(execFileSync(process.execPath,[cli,'new','task-api'],{cwd:root,encoding:'utf8'})).toContain('Created');
   const project=join(root,'task-api');
   const workflow=index.symbols.find(symbol=>symbol.id==='WORKFLOW-PUBLIC-STARTER-LOCAL-RUN');
   expect(workflow?.syntax).toBe('bmec new task-api\ncd task-api\nbmec check main.bmec\nbmec test main.bmec\nbmec build main.bmec\nbmec run main.bmec');
   for(const [command,...args] of [['check','main.bmec'],['test','main.bmec'],['build','main.bmec']] as string[][]){
    expect(execFileSync(process.execPath,[cli,command,...args],{cwd:project,encoding:'utf8'})).toBeTruthy();
   }
   expect(existsSync(join(project,'generated','index.html'))).toBe(true);
   child=spawn(process.execPath,[cli,'run','main.bmec'],{cwd:project,env:{...process.env,BMEC_PORT:'0',BMEC_AUTH_USERS:'',BMEC_POSTGRES_URL:''},stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';
   child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
   child.stdout.on('data',(chunk:string)=>{stdout+=chunk});child.stderr.on('data',(chunk:string)=>{stderr+=chunk});
   const url=await new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`starter server did not become ready: ${stdout}\n${stderr}`)),15000);
    child!.stdout.on('data',()=>{const match=/http:\/\/(?:127\.0\.0\.1|localhost):\d+/.exec(stdout);if(match){clearTimeout(timer);resolve(match[0])}});
    child!.once('error',error=>{clearTimeout(timer);reject(error)});
    child!.once('exit',code=>{clearTimeout(timer);reject(new Error(`starter server exited before ready (${code}): ${stderr}`))});
   });
   expect((await fetch(url)).status).toBe(200);
  }finally{
   if(child&&child.exitCode===null){const stopped=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await Promise.race([stopped,new Promise(resolve=>setTimeout(resolve,3000))])}
   rmSync(root,{recursive:true,force:true});
  }
 });
});
