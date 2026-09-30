import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {parse} from '../src/parser/parser.js';
import {toIR} from '../src/ir/ir.js';
import {validateSerializedIR} from '../src/ir/validate.js';
import {generate} from '../src/generator/generate.js';

describe('typed style colors',()=>{
  it('accepts red and green through typed IR validation',()=>{
    const result=compile('app Demo\nstyle named ErrorText color is red\nstyle named SuccessText color is green');
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'ErrorText',color:'red'}),expect.objectContaining({name:'SuccessText',color:'green'})]));
    expect(validateSerializedIR(JSON.parse(JSON.stringify(result.ir))).valid).toBe(true);
  });

  it('rejects unsupported color values',()=>{
    expect(compile('app Demo\nstyle named Accent color is purple').diagnostics).toMatchObject([{code:'PIPE-STYLE-010'}]);
  });

  it('lowers red and green to scoped deterministic CSS',()=>{
    const dir=mkdtempSync(join(tmpdir(),'bmec-style-colors-'));
    generate(toIR(parse('app Demo\nstyle named ErrorText color is red\nstyle named SuccessText color is green\ncomponent Copy uses style ErrorText { text "Error" }\npage Home { use Copy }')),dir);
    const html=readFileSync(join(dir,'index.html'),'utf8');
    expect(html).toContain('[data-pipe-style="ErrorText"]{color:#b91c1c}');
  });

  it('lowers typed red and green backgrounds for normal status surfaces',()=>{
    const dir=mkdtempSync(join(tmpdir(),'bmec-style-background-colors-'));
    const ir=toIR(parse('app Demo\nstyle named ErrorSurface background is red\nstyle named SuccessSurface state hovered background is green\ncomponent Copy uses style ErrorSurface { text "Error" }\npage Home { use Copy }'));
    expect(validateSerializedIR(JSON.parse(JSON.stringify(ir))).valid).toBe(true);
    generate(ir,dir);
    const html=readFileSync(join(dir,'index.html'),'utf8');
    expect(html).toContain('[data-pipe-style="ErrorSurface"]{background:var(--bmec-color-status-error-surface)}');
    expect(html).toContain('[data-pipe-style="SuccessSurface"] button:hover,[data-pipe-style="SuccessSurface"]:hover{background:var(--bmec-color-status-success-surface)}');
  });

  it('lowers typed red and green borders to scoped CSS',()=>{
    const dir=mkdtempSync(join(tmpdir(),'bmec-style-border-colors-'));
    generate(toIR(parse('app Demo\nstyle named ErrorSurface border is red\nstyle named SuccessSurface border is green')),dir);
    const html=readFileSync(join(dir,'index.html'),'utf8');
    expect(html).toContain('[data-pipe-style="ErrorSurface"] input,[data-pipe-style="ErrorSurface"] button{border:1px solid #dc2626}');
    expect(html).toContain('[data-pipe-style="SuccessSurface"] input,[data-pipe-style="SuccessSurface"] button{border:1px solid #16a34a}');
  });
});
