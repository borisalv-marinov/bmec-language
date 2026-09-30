import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {parse} from '../src/parser/parser.js';
import {toIR} from '../src/ir/ir.js';
import {validateSerializedIR} from '../src/ir/validate.js';
import {generate} from '../src/generator/generate.js';
import {formatSource} from '../src/tooling/formatter.js';
import {createLanguageService} from '../src/lsp/service.js';
import {execFileSync} from 'node:child_process';

describe('typed line-height styles',()=>{
  it('parses, lowers, validates, formats, and rejects non-positive values',()=>{
    const result=compile('app Demo\nstyle named Reading line height is 1.5');
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.styles).toEqual(expect.arrayContaining([expect.objectContaining({lineHeight:1.5})]));
    expect(validateSerializedIR(JSON.parse(JSON.stringify(result.ir))).valid).toBe(true);
    expect(formatSource('app Demo\nstyle named Reading line height is 1.5')).toContain('line height is 1.5');
    expect(compile('app Demo\nstyle named Reading line height is 0').diagnostics).toMatchObject([{code:'PIPE-STYLE-022'}]);
  });

  it('inherits and lowers line height through CSS and AI facts',()=>{
    const dir=mkdtempSync(join(tmpdir(),'bmec-line-height-')),file=join(dir,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Reading line height is 1.5\nstyle named Article composes Reading\ncomponent Copy uses style Article { text "Text" }\npage Home { use Copy }');
    generate(toIR(parse(readFileSync(file,'utf8'))),join(dir,'generated'));
    expect(readFileSync(join(dir,'generated','index.html'),'utf8')).toContain('[data-pipe-style="Article"]{line-height:1.5}');
    const project=JSON.parse(execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'}));
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Reading',lineHeight:1.5})]));
  });

  it('offers line-height vocabulary in style completion',()=>{
    const service=createLanguageService(),uri='file:///line-height.bmec',text='app Demo\nstyle named Reading line ';
    service.open({uri,file:'line-height.bmec',text});
    const labels=service.completion(uri,{line:1,character:text.split('\n')[1]!.length}).map(item=>item.label);
    expect(labels).toEqual(expect.arrayContaining(['line','height']));
  });
});
