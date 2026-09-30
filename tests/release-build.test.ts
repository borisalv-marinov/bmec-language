import {describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compile} from '../src/compiler.js';
import {buildRelease} from '../src/release/release.js';

describe('deterministic release artifacts',()=>it('emits explicit server/browser/manifest artifacts without checkout paths',()=>{
 const result=compile('app Demo\nmodel Item { name text required }\nstyle named Card padding is 4');expect(result.ir).toBeTruthy();
 const a=buildRelease(result.ir!,join(mkdtempSync(join(tmpdir(),'pipe-release-')),'out'),{packageName:'demo',packageVersion:'1.2.3',languageVersion:'0.1-alpha'});
 expect(readFileSync(join(a.directory,a.artifacts.server),'utf8')).toContain('"irVersion"');
 const manifest=JSON.parse(readFileSync(join(a.directory,a.artifacts.manifest),'utf8'));expect(manifest).toMatchObject({package:'demo',packageVersion:'1.2.3',artifacts:{server:'server-ir.json',browser:'index.html'}});
 const server=readFileSync(join(a.directory,a.artifacts.server),'utf8');expect(server).not.toContain(process.cwd());const browser=readFileSync(join(a.directory,a.artifacts.browser),'utf8');expect(browser).not.toContain(process.cwd());expect(browser).not.toContain('"db":{');expect(browser).not.toContain('"functions":[{');expect(browser).toContain('<script src="app.js"></script>');const bundle=readFileSync(join(a.directory,'app.js'),'utf8');expect(bundle.length).toBeGreaterThan(100);expect(bundle).not.toContain('databaseSelect');
 expect(readFileSync(join(a.directory,'pipe-ir.json'),'utf8')).toContain('"styles"');expect(bundle).not.toContain('"styles"');
}));
it('rejects forbidden browser partition references before emission',()=>{const result=compile('app Demo\nmodel Item { name text required }');expect(()=>buildRelease(result.ir!,join(mkdtempSync(join(tmpdir(),'pipe-release-')),'out'),{packageName:'demo',packageVersion:'1.2.3',languageVersion:'0.1-alpha',browserReferences:[{identity:'db.main',kind:'database'}]})).toThrow('PIPE-PART-001')});
it('emits executable condition/list hydration for source UI nodes',()=>{const result=compile('app Demo\ncomponent Row { text "row" }\npage Home { state items list<text> loading "Loading" list items item Row }');expect(result.diagnostics).toEqual([]);const out=join(mkdtempSync(join(tmpdir(),'pipe-release-')),'out');const release=buildRelease(result.ir!,out,{packageName:'demo',packageVersion:'1.2.3',languageVersion:'0.1-alpha'});const html=readFileSync(join(out,release.artifacts.browser),'utf8');const app=readFileSync(join(out,'app.js'),'utf8');expect(html).toContain('data-pipe-condition="loading"');expect(html).toContain('data-pipe-list="items"');expect(app).toContain('PIPE_UI_STATE');expect(app).toContain('pipeCondition');expect(app).toContain('pipeList');});
