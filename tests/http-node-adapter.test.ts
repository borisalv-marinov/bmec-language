import {afterEach, describe, expect, it} from 'vitest';
import {primitive} from '../src/types/type-ref.js';
import {startNodeHttp, type NodeHttpHandle} from '../src/http/node-adapter.js';
import {authenticatedSession, sessionUser} from '../src/http/auth-policy.js';
import {SessionStore} from '../src/runtime/auth.js';
import {MemoryRateLimitStore} from '../src/http/rate-limit.js';

const route = {id: 'health', method: 'GET' as const, path: '/health/:id', pathParams: [{name: 'id', type: primitive('id'), required: true}], query: [], headers: [], responseBody: primitive('text'), status: 200, handlerId: 'health'};
const handles: NodeHttpHandle[] = [];
afterEach(async () => {for (const handle of handles.splice(0)) await handle.close();});

describe('Node HTTP adapter', () => {
  it('keeps liveness available while readiness is false', async () => {
    const store=new MemoryRateLimitStore();
    const handle=await startNodeHttp({routes:[]},undefined,{operations:{readiness:()=>false},rateLimit:{store,limit:1,windowMs:60000}});
    handles.push(handle);
    const live=await fetch(`${handle.url}/healthz`),ready=await fetch(`${handle.url}/readyz`),readyAgain=await fetch(`${handle.url}/readyz`);
    expect(live.status).toBe(200);expect(await live.json()).toEqual({status:'ok'});
    expect(ready.status).toBe(503);expect(await ready.json()).toEqual({status:'unavailable'});
    expect(readyAgain.status).toBe(503);
  });

  it('crosses the real socket boundary while preserving router contracts', async () => {
    const handle = await startNodeHttp({routes: [route]}, router => router.register('health', (_request, params) => ({status: 200, headers: {}, body: params.id})));
    handles.push(handle);
    const valid = await fetch(`${handle.url}/health/user_1`);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toBe('user_1');
    const invalid = await fetch(`${handle.url}/health/no%20space`);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe('invalid_path_param');
  });

  it('maps oversized request bodies to a bounded transport error', async () => {
    const post = {...route, method: 'POST' as const, path: '/health/:id', requestBody: primitive('text'), status: 200};
    const handle = await startNodeHttp({routes: [post]}, router => router.register('health', () => ({status: 200, headers: {}, body: 'ok'})), {maxBodyBytes: 4});
    handles.push(handle);
    const response = await fetch(`${handle.url}/health/a`, {method: 'POST', body: '12345'});
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe('request_too_large');
  });

  it('runs asynchronous handlers and validates query/capability boundaries', async () => {
    const program = {routes: [
      {...route, id: 'search', path: '/search/:id', query: [{name: 'q', type: primitive('text'), required: true}], handlerId: 'search'},
      {...route, id: 'secure', path: '/secure/:id', handlerId: 'secure', capabilities: ['environment' as const]},
    ]};
    const handle = await startNodeHttp(program, router => router
      .register('search', async (_request, params) => ({status: 200, headers: {}, body: `${params.id}:${params.q}`}))
      .register('secure', () => ({status: 200, headers: {}, body: 'secret'})), {suppliedCapabilities: new Set(['environment'])});
    handles.push(handle);
    const search = await fetch(`${handle.url}/search/u1?q=pipe`);
    expect(await search.json()).toBe('u1:pipe');
    expect((await fetch(`${handle.url}/search/u1`)).status).toBe(400);
    expect((await fetch(`${handle.url}/secure/u1`)).status).toBe(200);
  });

  it('converts handler failures into a stable 500 response', async () => {
    const handle = await startNodeHttp({routes: [route]}, router => router.register('health', () => { throw new Error('host detail must not leak'); }));
    handles.push(handle);
    const response = await fetch(`${handle.url}/health/user`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({error: 'internal_error'});
  });

  it('correlates responses with redacted local request events', async () => {
    const events: import('../src/http/node-adapter.js').HttpLogEvent[] = [];
    const handle = await startNodeHttp({routes: [route]}, router => router.register('health', () => { throw new Error('secret host detail'); }), {logger: event => events.push(event)});
    handles.push(handle);
    const response = await fetch(`${handle.url}/health/user?token=secret-query`,{headers:{authorization:'Bearer sentinel-private-token',cookie:'__Host-pipe_session=sentinel-session-secret'}});
    const requestId = response.headers.get('x-request-id');
    expect(response.status).toBe(500);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({requestId, method: 'GET', path: '/health/user', status: 500, outcome: 'application_error'});
    expect(JSON.stringify(events[0])).not.toContain('secret');
    expect(JSON.stringify(events[0])).not.toContain('sentinel-private-token');
    expect(JSON.stringify(events[0])).not.toContain('sentinel-session-secret');
  });

  it('preserves exact BMEC scalar wire values at the HTTP boundary', async () => {
    const exact = {...route, id: 'exact', path: '/exact/:id', responseBody: primitive('integer'), handlerId: 'exact'};
    const handle = await startNodeHttp({routes: [exact]}, router => router.register('exact', () => ({
      status: 200,
      headers: {},
      body: {kind: 'integer' as const, value: 9223372036854775807n},
    })));
    handles.push(handle);
    const response = await fetch(`${handle.url}/exact/u1`);
    expect(await response.json()).toEqual({version: 1, kind: 'integer', value: '9223372036854775807'});
  });

  it('enforces session authorization before invoking the handler', async () => {
    const store = new SessionStore(60_000);
    const session = store.create('user-1', 1000);
    let called = 0;
    const secured = {...route, id: 'secured', path: '/secured/:id', handlerId: 'secured', policyId: 'owner'};
    const handle = await startNodeHttp({routes: [secured]}, router => router
      .registerPolicy('owner', sessionUser(store, 'user-1', () => 1000))
      .register('secured', () => { called++; return {status: 200, headers: {}, body: 'ok'}; }));
    handles.push(handle);
    expect((await fetch(`${handle.url}/secured/a`)).status).toBe(403);
    const authorized = await fetch(`${handle.url}/secured/a`, {headers: {authorization: `Bearer ${session.id}`} });
    expect(authorized.status).toBe(200);
    expect(called).toBe(1);
    expect(await authenticatedSession(store, () => 1000)({method: 'GET', url: '/', headers: {authorization: `Bearer ${session.id}`}}, {})).toBe(true);
  });

  it('requires browser Origin and JSON content type when configured and emits security headers', async () => {
    const post={...route,id:'write',method:'POST' as const,path:'/write/:id',handlerId:'write'};
    const handle=await startNodeHttp({routes:[post]},router=>router.register('write',()=>({status:200,headers:{},body:'ok'})),{requireOriginForUnsafe:true,requireJsonContentType:true,contentSecurityPolicy:"default-src 'self'"});
    handles.push(handle);
    expect((await fetch(`${handle.url}/write/u1`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(403);
    const origin=new URL(handle.url).origin;
    expect((await fetch(`${handle.url}/write/u1`,{method:'POST',headers:{origin:'null','content-type':'application/json'},body:'{}'})).status).toBe(403);
    expect((await fetch(`${handle.url}/write/u1`,{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{}'})).status).toBe(403);
    expect((await fetch(`${handle.url}/write/u1`,{method:'POST',headers:{origin,'content-type':'text/plain'},body:'x'})).status).toBe(415);
    const accepted=await fetch(`${handle.url}/write/u1`,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('x-content-type-options')).toBe('nosniff');
    expect(accepted.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(accepted.headers.get('content-security-policy')).toBe("default-src 'self'");
  });

  it('returns bounded 429 responses from the configured request limiter', async () => {
    const handle=await startNodeHttp({routes:[route]},router=>router.register('health',(_request,params)=>({status:200,headers:{},body:params.id})),{rateLimit:{store:new MemoryRateLimitStore(),limit:1,windowMs:60000}});
    handles.push(handle);
    expect((await fetch(`${handle.url}/health/u1`)).status).toBe(200);
    const blocked=await fetch(`${handle.url}/health/u2`);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect(await blocked.json()).toEqual({error:'rate_limited'});
  });

  it('rejects requests that exceed the configured HTTP header budget', async () => {
    const handle=await startNodeHttp({routes:[route]},router=>router.register('health',()=>({status:200,headers:{},body:'ok'})),{maxHeaderBytes:1024});
    handles.push(handle);
    const response=await fetch(`${handle.url}/health/u1`,{headers:{'x-oversized':'x'.repeat(1500)}});
    expect(response.status).toBe(431);
  });
});
