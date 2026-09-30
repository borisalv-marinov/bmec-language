import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

const handles:RuntimeHandle[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();});

describe('personal reading queue custom routes',()=>{
  it('requires sign-in, writes the server principal as owner, and isolates two users',async()=>{
    const file='examples/reading-queue/main.bmec';
    const compiled=compile(readFileSync(file,'utf8'),file);
    expect(compiled.diagnostics).toEqual([]);
    const root=mkdtempSync(join(tmpdir(),'bmec-reading-queue-'));
    const handle=await startRuntime(compiled.ir!,join(root,'generated'),join(root,'queue.sqlite'),0,{
      authUsers:[
        {id:'alice',password:'alice test password',role:'reader'},
        {id:'bob',password:'bob test password',role:'reader'},
      ],
      defaultPolicy:'none',
    });
    handles.push(handle);
    const signIn=async(id:string,password:string)=>{
      const response=await fetch(`${handle.url}/auth/login`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({id,password}),
      });
      expect(response.status,await response.clone().text()).toBe(200);
      return response.headers.get('set-cookie')!.split(';',1)[0]!;
    };
    const alice=await signIn('alice','alice test password');
    const bob=await signIn('bob','bob test password');

    expect((await fetch(`${handle.url}/books`)).status).toBe(403);
    expect((await fetch(`${handle.url}/books`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Anonymous book'}),
    })).status).toBe(403);

    const aliceCreate=await fetch(`${handle.url}/books`,{
      method:'POST',headers:{cookie:alice,'content-type':'application/json'},
      body:JSON.stringify({title:'Alice book'}),
    });
    expect(aliceCreate.status,await aliceCreate.clone().text()).toBe(200);
    const bobCreate=await fetch(`${handle.url}/books`,{
      method:'POST',headers:{cookie:bob,'content-type':'application/json'},
      body:JSON.stringify({title:'Bob book'}),
    });
    expect(bobCreate.status,await bobCreate.clone().text()).toBe(200);

    const forged=await fetch(`${handle.url}/books`,{
      method:'POST',headers:{cookie:alice,'content-type':'application/json'},
      body:JSON.stringify({title:'Forged owner',ownerId:'bob'}),
    });
    expect(forged.status).toBe(400);

    const aliceBooks=await fetch(`${handle.url}/books`,{headers:{cookie:alice}});
    const bobBooks=await fetch(`${handle.url}/books`,{headers:{cookie:bob}});
    expect(await aliceBooks.json()).toMatchObject([{title:'Alice book',ownerId:'alice',finished:false}]);
    expect(await bobBooks.json()).toMatchObject([{title:'Bob book',ownerId:'bob',finished:false}]);
    expect((await (await fetch(`${handle.url}/books`,{headers:{cookie:alice}})).json()).map((book:{title:string})=>book.title)).not.toContain('Bob book');
    expect((await (await fetch(`${handle.url}/books`,{headers:{cookie:bob}})).json()).map((book:{title:string})=>book.title)).not.toContain('Alice book');
  });
});
