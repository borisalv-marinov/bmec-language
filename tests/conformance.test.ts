import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {compile} from '../src/compiler.js';
import {executeValue,Money} from '../src/core/interpreter.js';

const root=join(process.cwd(),'tests','conformance');
describe('conformance corpus',()=>{
  for(const file of readdirSync(join(root,'valid')).filter(x=>x.endsWith('.pipe'))){it(`valid/${file}`,()=>{const r=compile(readFileSync(join(root,'valid',file),'utf8'),file);expect(r.diagnostics).toEqual([]);const expected=JSON.parse(readFileSync(join(root,'valid',file.replace('.pipe','.expected.json')),'utf8'));const result=executeValue(r.ir!.functions,expected.function,expected.args);const returnType=r.ir!.functions.find(f=>f.name===expected.function)?.returnTypeRef;expect(result).toEqual(returnType?.kind==='primitive'&&returnType.name==='integer'?BigInt(expected.returns):returnType?.kind==='primitive'&&returnType.name==='money'?new Money(BigInt(Math.round(expected.returns*100))):expected.returns)})}
  for(const file of readdirSync(join(root,'invalid')).filter(x=>x.endsWith('.pipe'))){it(`invalid/${file}`,()=>{const r=compile(readFileSync(join(root,'invalid',file),'utf8'),file);const expected=JSON.parse(readFileSync(join(root,'invalid',file.replace('.pipe','.expected.json')),'utf8'));expect(r.diagnostics.map(x=>x.code)).toEqual(expect.arrayContaining(expected.diagnostics));expect(r.ir).toBeUndefined()})}
});
