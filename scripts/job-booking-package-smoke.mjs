import {execFileSync,spawn} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execNpm} from './npm-runner.mjs';

const root=mkdtempSync(join(tmpdir(),'bmec-job-booking-package-'));
const run=(args,options={})=>execNpm(args,{encoding:'utf8',...options});
try {
  const archive=process.env.BMEC_PACKAGE_ARCHIVE?resolve(process.env.BMEC_PACKAGE_ARCHIVE):join(root,JSON.parse(run(['pack','--pack-destination',root,'--json']))[0].filename),install=join(root,'install'),app=join(root,'app');
  run(['install','--prefix',install,'--no-audit','--no-fund',archive],{stdio:'inherit'});
  mkdirSync(app);for(const file of ['bmec.toml','bmec.lock','main.bmec'])cpSync(join(process.cwd(),'examples','job-booking',file),join(app,file));
  const cli=join(install,'node_modules','bmec','dist','cli','index.js');
  if(!existsSync(cli))throw new Error('installed BMEC CLI is missing');
  execFileSync(process.execPath,[cli,'check',join(app,'main.bmec')],{stdio:'inherit'});
  execFileSync(process.execPath,[cli,'build',join(app,'main.bmec'),'--release'],{stdio:'inherit'});
  const env={...process.env,BMEC_PORT:'0',BMEC_AUTH_USERS:JSON.stringify([{id:'admin',password:'admin-pass-123',role:'admin'},{id:'worker',password:'worker-pass-123',role:'worker'}])};
  const start=async()=>{const child=spawn(process.execPath,[cli,'run',join(app,'main.bmec')],{env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>{output+=chunk.toString()});child.stderr.on('data',chunk=>{output+=chunk.toString()});const deadline=Date.now()+15000;let url;while(Date.now()<deadline&&!url){url=output.match(/http:\/\/[^\s]+/)?.[0];if(!url)await new Promise(resolve=>setTimeout(resolve,100));}if(!url){child.kill('SIGKILL');throw new Error(`packaged Job Booking server did not start: ${output}`)}return{child,url};};
  const stop=child=>new Promise((resolve,reject)=>{if(child.exitCode!==null){resolve();return}const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('packaged Job Booking server did not stop gracefully'))},5000);child.once('exit',()=>{clearTimeout(timeout);resolve()});child.kill('SIGINT')});
  let child,url;
  try {
    ({child,url}=await start());
    const login=await fetch(`${url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin-pass-123'})});if(login.status!==200)throw new Error(`packaged login returned ${login.status}`);
    const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw new Error('packaged login did not issue a session cookie');
    const customerUrl=`${url}/customers`,headers={cookie,'content-type':'application/json'};
    const customers=await fetch(customerUrl,{headers});if(customers.status!==200)throw new Error(`packaged authenticated customers returned ${customers.status}`);
    const initial=await customers.json();if(!Array.isArray(initial))throw new Error('packaged customers response was not a list');
    const created=await fetch(customerUrl,{method:'POST',headers,body:JSON.stringify({name:'Package Smoke Customer',email:'package-smoke@example.test',phone:'555-0100'})});if(!created.ok)throw new Error(`packaged customer create returned ${created.status}`);
    const reloaded=await fetch(customerUrl,{headers});if(reloaded.status!==200)throw new Error(`packaged customer reread returned ${reloaded.status}`);
    const rows=await reloaded.json();if(!Array.isArray(rows)||!rows.some(row=>row.email==='package-smoke@example.test'))throw new Error('packaged SQLite customer create/read round trip did not persist');
    await stop(child);child=undefined;
    ({child,url}=await start());
    const restartedLogin=await fetch(`${url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin-pass-123'})});if(restartedLogin.status!==200)throw new Error(`packaged login after restart returned ${restartedLogin.status}`);
    const restartedCookie=restartedLogin.headers.get('set-cookie')?.split(';')[0];if(!restartedCookie)throw new Error('packaged restart login did not issue a session cookie');
    const restartedCustomers=await fetch(`${url}/customers`,{headers:{cookie:restartedCookie}});if(restartedCustomers.status!==200)throw new Error(`packaged customers after restart returned ${restartedCustomers.status}`);
    const persisted=await restartedCustomers.json();if(!persisted.some(row=>row.email==='package-smoke@example.test'))throw new Error('packaged SQLite customer did not survive a server restart');
    const evidence={schemaVersion:'bmec.evidence.bmec-0.8-job-booking-installed-package.v1',status:'PASS',archive:archive.split(/[\\/]/).at(-1),installed:true,check:true,releaseBuild:true,authentication:true,sqliteCustomerCreateRead:true,restartPersistence:true};
    const evidencePath=process.env.BMEC_JOB_BOOKING_PACKAGE_EVIDENCE;if(evidencePath){mkdirSync(dirname(resolve(evidencePath)),{recursive:true});writeFileSync(resolve(evidencePath),`${JSON.stringify(evidence,null,2)}\n`)}
    console.log(`JOB_BOOKING_PACKAGE_SMOKE PASS — installed ${archive.split(/[\\/]/).at(-1)}, checked, released, authenticated, and verified SQLite persistence across restart at ${url}`);
  } finally {if(child)await stop(child);}
} finally {rmSync(root,{recursive:true,force:true});}
