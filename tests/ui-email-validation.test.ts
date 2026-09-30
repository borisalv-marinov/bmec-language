import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {primitive} from '../src/types/type-ref.js';
import {validateInput} from '../src/ui/validation.js';
import {generate} from '../src/generator/generate.js';
import {toIR} from '../src/ir/ir.js';
import {parse} from '../src/parser/parser.js';

describe('email form validation',()=>{
  it('validates email values and preserves optional absence',()=>{
    expect(validateInput('ada@example.com',primitive('text'),'email')).toBeUndefined();
    expect(validateInput('not-an-email',primitive('text'),'email')).toBe('expected email');
    expect(validateInput('',{kind:'optional',inner:primitive('text')},'email')).toBeUndefined();
  });

  it('accepts email in source, rejects unknown rules, and emits browser validation',()=>{
    expect(compile('app Login\ncomponent Form { input Email text validate email }').diagnostics).toEqual([]);
    expect(compile('app Login\ncomponent Form { input Email text validate trim }').diagnostics).toMatchObject([{code:'PIPE-UI-004',expected:'nonempty, email, number, date, datetime, url',suggestions:['Use one of: nonempty, email, number, date, datetime, url.']}]);
    const out=mkdtempSync(join(tmpdir(),'bmec-email-validation-'));
    generate(toIR(parse('app Login\ncomponent Form { input Email text validate email }\npage Home { use Form }')),out);
    const html=readFileSync(join(out,'index.html'),'utf8');
    expect(html).toContain('data-pipe-validation="email"');
    expect(html).toContain("rule==='email'");
    expect(html).toContain('input[data-pipe-error]{border:1px solid #dc2626}');
    expect(html).toContain('class="pipe-field-error" role="alert"');
    expect(html).toContain('aria-describedby="pipe-COMP-001-Email-error"');
    expect(html).toContain('id="pipe-COMP-001-Email-error"');
    expect(html).toContain('.pipe-field-error{display:block');
    expect(html).toContain("setAttribute?.('aria-invalid','true')");
    expect(html).toContain('aria-invalid="false"');
  });

  it('suggests the supported validation rules for page inputs',()=>{
    expect(compile('app Login page SignIn { ask Email as text validate trim }').diagnostics).toMatchObject([{code:'PIPE-UI-004',expected:'nonempty, email, number, date, datetime, url',suggestions:['Use one of: nonempty, email, number, date, datetime, url.']}]);
  });
});

describe('url form validation',()=>{
  it('accepts only HTTP(S) URLs and exposes the compiler/browser contract',()=>{
    expect(validateInput('https://example.com',primitive('text'),'url')).toBeUndefined();
    expect(validateInput('ftp://example.com',primitive('text'),'url')).toBe('expected http(s) URL');
    expect(compile('app Links\ncomponent Form { input Website text validate url }').diagnostics).toEqual([]);
    const out=mkdtempSync(join(tmpdir(),'bmec-url-validation-'));
    generate(toIR(parse('app Links\ncomponent Form { input Website text validate url }\npage Home { use Form }')),out);
    expect(readFileSync(join(out,'index.html'),'utf8')).toContain("rule==='url'");
  });

  it('preserves optional empty URL semantics in generated input metadata',()=>{
    const out=mkdtempSync(join(tmpdir(),'bmec-optional-url-validation-'));
    generate(toIR(parse('app Links\ncomponent Form { input Website text? validate url }\npage Home { use Form }')),out);
    const html=readFileSync(join(out,'index.html'),'utf8');
    expect(html).toContain('data-pipe-optional="true"');
  });
});

describe('number form validation',()=>{
  it('accepts finite numeric values and rejects blank or non-numeric values',()=>{
    expect(validateInput('42.5',primitive('text'),'number')).toBeUndefined();
    expect(validateInput('Infinity',primitive('text'),'number')).toBe('expected finite number');
    expect(validateInput('',primitive('text'),'number')).toBe('expected finite number');
    expect(validateInput('',{kind:'optional',inner:primitive('text')},'number')).toBeUndefined();
  });

  it('accepts number in source and emits browser validation',()=>{
    expect(compile('app Metrics\ncomponent Form { input Score text validate number }').diagnostics).toEqual([]);
    const out=mkdtempSync(join(tmpdir(),'bmec-number-validation-'));
    generate(toIR(parse('app Metrics\ncomponent Form { input Score text validate number }\npage Home { use Form }')),out);
    const html=readFileSync(join(out,'index.html'),'utf8');
    expect(html).toContain('data-pipe-validation="number"');
    expect(html).toContain("rule==='number'");
  });
});

describe('date form validation',()=>{
  it('accepts calendar-valid ISO dates and rejects malformed dates',()=>{
    expect(validateInput('2026-09-18',primitive('date'),'date')).toBeUndefined();
    expect(validateInput('2026-02-29',primitive('date'),'date')).toBe('expected ISO date');
    expect(validateInput('18/09/2026',primitive('date'),'date')).toBe('expected ISO date');
    expect(validateInput('',{kind:'optional',inner:primitive('date')},'date')).toBeUndefined();
  });

  it('accepts date in source and emits browser validation',()=>{
    expect(compile('app Calendar\ncomponent Form { input Due date validate date }').diagnostics).toEqual([]);
    const out=mkdtempSync(join(tmpdir(),'bmec-date-validation-'));
    generate(toIR(parse('app Calendar\ncomponent Form { input Due date validate date }\npage Home { use Form }')),out);
    const html=readFileSync(join(out,'index.html'),'utf8');
    expect(html).toContain('data-pipe-validation="date"');
    expect(html).toContain("rule==='date'");
  });
});

describe('datetime form validation',()=>{
  it('accepts UTC ISO datetimes and rejects invalid calendar or timezone values',()=>{
    expect(validateInput('2026-09-18T12:30:00Z',primitive('datetime'),'datetime')).toBeUndefined();
    expect(validateInput('2026-02-29T12:30:00Z',primitive('datetime'),'datetime')).toBe('expected ISO datetime');
    expect(validateInput('2026-09-18T12:30:00+03:00',primitive('datetime'),'datetime')).toBe('expected ISO datetime');
    expect(validateInput('',{kind:'optional',inner:primitive('datetime')},'datetime')).toBeUndefined();
  });

  it('accepts datetime in source and emits browser validation',()=>{
    expect(compile('app Calendar\ncomponent Form { input Due datetime validate datetime }').diagnostics).toEqual([]);
    const out=mkdtempSync(join(tmpdir(),'bmec-datetime-validation-'));
    generate(toIR(parse('app Calendar\ncomponent Form { input Due datetime validate datetime }\npage Home { use Form }')),out);
    const html=readFileSync(join(out,'index.html'),'utf8');
    expect(html).toContain('data-pipe-validation="datetime"');
    expect(html).toContain("rule==='datetime'");
  });
});

describe('typed browser input controls',()=>{
  it('lowers primitive and optional types to deterministic HTML controls',()=>{
    const out=mkdtempSync(join(tmpdir(),'bmec-typed-input-controls-'));
    generate(toIR(parse('app Metrics\ncomponent Form { input Amount number input Due date? input Enabled boolean }\npage Home { use Form }')),out);
    const html=readFileSync(join(out,'index.html'),'utf8');
    expect(html).toContain('name="Amount"');
    expect(html).toContain('data-pipe-type="number" type="number"');
    expect(html).toContain('type="number" step="any"');
    expect(html).toContain('data-pipe-type="date" type="date"');
    expect(html).toContain('data-pipe-type="boolean" type="checkbox"');
  });
});
