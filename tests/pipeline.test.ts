import {describe,it,expect} from 'vitest'; import {parse} from '../src/parser/parser.js'; import {compile} from '../src/compiler.js'; import {toIR} from '../src/ir/ir.js'; import {graph} from '../src/graph/graph.js';
const source=`app Todo
model Task { title text required done boolean default false }
page Home { crud Task }
style clean dark`;
describe('PIPE pipeline',()=>{it('parses canonical syntax',()=>expect(parse(source).declarations).toHaveLength(4)); it('produces deterministic typed IR',()=>{const r=compile(source,'todo.pipe'); expect(r.diagnostics).toEqual([]); expect(r.ir?.models[0].fields[1].default).toBe(false); expect(r.ir?.models[0].id).toBe('DB-001')}); it('builds references in graph',()=>{const r=compile(source); expect(graph(r.ir!).find(n=>n.kind==='page')?.references).toEqual(['DB-001'])}); it('reports semantic errors',()=>{const r=compile('app X\nmodel User { age integer default "bad" }\npage Home { crud Product }','bad.pipe'); expect(r.diagnostics.map(x=>x.code)).toEqual(['PIPE-TYPE-002','PIPE-REF-001'])}); it('rejects malformed syntax',()=>expect(()=>parse('model X { name text')).toThrow('PIPE-SYN-003'))});
