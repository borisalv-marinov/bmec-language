import {describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';

describe('PIPE compiler-backed REPL',()=>{
 it('persists value bindings through subsequent compiled expressions',()=>{
  const result=spawnSync(process.execPath,['--import','tsx/esm','src/cli/index.ts','repl'],{cwd:process.cwd(),input:'let x = 4\nx + 2\n:quit\n',encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('6n');
 });
 it('accepts controlled-English be bindings in the persistent scope',()=>{
  const result=spawnSync(process.execPath,['--import','tsx/esm','src/cli/index.ts','repl'],{cwd:process.cwd(),input:'let x be 4\nx + 2\n:quit\n',encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('6n');
 });
 it('reports persistent binding types without changing evaluation semantics',()=>{
  const result=spawnSync(process.execPath,['--import','tsx/esm','src/cli/index.ts','repl'],{cwd:process.cwd(),input:'let x be 4\n:type x\n:type missing\n:quit\n',encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('x: integer');
  expect(result.stdout).toContain('Unknown binding "missing"');
 });
 it('lists all persistent binding types deterministically',()=>{
  const result=spawnSync(process.execPath,['--import','tsx/esm','src/cli/index.ts','repl'],{cwd:process.cwd(),input:'let z be 4\nlet a be "x"\n:scope\n:quit\n',encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('a: text\nz: integer');
 });
 it('lists deterministic REPL commands through help',()=>{
  const result=spawnSync(process.execPath,['--import','tsx/esm','src/cli/index.ts','repl'],{cwd:process.cwd(),input:':help\n:quit\n',encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(':help - show commands');
  expect(result.stdout).toContain(':type NAME - show a binding type');
  expect(result.stdout).toContain(':capabilities - list compiler capability kinds');
  expect(result.stdout).toContain(':reset - clear scope');
  expect(result.stdout).toContain(':quit or :q - exit');
 });
 it('lists the canonical capability kinds through the REPL',()=>{
  const result=spawnSync(process.execPath,['--import','tsx/esm','src/cli/index.ts','repl'],{cwd:process.cwd(),input:':capabilities\n:quit\n',encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('database');
  expect(result.stdout).toContain('filesystem');
 });
 it('lists typed standard-library contracts through the REPL',()=>{
  const result=spawnSync(process.execPath,['--import','tsx/esm','src/cli/index.ts','repl'],{cwd:process.cwd(),input:':stdlib\n:quit\n',encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('formatDate(date|datetime) -> text');
  expect(result.stdout).toContain('randomId(capability<random>) -> id [requires random]');
 });
});
