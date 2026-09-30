import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeValue} from '../src/core/interpreter.js';
import {graph} from '../src/graph/graph.js';

describe('receiver methods and interface syntax',()=>{
  it('lowers a receiver method to the normal exact call engine',()=>{
    const r=compile('type User { name text } function User.display(self User) -> text { return self.name } function main(u User) -> text { return u.display() }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'main',[{name:'Ada'}])).toBe('Ada');
  });
  it('supports method arguments and generic receiver substitution',()=>{
    const r=compile('type Box<T> { value T } function Box.get(self Box<integer>) -> integer { return self.value } function main(b Box<integer>) -> integer { return b.get() }');
    expect(r.diagnostics).toEqual([]);
    expect(r.ir!.functions.find(f=>f.name==='get')!.returnType).toBe('integer');
    const returned=r.ir!.functions.find(f=>f.name==='main')!.body[0];
    expect(returned.kind==='return'&&returned.value.type).toBe('integer');
    expect(executeValue(r.ir!.functions,'main',[{value:7}])).toBe(7n);
  });
  it('executes resolved calls statically even when a local shadows the display name',()=>{
    const r=compile('function ping() -> text { return "static" } function main(ping text) -> text { return ping() }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'main',['shadow'])).toBe('static');
  });
  it('parses explicit interface and implementation declarations',()=>{
    const r=compile('type User { name text } interface Printable { print(self) -> text } impl Printable for User { function print(self User) -> text { return self.name } }');
    expect(r.diagnostics).toEqual([]);
    expect(r.ast.declarations.some(x=>x.kind==='InterfaceDeclaration')).toBe(true);
    expect(r.ast.declarations.some(x=>x.kind==='ImplDeclaration')).toBe(true);
    expect(r.ast.declarations.filter(x=>x.kind==='FunctionDeclaration')).toHaveLength(0);
    expect(r.ir!.implementations?.[0].methodIds?.length).toBe(1);
    expect(r.ir!.implementations?.[0].methodIds?.[0]).toMatch(/^FUNC-/);
  });
  it('retains generic constraint syntax in the AST',()=>{
    const r=compile('interface Printable { print(self) -> text } function show<T: Printable>(value T) -> text { return "ok" }');
    expect(r.diagnostics).toEqual([]);
    expect((r.ast.declarations.find(x=>x.kind==='FunctionDeclaration') as any).constraints).toEqual([{parameter:'T',interfaceName:'Printable'}]);
  });
  it('rejects incomplete implementations and unknown interfaces',()=>{
    const missing=compile('type User { name text } interface Printable { print(self) -> text } impl Printable for User { }');
    expect(missing.diagnostics.map(x=>x.code)).toContain('PIPE-IFACE-003');
    const unknown=compile('type User { name text } impl Missing for User { function print(self User) -> text { return self.name } }');
    expect(unknown.diagnostics.map(x=>x.code)).toContain('PIPE-IFACE-002');
  });
  it('rejects duplicate interface implementations for the same concrete type',()=>{
    const r=compile('type User { name text } interface Printable { print(self) -> text } impl Printable for User { function print(self User) -> text { return self.name } } impl Printable for User { function print(self User) -> text { return self.name } }','duplicate-impl.pipe');
    expect(r.diagnostics.map(x=>x.code)).toContain('PIPE-IFACE-006');
  });
  it('rejects a constrained generic call for a type without conformance',()=>{
    const r=compile('interface Printable { print(self) -> text } function show<T: Printable>(value T) -> text { return value.print() } function main() -> text { return show(5) }');
    expect(r.diagnostics.map(x=>x.code)).toContain('PIPE-GEN-006');
  });
  it('allows a constrained call when the concrete implementation exists',()=>{
    const r=compile('type User { name text } interface Printable { print(self) -> text } impl Printable for User { function print(self User) -> text { return self.name } } function show<T: Printable>(value T) -> text { return value.print() } function main(u User) -> text { return show(u) }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'main',[{name:'Ada'}])).toBe('Ada');
    const show=r.ir!.functions.find(f=>f.name==='show')!;
    const call=(show.body[0] as any).value;
    expect(call.interfaceId).toMatch(/^<input>::interface::\d+$/);
    expect(call.interfaceMethodId).toMatch(/^<input>::interface::\d+::method::\d+$/);
    expect(call.implementationFunctionId).toBe(r.ir!.functions.find(f=>f.name==='print')!.id);
  });
  it('uses one deterministic monomorphized target for repeated constrained calls',()=>{
    const r=compile('type User { name text } interface Printable { print(self) -> text } impl Printable for User { function print(self User) -> text { return self.name } } function show<T: Printable>(value T) -> text { return value.print() } function main(user User) -> text { let a = show(user) let b = show(user) return a + b }');
    expect(r.diagnostics).toEqual([]);
    expect(r.ir!.functions.filter(f=>f.name==='show')).toHaveLength(2);
    expect(executeValue(r.ir!.functions,'main',[{name:'A'}])).toBe('AA');
  });
  it('exposes interface and implementation nodes in the dependency graph',()=>{
    const r=compile('type User { name text } interface Printable { print(self) -> text } impl Printable for User { function print(self User) -> text { return self.name } }');
    const nodes=graph(r.ir!);const iface=nodes.find(x=>x.kind==='interface');const impl=nodes.find(x=>x.kind==='implementation');
    expect(iface?.children).toHaveLength(1);expect(impl?.references).toEqual([iface?.id]);
  });
});
