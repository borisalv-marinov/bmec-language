import {createServer,type Server} from 'node:http';
import {afterEach,describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeAsyncValue,publicValue,UploadValue} from '../src/core/interpreter.js';
import {issueCapability} from '../src/runtime/capabilities.js';
import {parseMultipart} from '../src/http/multipart.js';

describe('typed outbound HTTP client',()=>{
 const servers:Server[]=[];
 afterEach(async()=>{for(const server of servers.splice(0))await new Promise<void>(resolve=>server.close(()=>resolve()));});
 it('requires the HTTP capability and returns a typed Result from a local server',async()=>{
  const server=createServer((request,response)=>{response.statusCode=request.url==='/missing'?404:200;response.end(request.url==='/missing'?'nope':'hello');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));servers.push(server);
  const address=server.address();if(!address||typeof address==='string')throw new Error('server did not bind');
  const source='app HttpClient\nasync function get(http capability<http>, url text) -> task<result<text,text>> { return await httpRequest(http, url, "GET", none, 1000) }';
  const compiled=compile(source,'http-client.bmec');expect(compiled.diagnostics).toEqual([]);
  const result=await executeAsyncValue(compiled.ir!.functions,'get',[issueCapability('http'),`http://127.0.0.1:${address.port}/hello`]);
  expect(publicValue(result)).toEqual({state:'ok',value:'hello'});
  const missing=await executeAsyncValue(compiled.ir!.functions,'get',[issueCapability('http'),`http://127.0.0.1:${address.port}/missing`]);
  expect(publicValue(missing)).toEqual({state:'err',error:'http_404'});
 });
 it('rejects an omitted or wrong capability at compile time',()=>{
  const result=compile('app Bad\nfunction get(value text, url text) -> task<result<text,text>> { return await httpRequest(value, url, "GET", none, 1000) }','http-client-capability.bmec');
  expect(result.diagnostics.map(error=>error.code)).toContain('PIPE-FUNC-009');
 });
 it('sends typed header and query key/value pairs through the extended request form',async()=>{
  const server=createServer((request,response)=>{
   if(request.url!=='/hello?q=hello+world'||request.headers['x-test']!=='yes'){response.statusCode=400;response.end('bad');return;}
   response.end('accepted');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));servers.push(server);
  const address=server.address();if(!address||typeof address==='string')throw new Error('server did not bind');
  const source='app HttpClientOptions\nasync function get(http capability<http>, url text) -> task<result<text,text>> { return await httpRequest(http, url, "GET", none, ["x-test", "yes"], ["q", "hello world"], 1000) }';
  const compiled=compile(source,'http-client-options.bmec');expect(compiled.diagnostics).toEqual([]);
  const result=await executeAsyncValue(compiled.ir!.functions,'get',[issueCapability('http'),`http://127.0.0.1:${address.port}/hello`]);
  expect(publicValue(result)).toEqual({state:'ok',value:'accepted'});
 });
 it('encodes typed JSON request bodies and decodes typed JSON responses',async()=>{
  let received='';
  const server=createServer((request,response)=>{
   const chunks:Buffer[]=[];request.on('data',chunk=>chunks.push(Buffer.from(chunk)));request.on('end',()=>{received=Buffer.concat(chunks).toString('utf8');response.setHeader('content-type','application/json');response.end('{"version":1,"kind":"integer","value":"42"}');});
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));servers.push(server);
  const address=server.address();if(!address||typeof address==='string')throw new Error('server did not bind');
  const source='app HttpClientJson\ntype Payload { count integer stamp date }\nasync function post(http capability<http>, url text, payload Payload) -> task<result<integer,text>> { return await httpRequestJson(http, url, "POST", payload, 1000) }';
  const compiled=compile(source,'http-client-json.bmec');expect(compiled.diagnostics).toEqual([]);
  const result=await executeAsyncValue(compiled.ir!.functions,'post',[issueCapability('http'),`http://127.0.0.1:${address.port}/json`,{count:7,stamp:'2026-09-21'}]);
  expect(publicValue(result)).toEqual({state:'ok',value:42});
  const wire=JSON.parse(received) as {version:number;kind:string;fields:Record<string,{kind:string;value:string}>};
  expect(wire.version).toBe(1);expect(wire.kind).toBe('record');expect(wire.fields.count).toEqual({version:1,kind:'integer',value:'7'});expect(wire.fields.stamp).toEqual({version:1,kind:'date',value:'2026-09-21'});
 });
 it('sends typed fields and upload values as bounded multipart data',async()=>{
  const server=createServer((request,response)=>{
   const chunks:Buffer[]=[];request.on('data',chunk=>chunks.push(Buffer.from(chunk)));request.on('end',()=>{const contentType=String(request.headers['content-type']??'');const parsed=parseMultipart(Buffer.concat(chunks),contentType);if(parsed.fields.title?.[0]!=='Report'||parsed.files[0]?.fieldName!=='attachment'||parsed.files[0]?.filename!=='hello.txt'||parsed.files[0]?.data.toString()!=='hello'){response.statusCode=400;response.end('bad');return;}response.end('accepted');});
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));servers.push(server);
  const address=server.address();if(!address||typeof address==='string')throw new Error('server did not bind');
  const source='app HttpClientMultipart\nasync function post(http capability<http>, url text, fields list<text>, names list<text>, files list<upload>) -> task<result<text,text>> { return await httpRequestMultipart(http, url, "POST", fields, names, files, 1000) }';
  const compiled=compile(source,'http-client-multipart.bmec');expect(compiled.diagnostics).toEqual([]);
  const result=await executeAsyncValue(compiled.ir!.functions,'post',[issueCapability('http'),`http://127.0.0.1:${address.port}/upload`,['title','Report'],['attachment'],[new UploadValue('hello.txt','text/plain',5,Buffer.from('hello'))]]);
  expect(publicValue(result)).toEqual({state:'ok',value:'accepted'});
 });
 it('rejects malformed header/query pairs at the runtime boundary',async()=>{
  const source='app HttpClientMalformed\nasync function get(http capability<http>, url text) -> task<result<text,text>> {\n let empty list<text> = []\n return await httpRequest(http, url, "GET", none, ["x-test"], empty, 1000)\n}';
  const compiled=compile(source,'http-client-malformed.bmec');expect(compiled.diagnostics).toEqual([]);
  await expect(executeAsyncValue(compiled.ir!.functions,'get',[issueCapability('http'),'http://127.0.0.1:1/hello'])).rejects.toMatchObject({code:'PIPE-HTTP-002'});
 });
});
