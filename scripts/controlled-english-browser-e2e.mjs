import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';
import {compile} from '../dist/compiler.js';
import {buildRelease} from '../dist/release/release.js';
import {startNodeRelease} from '../dist/release/server.js';
import {ensureSqliteSchema} from '../dist/db/sqlite.js';
import {sqliteAdapter} from '../dist/db/adapter.js';
import {issueCapability} from '../dist/runtime/capabilities.js';
import {AuthService} from '../dist/runtime/auth.js';
import {authenticatedSession} from '../dist/http/auth-policy.js';
import {registerAuthHandlers} from '../dist/http/auth-handlers.js';

const source=readFileSync(join(process.cwd(),'examples','controlled-english','main.bmec'),'utf8');
const compiled=compile(source,'examples/controlled-english/main.bmec');
if(compiled.diagnostics.length||!compiled.ir)throw new Error('controlled-English fixture did not compile');
const releaseDir=mkdtempSync(join(tmpdir(),'bmec-controlled-browser-release-'));
const playwrightDir=mkdtempSync(join(tmpdir(),'bmec-controlled-browser-playwright-'));
const authRoutes=[
 {id:'register',method:'POST',path:'/auth/register',pathParams:[],query:[],headers:[],status:201,errorStatuses:[400,409],handlerId:'register'},
 {id:'login',method:'POST',path:'/auth/login',pathParams:[],query:[],headers:[],status:200,errorStatuses:[400,401],handlerId:'login'},
 {id:'logout',method:'POST',path:'/auth/logout',pathParams:[],query:[],headers:[],status:204,errorStatuses:[401],handlerId:'logout'},
];
const releaseIR={...compiled.ir,http:{routes:[...(compiled.ir.http?.routes??[]),...authRoutes]}};
buildRelease(releaseIR,releaseDir,{packageName:'controlled-english',packageVersion:'0.1.0',languageVersion:'0.1-alpha'});
const browserArtifact=readFileSync(join(releaseDir,'index.html'),'utf8');
const appArtifact=readFileSync(join(releaseDir,'app.js'),'utf8');
if(!browserArtifact.includes('data-model="Task"')||!browserArtifact.includes('data-pipe-event="Save"'))throw new Error('controlled-English form/API markup missing');
const browserText=`${browserArtifact}\n${appArtifact}`;
for(const forbidden of ['databaseSelect','databaseInsert','capability<database>','AuthService','SessionStore','passwordHash','scrypt','pipe_session','APP_SECRET'])if(browserText.includes(forbidden))throw new Error(`server-only auth or database symbol leaked into browser artifact: ${forbidden}`);
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',playwrightDir,'--no-save','--ignore-scripts','playwright@1.63.0'],{stdio:'inherit',shell:process.platform==='win32'});
const playwright=await import(pathToFileURL(join(playwrightDir,'node_modules','playwright','index.js')).href);
const {chromium}=playwright.default??playwright;
let browserNeedsDeps=!existsSync(chromium.executablePath());
if(process.platform==='linux'&&!browserNeedsDeps)try{browserNeedsDeps=execFileSync('ldd',[chromium.executablePath()],{encoding:'utf8'}).includes('not found')}catch{browserNeedsDeps=true}
if(browserNeedsDeps)execFileSync(join(playwrightDir,'node_modules','.bin',process.platform==='win32'?'playwright.cmd':'playwright'),['install',...(process.platform==='linux'?['--with-deps']:[]),'chromium'],{cwd:playwrightDir,stdio:'inherit',shell:process.platform==='win32'});
const database=new Database(':memory:');ensureSqliteSchema(database,releaseIR.db);
const auth=new AuthService();await auth.register('owner','owner pass');
const server=await startNodeRelease(releaseDir,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(database,releaseIR.db),schema:releaseIR.db},configureRouter:router=>{registerAuthHandlers(router,auth,{register:'register',login:'login',logout:'logout'},false);router.registerPolicy('authenticated',authenticatedSession(auth.sessions));}});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();let saveClicks=0;
 await page.addInitScript(()=>{globalThis.PIPE_UI_EVENTS={Save:()=>{globalThis.__saveClicks=(globalThis.__saveClicks??0)+1}}});
 await page.goto(`${server.url}/`,{waitUntil:'networkidle'});
 const denied=await page.evaluate(async()=>{const response=await fetch('/tasks');return response.status});if(denied!==403)throw new Error(`unauthenticated Task request returned ${denied}`);
 const privateArtifact=await page.evaluate(async()=>{const response=await fetch('/server-ir.json');return response.status});if(privateArtifact!==404)throw new Error(`private server artifact returned ${privateArtifact}`);
 const login=await page.evaluate(async()=>{const response=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'owner',password:'owner pass'})});return response.status});if(login!==200)throw new Error(`browser login returned ${login}`);
 const sessionCookie=(await page.context().cookies()).find(cookie=>cookie.name==='pipe_session');if(!sessionCookie?.httpOnly)throw new Error('release session cookie is not HttpOnly');if(await page.evaluate(()=>document.cookie.includes('pipe_session')))throw new Error('release session cookie is exposed to document.cookie');
 await page.reload({waitUntil:'networkidle'});
 const crud=page.locator('[data-model="Task"]'),title=crud.locator('input[name="title"]'),owner=crud.locator('input[name="ownerId"]'),done=crud.locator('input[name="done"]');
 await crud.getByRole('button',{name:'Add'}).click();const nativeInvalid=await title.evaluate(element=>!(element).checkValidity());if(!nativeInvalid)throw new Error('required Task validation did not block empty submit');
 await title.fill('Browser task');await owner.fill('1');await done.check();await crud.getByRole('button',{name:'Add'}).click();
 const rows=await page.evaluate(async()=>{const response=await fetch('/tasks');if(response.status!==200)throw new Error(`authenticated Task request returned ${response.status}`);return response.json()});
 if(rows.length!==1||rows[0].title!=='Browser task'||rows[0].ownerId!==1||rows[0].done!==true)throw new Error('release server did not persist the browser-created Task');
 await page.locator('form[data-pipe-component] input[name="title"]').fill('Browser task');await page.locator('button[data-pipe-event="Save"]').click();saveClicks=await page.evaluate(()=>globalThis.__saveClicks??0);if(saveClicks!==1)throw new Error(`Save event fired ${saveClicks} times`);
 const logout=await page.evaluate(async()=>{const response=await fetch('/auth/logout',{method:'POST'});return response.status});if(logout!==204)throw new Error(`browser logout returned ${logout}`);
 const revoked=await page.evaluate(async()=>{const response=await fetch('/tasks');return response.status});if(revoked!==403)throw new Error(`revoked browser session returned ${revoked}`);
 console.log('CONTROLLED_ENGLISH_BROWSER_E2E PASS — unauthenticated access denied, browser login enabled typed Task creation, persisted data, Save event dispatched, and logout revoked the session');
}finally{await browser.close();await server.close();database.close();rmSync(releaseDir,{recursive:true,force:true});rmSync(playwrightDir,{recursive:true,force:true})}
