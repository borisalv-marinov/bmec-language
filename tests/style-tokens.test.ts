import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {formatSource} from '../src/tooling/formatter.js';
import {parse} from '../src/parser/parser.js';
import {toIR} from '../src/ir/ir.js';
import {generate} from '../src/generator/generate.js';
import {graph} from '../src/graph/graph.js';
import {createLanguageService} from '../src/lsp/service.js';
import {AI_LANGUAGE_CONSTRUCTS} from '../src/cli/ai-language.js';

describe('BMEC typed style tokens',()=>{
 it('emits the canonical design scales and uses semantic tokens in typed themes',()=>{
  const source='app Styled\nstyle named Surface theme is calm\nstyle named SurfaceFocus { when focused { show focus ring } }\ncomponent Copy uses style Surface { text "Text" }\ncomponent FocusCopy uses style SurfaceFocus { text "Focus" }\npage Home { use Copy use FocusCopy }';
  const result=compile(source,'design-token-system.bmec');
  expect(result.diagnostics).toEqual([]);
  const directory=mkdtempSync(join(tmpdir(),'bmec-design-token-system-'));
  generate(result.ir!,directory);
  const html=readFileSync(join(directory,'index.html'),'utf8');
  expect(html).toContain('--bmec-color-semantic-action-primary:#2563eb');
  expect(html).toContain('--bmec-color-semantic-surface-inverse:#171717');
  expect(html).toContain('--bmec-color-status-success-foreground:#15803d');
  expect(html).toContain('--bmec-color-status-info-foreground:#1d4ed8');
  expect(html).toContain('--bmec-color-status-error-foreground:#b91c1c');
  expect(html).toContain('--bmec-color-status-warning-surface:#fffbeb');
  expect(html).toContain('--bmec-typography-font-size-base:1rem');
  expect(html).toContain('--bmec-spacing-4:1rem');
  expect(html).toContain('--bmec-sizing-control:2.5rem');
  expect(html).toContain('--bmec-radius-lg:0.75rem');
  expect(html).toContain('--bmec-border-width-strong:2px');
  expect(html).toContain('--bmec-shadow-raised:0 4px 14px #0f172a0d');
  expect(html).toContain('--bmec-breakpoint-md:768px');
  expect(html).toContain('--bmec-motion-standard:180ms');
  expect(html).toContain('--bmec-focus-width:3px');
  expect(html).toContain('--bmec-disabled-opacity:0.55');
  expect(html).toContain('[data-pipe-style="Surface"]{background:var(--bmec-color-semantic-surface-canvas);color:var(--bmec-color-neutral-800)}');
  expect(html).toContain('[data-pipe-style="SurfaceFocus"] input:focus-visible,[data-pipe-style="SurfaceFocus"] button:focus-visible{outline:var(--bmec-focus-width) solid var(--bmec-color-focus-ring-strong);outline-offset:var(--bmec-focus-offset)}');
 });
 it('parses and composes numeric design tokens through the existing style IR',()=>{
  const source='app Styled\nstyle token SpaceSmall padding is 8\nstyle named Card composes SpaceSmall\ncomponent Copy uses style Card { text "Text" }\npage Home { use Copy }';
  const result=compile(source,'style-token.bmec');
  expect(result.diagnostics).toEqual([]);
  expect(result.ir!.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'SpaceSmall',token:true,padding:8}),expect.objectContaining({name:'Card',composes:['SpaceSmall']})]));
  expect(formatSource(formatSource(source))).toBe(formatSource(source));
  const directory=mkdtempSync(join(tmpdir(),'bmec-style-token-'));
  generate(result.ir!,directory);
  const html=readFileSync(join(directory,'index.html'),'utf8');
  expect(html).toContain('[data-pipe-style="Card"]{padding:8px}');
  expect(html).not.toContain('[data-pipe-style="SpaceSmall"]');
 });
 it('rejects direct token attachments and documents named-style composition',()=>{
  const source='app Styled\nstyle token SpaceSmall padding is 8\ncomponent Copy uses style SpaceSmall { text "Text" }\npage Home { use Copy use style SpaceSmall }';
  const diagnostics=compile(source).diagnostics.filter(diagnostic=>diagnostic.code==='PIPE-STYLE-034');
  expect(diagnostics).toHaveLength(2);expect(diagnostics.map(diagnostic=>diagnostic.received)).toEqual(['SpaceSmall','SpaceSmall']);
  const contract=AI_LANGUAGE_CONSTRUCTS.find(construct=>construct.id==='STYLE-TYPED-001')!;
  expect(contract.errors).toContain('Direct attachment of a token is rejected with PIPE-STYLE-034; compose it into a named style first.');
 });
 it('keeps token facts visible to the validated IR',()=>{
  const ir=toIR(parse('app Styled\nstyle token SpaceSmall gap is 4'));
  expect(ir.styles).toEqual([expect.objectContaining({name:'SpaceSmall',token:true,gap:4})]);
  expect(graph(ir).find(node=>node.name.startsWith('SpaceSmall'))?.facts).toMatchObject({token:true,gap:4});
 });
 it('projects token facts through the AI style command',()=>{
  const root=mkdtempSync(join(tmpdir(),'bmec-style-token-facts-')),file=join(root,'main.bmec'),cli=join(process.cwd(),'dist','cli','index.js');
  writeFileSync(file,'app Styled\nstyle token SpaceSmall padding is 8\n');
  expect(JSON.parse(execFileSync(process.execPath,[cli,'styles',file,'--json'],{encoding:'utf8'})).styles).toEqual([expect.objectContaining({name:'SpaceSmall',token:true,padding:8})]);
 });
 it('offers token vocabulary in style completion context',()=>{
  const service=createLanguageService(),uri='file:///style-token.bmec',text='style token ';
  service.open({uri,file:'style-token.bmec',text});
  expect(service.completion(uri,{line:0,character:text.length}).map(item=>item.label)).toContain('token');
 });
});
