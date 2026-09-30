import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compile} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

const connection=process.env.BMEC_POSTGRES_URL;
const maybePostgres=connection?it:it.skip;
const handles:RuntimeHandle[]=[];
const roots:string[]=[];

afterEach(async()=>{
  for(const handle of handles.splice(0))await handle.close();
  for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});
});

describe('PostgreSQL runtime startup',()=>{
  maybePostgres('does not open or migrate a stale SQLite compatibility database',async()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-pg-runtime-startup-'));
    roots.push(root);
    const databasePath=join(root,'app.sqlite');
    const oldSource='app Startup\nmodel User { email text required }';
    const currentSource='app Startup\nmodel User { authId text required email text required }';
    const old=compile(oldSource),current=compile(currentSource);
    expect(old.ir).toBeTruthy();expect(current.ir).toBeTruthy();

    const sqliteHandle=await startRuntime(old.ir!,join(root,'old-generated'),databasePath,0);
    await sqliteHandle.close();

    const runtime=await startRuntime(current.ir!,join(root,'current-generated'),databasePath,0,{
      authUsers:[{id:'admin',password:'admin password',role:'admin'}],
      postgresUrl:connection,
    });
    handles.push(runtime);
    expect(runtime.url).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/);
    expect(runtime.database).toBeUndefined();
  });
});
