import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {formatDiagnostics} from '../src/diagnostics/diagnostics.js';

describe('structured compiler diagnostics',()=>{
 it('turns lexer failures into located diagnostics',()=>{
  const result=compile('app Demo\nmodel Item { title text @ }','src/main.pipe');
  expect(result.ir).toBeUndefined();
  expect(result.diagnostics[0]).toMatchObject({code:'PIPE-SYN-002',file:'src/main.pipe',line:2,column:25,kind:'syntax'});
  expect(result.diagnostics[0]?.span.start.offset).toBe(33);
 });
 it('turns parser failures into located diagnostics without host stacks',()=>{
  const result=compile('model User { name text','models.pipe');
  expect(result.diagnostics[0]).toMatchObject({code:'PIPE-SYN-003',file:'models.pipe',kind:'syntax'});
  expect(result.diagnostics[0]?.span.start.line).toBe(1);
  expect(formatDiagnostics(result.diagnostics)).not.toContain(' at ');
 });
 it('explains that visible page text belongs in an attached component',()=>{
  const invalid=compile('app Store\npage Home { text "Welcome" }','store.bmec');
  expect(invalid.diagnostics[0]).toMatchObject({
   code:'PIPE-SYN-003',
   message:'PIPE-SYN-003: Page bodies cannot contain bare text statements',
   file:'store.bmec',
   kind:'syntax',
   received:'text',
   expected:expect.stringContaining('supported page member'),
   suggestions:[expect.stringContaining('component Heading { text "Welcome" }')],
  });
  expect(formatDiagnostics(invalid.diagnostics)).toContain('Hint:');
  const corrected=compile('app Store\ncomponent Heading { text "Welcome" }\npage Home { use Heading }');
  expect(corrected.diagnostics).toEqual([]);
 });
 it('keeps semantic expected and actual types structured',()=>{
  const result=compile('function f(x integer) -> integer { return "wrong" }','types.pipe');
  expect(result.diagnostics[0]).toMatchObject({code:'PIPE-FUNC-006',expected:'integer',actual:'text',file:'types.pipe'});
 });
 it('versions machine-readable diagnostic failure envelopes',()=>{
  const result=compile('function f(x integer) -> integer { return "wrong" }','types.pipe');
  const envelope=JSON.parse(formatDiagnostics(result.diagnostics,true));
  expect(envelope).toMatchObject({schemaVersion:'bmec.diagnostics.v1',languageVersion:'0.1',ok:false,diagnostics:[expect.objectContaining({code:'PIPE-FUNC-006',expected:'integer',actual:'text',span:expect.any(Object)})]});
 });
});
