import {describe,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compileProject} from '../src/compiler.js';

describe('compiler package lock boundary',()=>it('rejects a lockfile whose dependency path is stale',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-lock-compile-'));mkdirSync(join(root,'dep'));writeFileSync(join(root,'dep','pipe.toml'),'x = true');writeFileSync(join(root,'main.pipe'),'app Demo');writeFileSync(join(root,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\ndep = "./dep"\n');writeFileSync(join(root,'pipe.lock'),JSON.stringify({version:1,package:'demo',dependencies:[{name:'dep',path:'wrong',integrity:'sha256-bad'}]}));
 const result=compileProject(join(root,'main.pipe'));expect(result.diagnostics.map(x=>x.code)).toEqual(expect.arrayContaining(['PIPE-PKG-005','PIPE-PKG-004']));expect(result.ir).toBeUndefined();
}));

it('resolves a declared path dependency by package name',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-package-import-'));mkdirSync(join(root,'dep'));
 writeFileSync(join(root,'dep','pipe.toml'),'[package]\nname = "util"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "lib.pipe"\n');
 writeFileSync(join(root,'dep','lib.pipe'),'import { inc } from "./nested.pipe"\npublic function add(a integer, b integer) -> integer { return inc(a + b) }');
 writeFileSync(join(root,'dep','nested.pipe'),'public function inc(value integer) -> integer { return value + 1 }');
 writeFileSync(join(root,'main.pipe'),'import { add } from "util/lib.pipe"\nfunction main() -> integer { return add(2, 3) }');
 writeFileSync(join(root,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nutil = "./dep"\n');
 const result=compileProject(join(root,'main.pipe'));expect(result.diagnostics).toEqual([]);expect(result.modules).toHaveLength(3);expect(result.modules.map(m=>m.id)).toEqual(['demo@1.0.0:main.pipe','util@1.0.0:lib.pipe','util@1.0.0:nested.pipe']);expect(result.ir?.functions.some(f=>f.name==='add')).toBe(true);
});

it('lowers a root API model when the entry imports a declared package',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-package-api-route-'));mkdirSync(join(root,'dep'));
 writeFileSync(join(root,'dep','pipe.toml'),'[package]\nname = "util"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "lib.pipe"\n');
 writeFileSync(join(root,'dep','lib.pipe'),'public function bump(value integer) -> integer { return value + 1 }');
 writeFileSync(join(root,'main.pipe'),'import { bump } from "util/lib.pipe"\napp Demo\nmodel Item { name text required }\napi /items from Item\nfunction main() -> integer { return bump(1) }');
 writeFileSync(join(root,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nutil = "./dep"\n');
 const result=compileProject(join(root,'main.pipe'));
 expect(result.diagnostics).toEqual([]);
 expect(result.ir?.http?.routes).toEqual(expect.arrayContaining([expect.objectContaining({method:'GET',path:'/items',responseBody:expect.objectContaining({kind:'list',element:expect.objectContaining({kind:'model',name:'Item'})})})]));
});

it('keeps manifest package declarations private unless public',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-package-visibility-'));mkdirSync(join(root,'dep'));
 writeFileSync(join(root,'dep','pipe.toml'),'[package]\nname = "hidden"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "lib.pipe"\n');
 writeFileSync(join(root,'dep','lib.pipe'),'function hidden() -> integer { return 1 }');
 writeFileSync(join(root,'main.pipe'),'import { hidden } from "hidden/lib.pipe"\nfunction main() -> integer { return hidden() }');
 writeFileSync(join(root,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nhidden = "./dep"\n');
 expect(compileProject(join(root,'main.pipe')).diagnostics.map(x=>x.code)).toContain('PIPE-MOD-007');
});

it('applies package privacy to records, enums, and interfaces by default',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-package-visibility-types-'));mkdirSync(join(root,'dep'));
 writeFileSync(join(root,'dep','pipe.toml'),'[package]\nname = "hidden-types"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "lib.pipe"\n');
 writeFileSync(join(root,'dep','lib.pipe'),'model HiddenModel {} type HiddenRecord { value text } enum HiddenEnum { A } interface HiddenInterface { show(self) -> text }');
 writeFileSync(join(root,'main.pipe'),'import { HiddenModel } from "hidden-types/lib.pipe"\nimport { HiddenRecord } from "hidden-types/lib.pipe"\nimport { HiddenEnum } from "hidden-types/lib.pipe"\nimport { HiddenInterface } from "hidden-types/lib.pipe"\nfunction main() -> integer { return 1 }');
 writeFileSync(join(root,'pipe.toml'),'[package]\nname = "demo-types"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nhidden-types = "./dep"\n');
 expect(compileProject(join(root,'main.pipe')).diagnostics.filter(x=>x.code==='PIPE-MOD-007')).toHaveLength(4);
});

it('validates dependency lockfiles during project compilation',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-package-nested-lock-'));mkdirSync(join(root,'dep'));
 writeFileSync(join(root,'dep','pipe.toml'),'[package]\nname = "nested"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "lib.pipe"\n[dependencies]\nother = "./missing"\n');
 writeFileSync(join(root,'dep','lib.pipe'),'public function value() -> integer { return 1 }');
 writeFileSync(join(root,'dep','pipe.lock'),JSON.stringify({version:1,package:'nested',dependencies:[]}));
 writeFileSync(join(root,'main.pipe'),'import { value } from "nested/lib.pipe"\nfunction main() -> integer { return value() }');
 writeFileSync(join(root,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nnested = "./dep"\n');
 expect(compileProject(join(root,'main.pipe')).diagnostics.map(x=>x.code)).toContain('PIPE-PKG-003');
});

it('diagnoses missing local dependencies before import traversal',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-package-missing-'));
 writeFileSync(join(root,'main.pipe'),'app Demo');
 writeFileSync(join(root,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nmissing = "./missing"\n');
 expect(compileProject(join(root,'main.pipe')).diagnostics.map(x=>x.code)).toContain('PIPE-PKG-011');
});

it('diagnoses incompatible package metadata and package dependency cycles',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-package-graph-'));mkdirSync(join(root,'a'));mkdirSync(join(root,'b'));
 writeFileSync(join(root,'main.pipe'),'app Demo');
 writeFileSync(join(root,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\na = "./a"\n');
 writeFileSync(join(root,'a','pipe.toml'),'[package]\nname = "a"\nversion = "1.0.0"\nlanguage = "0.2-alpha"\nentry = "main.pipe"\n[dependencies]\nb = "../b"\n');
 writeFileSync(join(root,'a','main.pipe'),'app A');
 writeFileSync(join(root,'b','pipe.toml'),'[package]\nname = "b"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\na = "../a"\n');
 writeFileSync(join(root,'b','main.pipe'),'app B');
 expect(compileProject(join(root,'main.pipe')).diagnostics.map(x=>x.code)).toEqual(expect.arrayContaining(['PIPE-PKG-012','PIPE-PKG-013']));
});

it('keeps malformed dependency metadata as diagnostics instead of host exceptions',()=>{
 const root=mkdtempSync(join(tmpdir(),'pipe-package-malformed-'));mkdirSync(join(root,'dep'));
 writeFileSync(join(root,'dep','pipe.toml'),'[package]\nname = "dep"\nentry = "lib.pipe"\n');
 writeFileSync(join(root,'dep','lib.pipe'),'public function value() -> integer { return 1 }');
 writeFileSync(join(root,'main.pipe'),'import { value } from "dep/lib.pipe"\nfunction main() -> integer { return value() }');
 writeFileSync(join(root,'pipe.toml'),'[package]\nname = "demo"\nversion = "1.0.0"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\ndep = "./dep"\n');
 const result=compileProject(join(root,'main.pipe'));expect(result.diagnostics.map(x=>x.code)).toContain('PIPE-PKG-012');expect(result.diagnostics.map(x=>x.code)).not.toContain('PIPE-CLI-001');
});
