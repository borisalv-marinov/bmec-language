import {describe,expect,it} from 'vitest';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

describe('isolated package reproducibility',()=>{it('produces identical lockfiles and releases from different checkout roots',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-isolated-')),source=join(process.cwd(),'examples','task-manager'),cli=join(process.cwd(),'dist','cli','index.js');
 const projects=[join(root,'task-manager-a'),join(root,'task-manager-b')];projects.forEach(project=>cpSync(source,project,{recursive:true}));
 const build=(project:string)=>{const entry=join(project,'main.pipe');expect(execFileSync(process.execPath,[cli,'check',entry],{encoding:'utf8'})).toContain('OK');execFileSync(process.execPath,[cli,'fmt',entry,'--write'],{encoding:'utf8'});expect(execFileSync(process.execPath,[cli,'fmt',entry,'--check'],{encoding:'utf8'})).toContain('Formatted');expect(execFileSync(process.execPath,[cli,'lock',entry],{encoding:'utf8'})).toContain('Locked task-manager');expect(execFileSync(process.execPath,[cli,'build','--release',entry],{encoding:'utf8'})).toContain('Released');return join(project,'release')};
 const releases=projects.map(build),names=['index.html','app.js','pipe-ir.json','server-ir.json','pipe-release.json'];
 for(const name of names){const first=readFileSync(join(releases[0]!,name),'utf8'),second=readFileSync(join(releases[1]!,name),'utf8');expect(second).toBe(first);expect(first).not.toContain(process.cwd().replaceAll('\\','/'));}
 expect(readFileSync(join(projects[0]!, 'pipe.lock'),'utf8')).toBe(readFileSync(join(projects[1]!, 'pipe.lock'),'utf8'));
 });});

it('reproduces local dependency locks from different roots through the CLI',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-local-repro-')),cli=join(process.cwd(),'dist','cli','index.js');
 const projects=[join(root,'project-a'),join(root,'project-b')];
 for(const project of projects){const dependency=join(project,'dep');mkdirSync(dependency,{recursive:true});writeFileSync(join(dependency,'pipe.toml'),'[package]\nname = "util"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "lib.pipe"\n');writeFileSync(join(dependency,'lib.pipe'),'public function increment(value integer) -> integer { return value + 1 }');writeFileSync(join(project,'main.pipe'),'import { increment } from "util/lib.pipe"\napp Demo\nfunction main() -> integer { return increment(1) }');writeFileSync(join(project,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nutil = "./dep"\n');expect(execFileSync(process.execPath,[cli,'check',join(project,'main.pipe')],{encoding:'utf8'})).toContain('OK');expect(execFileSync(process.execPath,[cli,'lock',join(project,'main.pipe')],{encoding:'utf8'})).toContain('Locked demo');}
 expect(readFileSync(join(projects[0]!, 'pipe.lock'),'utf8')).toBe(readFileSync(join(projects[1]!, 'pipe.lock'),'utf8'));
});

it('surfaces package graph failures through the external CLI',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-package-cli-errors-')),cli=join(process.cwd(),'dist','cli','index.js'),missing=join(root,'missing-project');mkdirSync(missing,{recursive:true});writeFileSync(join(missing,'main.pipe'),'app Demo');writeFileSync(join(missing,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nmissing = "./missing"\n');let missingOutput:string|undefined;try{execFileSync(process.execPath,[cli,'check',join(missing,'main.pipe')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(error){missingOutput=String((error as {stderr?:Buffer}).stderr??'');}expect(missingOutput).toContain('PIPE-PKG-011');
 const cycle=join(root,'cycle-project'),a=join(cycle,'a'),b=join(cycle,'b');mkdirSync(a,{recursive:true});mkdirSync(b,{recursive:true});writeFileSync(join(cycle,'main.pipe'),'app Demo');writeFileSync(join(cycle,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\na = "./a"\n');writeFileSync(join(a,'pipe.toml'),'[package]\nname = "a"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nb = "../b"\n');writeFileSync(join(a,'main.pipe'),'app A');writeFileSync(join(b,'pipe.toml'),'[package]\nname = "b"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\na = "../a"\n');writeFileSync(join(b,'main.pipe'),'app B');let cycleOutput:string|undefined;try{execFileSync(process.execPath,[cli,'check',join(cycle,'main.pipe')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(error){cycleOutput=String((error as {stderr?:Buffer}).stderr??'');}expect(cycleOutput).toContain('PIPE-PKG-013');
});
