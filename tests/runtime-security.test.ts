import {describe,it,expect,afterEach} from 'vitest';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

let handles:RuntimeHandle[]=[];afterEach(async()=>{for(const h of handles.splice(0))await h.close()});
async function boot(){const r=compile('app X\nmodel Item { value text unique }');const root=mkdtempSync(join(tmpdir(),'pipe-sec-'));const h=await startRuntime(r.ir!,join(root,'out'),join(root,'x.db'),0);handles.push(h);return h}
describe('runtime robustness',()=>{
  it('keeps SQL-like input as data',async()=>{const h=await boot();const value="x'); DROP TABLE pipe_Item; --";const r=await fetch(h.url+'/api/Item',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value})});expect(r.status).toBe(201);expect((await (await fetch(h.url+'/api/Item')).json())[0].value).toBe(value)});
  it('rejects wrong content type and unexpected methods',async()=>{const h=await boot();expect((await fetch(h.url+'/api/Item',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'})).status).toBe(415);expect((await fetch(h.url+'/api/Item',{method:'PATCH'})).status).toBe(405)});
  it('returns structured route and id errors',async()=>{const h=await boot();const missing=await fetch(h.url+'/api/Nope');expect(missing.status).toBe(404);expect((await missing.json()).error.code).toBe('PIPE-NET-004');const bad=await fetch(h.url+'/api/Item/nope');expect(bad.status).toBe(400);expect((await bad.json()).diagnostic.code).toBe('PIPE-VAL-001');const route=await fetch(h.url+'/unknown');expect(route.status).toBe(404);expect((await route.json()).error.code).toBe('PIPE-NET-004')});
  it('maps duplicate unique values to a structured conflict',async()=>{const h=await boot();const headers={'content-type':'application/json'};expect((await fetch(h.url+'/api/Item',{method:'POST',headers,body:JSON.stringify({value:'same'})})).status).toBe(201);const r=await fetch(h.url+'/api/Item',{method:'POST',headers,body:JSON.stringify({value:'same'})});expect(r.status).toBe(409);expect((await r.json()).diagnostic.code).toBe('PIPE-DB-004')});
  it('enforces the request body limit',async()=>{const h=await boot();const r=await fetch(h.url+'/api/Item',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:'x'.repeat(1_000_001)})});expect(r.status).toBe(413);expect((await r.json()).diagnostic.code).toBe('PIPE-NET-001')});
  it('redacts malformed JSON payloads from external diagnostics',async()=>{const h=await boot();const secret='do-not-echo-this';const r=await fetch(h.url+'/api/Item',{method:'POST',headers:{'content-type':'application/json'},body:`{"value":"${secret}"`});const text=await r.text();expect(r.status).toBe(400);expect(text).toContain('PIPE-VAL-003');expect(text).not.toContain(secret)});
  it('escapes script-like values in generated HTML data paths',async()=>{const h=await boot();const value='<script>alert(1)</script>';await fetch(h.url+'/api/Item',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value})});const html=await (await fetch(h.url)).text();expect(html).not.toContain(value)});
});
