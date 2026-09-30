import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {parse} from '../src/parser/parser.js';
import {toIR} from '../src/ir/ir.js';
import {validateSerializedIR} from '../src/ir/validate.js';
import {generate} from '../src/generator/generate.js';
import {formatSource} from '../src/tooling/formatter.js';

describe('typed font-weight styles',()=>{
  it('parses, lowers, validates, and rejects unsupported weights',()=>{
    const result=compile('app Demo\nstyle named Primary font weight is bold');
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.styles).toEqual(expect.arrayContaining([expect.objectContaining({fontWeight:'bold'})]));
    expect(validateSerializedIR(JSON.parse(JSON.stringify(result.ir))).valid).toBe(true);
    expect(formatSource('app Demo\nstyle named Primary font weight is bold')).toContain('font weight is bold');
    expect(compile('app Demo\nstyle named Primary font weight is heavy').diagnostics).toMatchObject([{code:'PIPE-STYLE-021'}]);
  });

  it('inherits and lowers font weight through named style composition',()=>{
    const dir=mkdtempSync(join(tmpdir(),'bmec-font-weight-'));
    generate(toIR(parse('app Demo\nstyle named Emphasis font weight is bold\nstyle named Primary composes Emphasis\ncomponent Button uses style Primary { text "Save" }\npage Home { use Button }')),dir);
    expect(readFileSync(join(dir,'index.html'),'utf8')).toContain('[data-pipe-style="Primary"]{font-weight:bold}');
  });
});
