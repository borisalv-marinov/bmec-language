import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

describe('responsive BMEC starter',()=>{
  it('generates a responsive typed style and projects its facts',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-new-responsive-')),dir=join(root,'starter'),cli=join(process.cwd(),'dist','cli','index.js');
    expect(execFileSync(process.execPath,[cli,'new',dir],{encoding:'utf8'})).toContain('Created');
    const file=join(dir,'main.bmec'),source=readFileSync(file,'utf8');
    expect(source).toContain('layout is grid');
    expect(source).toContain('when focused');
    expect(source).toContain('on small screens');
    expect(execFileSync(process.execPath,[cli,'check',file],{encoding:'utf8'})).toContain('OK');
    const project=JSON.parse(execFileSync(process.execPath,[cli,'project',file,'--json'],{encoding:'utf8'}));
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'MainStyle',layout:'grid',focus:'ringed',responsiveColumns:1})]));
  });
});
