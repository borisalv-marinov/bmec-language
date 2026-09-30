import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parse} from '../src/parser/parser.js';
import {toIR} from '../src/ir/ir.js';
import {generate} from '../src/generator/generate.js';

describe('public enum select contract',()=>{
  it('exposes select controls and deterministic options through pages JSON',()=>{
    const dir=mkdtempSync(join(tmpdir(),'bmec-enum-json-')),file=join(dir,'main.bmec');
    writeFileSync(file,'app Work\nenum Status { Pending Assigned Done }\nmodel Task { status Status required }\npage Home { crud Task }\n');
    const output=execFileSync(process.execPath,['--import','tsx/esm','src/cli/index.ts','pages',file,'--json'],{cwd:process.cwd(),encoding:'utf8'});
    const page=JSON.parse(output).pages[0];expect(page.crudDetails[0].fields[0]).toMatchObject({type:'Status',control:'select',options:['Pending','Assigned','Done'],required:true});
  });
  it('renders relation fields as semantic selects and projects their target endpoint',()=>{
    const source='app Work\nmodel User { name text required }\nmodel Task { title text required owner User required }\npage Home { crud Task }';
    const dir=mkdtempSync(join(tmpdir(),'bmec-relation-select-'));generate(toIR(parse(source)),dir);
    const html=readFileSync(join(dir,'index.html'),'utf8');expect(html).toContain('data-pipe-control="select"');expect(html).toContain('data-pipe-relation="User"');expect(html).toContain('select[data-pipe-relation-endpoint]');expect(html).toContain("kind:'model'");
    const file=join(dir,'main.bmec');writeFileSync(file,source);
    const output=execFileSync(process.execPath,['--import','tsx/esm','src/cli/index.ts','pages',file,'--json'],{cwd:process.cwd(),encoding:'utf8'});
    expect(JSON.parse(output).pages[0].crudDetails[0].fields.find((field:{name:string})=>field.name==='owner')).toMatchObject({control:'select',relation:{model:'User',endpoint:'/api/User'}});
  });
});
