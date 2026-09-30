import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createKnowledgeContext, createKnowledgeIndex } from '../src/cli/knowledge.js';
import { PUBLIC_STDLIB_CONTRACTS } from '../src/stdlib/stdlib.js';
import { describe, expect, it } from 'vitest';

const examples=JSON.parse(readFileSync('ai/examples.json','utf8'));
const diagnostics=JSON.parse(readFileSync('ai/diagnostics.json','utf8'));
const index=createKnowledgeIndex({examples,diagnostics},'0.9.1-beta.2');

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
  expect(result.version).toEqual({package:'0.9.1-beta.2',language:'0.1',compatibility:'0.1-alpha'});
 });
 it('returns a deterministic machine-readable CLI context pack',()=>{
  const cli='dist/cli/index.js';
  const first=execFileSync(process.execPath,[cli,'knowledge','transaction rollback','--json'],{encoding:'utf8'});
  expect(execFileSync(process.execPath,[cli,'knowledge','transaction rollback','--json'],{encoding:'utf8'})).toBe(first);
  const result=JSON.parse(first);
  expect(result).toMatchObject({schemaVersion:'bmec.knowledge-context.v1',task:'transaction rollback',version:{package:'0.9.1-beta.2',language:'0.1'}});
  expect(result.relevant_symbols.map((symbol:{name:string})=>symbol.name).join(' ').toLocaleLowerCase()).toContain('transaction');
 });
});
