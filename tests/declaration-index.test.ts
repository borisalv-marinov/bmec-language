import {describe,expect,it} from 'vitest';
import {parse} from '../src/parser/parser.js';
import {buildDeclarationIndex} from '../src/semantic/declaration-index.js';
import {functionId} from '../src/identity.js';
import {analyzeProgram} from '../src/semantic/analyze.js';

describe('canonical declaration index',()=>it('indexes interfaces, requirements, impls, and nested methods immutably',()=>{
 const ast=parse('interface Printable { print(self) -> text } impl Printable for User { function print(self User) -> text { return "ok" } }','module-a.pipe');
 const method=(ast.declarations[1] as any).methods[0];const index=buildDeclarationIndex(ast,new Map([[method,functionId('FUNC-001')]]));
 expect(index.interfaces.size).toBe(1);expect(index.interfaceMethods.size).toBe(1);expect(index.impls.size).toBe(1);expect(index.functions.get('FUNC-001' as any)).toBe(method);
 const other=buildDeclarationIndex(parse('interface Printable { print(self) -> text }','module-b.pipe'));expect([...index.interfaces.keys()][0]).not.toBe([...other.interfaces.keys()][0]);
}));

it('does not mutate the source AST during semantic analysis',()=>{
 const ast=parse('type User { name text } interface Printable { print(self) -> text } impl Printable for User { function print(self User) -> text { return self.name } }','stable.pipe');
 const before=JSON.stringify(ast);
 analyzeProgram(ast);
 analyzeProgram(ast);
 expect(JSON.stringify(ast)).toBe(before);
});

it('links a uniquely named imported interface to a foreign-module implementation by canonical ID',()=>{
 const iface=parse('interface Printable { print(self) -> text }','lib.pipe');
 const impl=parse('type User { name text } impl Printable for User { function print(self User) -> text { return self.name } }','app.pipe');
 const methods=(impl.declarations[1] as any).methods as any[];
 const index=buildDeclarationIndex({kind:'Program',imports:[],declarations:[...iface.declarations,...impl.declarations],span:iface.span} as any,new Map(methods.map((m,i)=>[m,functionId(`FUNC-${i+1}`)])));
 const entry=[...index.impls.values()][0];
 expect(entry.interfaceId).toBe([...index.interfaces.keys()][0]);
});

it('keeps duplicate display names distinct by declaration identity',()=>{
 const ast=parse('interface Printable { print(self) -> text } interface Printable { print(self) -> text }','dupes.pipe');
 const index=buildDeclarationIndex(ast);
 expect(index.interfaces.size).toBe(2);
 expect(new Set([...index.interfaces.keys()]).size).toBe(2);
});
