import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compile } from '../src/compiler.js';
import { parse } from '../src/parser/parser.js';
import { toIR } from '../src/ir/ir.js';
import { validateSerializedIR } from '../src/ir/validate.js';
import { generate } from '../src/generator/generate.js';

describe('typed font size styles', () => {
  it('parses and lowers positive font sizes', () => {
    const declaration = parse('style named Heading font size is 24').declarations[0] as any;
    expect(declaration).toMatchObject({ name: 'Heading', fontSize: 24 });
    const ir = toIR(parse('app Demo\nstyle named Heading font size is 24'));
    expect(ir.styles).toEqual(expect.arrayContaining([expect.objectContaining({ fontSize: 24 })]));
    expect(validateSerializedIR(JSON.parse(JSON.stringify(ir))).valid).toBe(true);
  });

  it('rejects non-positive font sizes', () => {
    expect(compile('app Demo\nstyle named Heading font size is 0').diagnostics).toMatchObject([{ code: 'PIPE-STYLE-023' }]);
  });

  it('lowers composed font sizes deterministically to scoped CSS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bmec-style-font-size-'));
    generate(toIR(parse('app Styled\nstyle named Base font size is 18\nstyle named Heading composes Base\ncomponent Copy uses style Heading { text "Text" }\npage Home { use Copy }')), dir);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('[data-pipe-style="Heading"]{font-size:18px}');
  });
});
