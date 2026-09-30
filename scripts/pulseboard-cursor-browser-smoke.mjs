import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {compile} from '../dist/compiler.js';
import {startRuntime} from '../dist/runtime/server.js';

const root=process.cwd();
const evidencePath=resolve(process.env.BMEC_PULSEBOARD_CURSOR_EVIDENCE_PATH??join(root,'docs','evidence','pulseboard','task-cursor-browser.json'));
const evidenceDir=dirname(evidencePath);
const dependencyDir=mkdtempSync(join(tmpdir(),'bmec-pulseboard-cursor-playwright-'));
const runtimeDir=mkdtempSync(join(tmpdir(),'bmec-pulseboard-cursor-runtime-'));
let browser,server;
try{
  execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',dependencyDir,'--no-save','--ignore-scripts','playwright@1.63.0'],{stdio:'inherit',shell:process.platform==='win32'});
  const playwright=await import(pathToFileURL(join(dependencyDir,'node_modules','playwright','index.js')).href);
  const {chromium}=playwright.default??playwright;
  let needsBrowser=!existsSync(chromium.executablePath());
  if(process.platform==='linux'&&!needsBrowser)try{needsBrowser=execFileSync('ldd',[chromium.executablePath()],{encoding:'utf8'}).includes('not found')}catch{needsBrowser=true}
  if(needsBrowser)execFileSync(join(dependencyDir,'node_modules','.bin',process.platform==='win32'?'playwright.cmd':'playwright'),['install',...(process.platform==='linux'?['--with-deps']:[]),'chromium'],{cwd:dependencyDir,stdio:'inherit',shell:process.platform==='win32'});

  const source=readFileSync(join(root,'examples','pulseboard','main.bmec'),'utf8');
  const compiled=compile(source,'examples/pulseboard/main.bmec');
  if(compiled.diagnostics.length)throw new Error(`PulseBoard compile failed: ${JSON.stringify(compiled.diagnostics)}`);
  const output=join(runtimeDir,'release');
  server=await startRuntime(compiled.ir,output,join(runtimeDir,'pulseboard.sqlite'),0,{authUsers:[{id:'member',password:'member password',role:'member'},{id:'manager',password:'manager password',role:'manager'}],defaultPolicy:'none'});
  const workspace=server.database.create('Workspace',{workspaceId:701,name:'Cursor workspace'});
  const foreignWorkspace=server.database.create('Workspace',{workspaceId:702,name:'Foreign workspace'});
  server.database.create('WorkspaceMembership',{workspaceId:workspace.workspaceId,authId:'member',role:'Member'});
  server.database.create('WorkspaceMembership',{workspaceId:workspace.workspaceId,authId:'manager',role:'Manager'});
  server.database.create('WorkspaceMembership',{workspaceId:foreignWorkspace.workspaceId,authId:'outsider',role:'Member'});
  const seeded=[];
  for(let index=0;index<125;index++){
    seeded.push(server.database.create('Task',{title:`Member task ${String(index).padStart(3,'0')}`,status:'Inbox',priority:'Low',ownerAuthId:'member',workspaceId:workspace.workspaceId}));
    if(index%3===0)server.database.create('Task',{title:`Other owner ${index}`,status:'Active',priority:'High',ownerAuthId:'manager',workspaceId:workspace.workspaceId});
  }
  for(let index=0;index<5;index++)server.database.create('Task',{title:`Foreign ${index}`,status:'Done',priority:'Medium',ownerAuthId:'outsider',workspaceId:foreignWorkspace.workspaceId});
  const login=await fetch(`${server.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'member',password:'member password'})});
  if(login.status!==200)throw new Error(`Login failed: ${login.status}`);
  const cookie=login.headers.get('set-cookie')?.split(';',1)[0];
  if(!cookie)throw new Error('Member login did not return a session cookie');
  const browserContext=await chromium.launch({headless:true});browser=browserContext;
  const context=await browser.newContext();
  await context.addCookies([{name:'pipe_session',value:decodeURIComponent(cookie.split('=',2)[1]),url:server.url}]);
  const page=await context.newPage();await page.setViewportSize({width:1440,height:900});
  const requests=[];page.on('response',async response=>{const path=new URL(response.url()).pathname;if(path==='/tasks'||path.startsWith('/tasks/pages/'))requests.push({path,status:response.status(),rows:response.status()===200?await response.json().catch(()=>[]):[]})});
  await page.goto(`${server.url}/#pipe-page--dashboard`,{waitUntil:'networkidle'});
  const table=page.locator('[data-model="Task"] table');
  await page.waitForFunction(()=>document.querySelectorAll('[data-model="Task"] tbody tr').length===50,{timeout:10000});
  const firstIds=await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>Number(row.cells[0].textContent)));
  const firstTitles=await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.cells[1].textContent));
  const next=page.locator('[data-pipe-crud-cursor-next]');
  if(await next.count()!==1||await next.isDisabled())throw new Error('Initial CRUD page did not expose an enabled accessible next-page button');
  const firstCursor=firstIds.at(-1);
  const secondResponse=page.waitForResponse(response=>new URL(response.url()).pathname===`/tasks/pages/${firstCursor}`,{timeout:10000});
  await next.focus();await page.keyboard.press('Enter');await secondResponse;
  await page.waitForFunction(()=>document.querySelectorAll('[data-model="Task"] tbody tr').length===50,{timeout:10000});
  const secondIds=await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>Number(row.cells[0].textContent)));
  const secondTitles=await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.cells[1].textContent));
  if(secondIds.some(id=>id<=firstCursor)||new Set([...firstIds,...secondIds]).size!==100)throw new Error('Second page contained a duplicate or out-of-order task');
  if(!(await next.isVisible())||await next.getAttribute('aria-label')!==null||await page.getByRole('button',{name:'Next page'}).count()!==1)throw new Error('Next-page button is not discoverable by its visible accessible name');
  await page.screenshot({path:join(evidenceDir,'task-cursor-next-page.png'),fullPage:true});
  const secondCursor=secondIds.at(-1);
  const thirdResponse=page.waitForResponse(response=>new URL(response.url()).pathname===`/tasks/pages/${secondCursor}`,{timeout:10000});
  await next.click();await thirdResponse;
  await page.waitForFunction(()=>document.querySelectorAll('[data-model="Task"] tbody tr').length===25,{timeout:10000});
  const thirdIds=await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>Number(row.cells[0].textContent)));
  if(new Set([...firstIds,...secondIds,...thirdIds]).size!==125||thirdIds.some(id=>id<=secondCursor))throw new Error('Final page duplicated or reordered a task');
  if(await next.count()!==1)throw new Error('Next-page control disappeared before the end probe');
  const endResponse=page.waitForResponse(response=>new URL(response.url()).pathname.startsWith('/tasks/pages/'),{timeout:10000});
  await next.click();await endResponse;
  await page.waitForFunction(()=>document.querySelector('[data-pipe-crud-cursor-next]')?.hidden===true,{timeout:5000});
  const endMessage=await page.locator('[data-pipe-cursor-status="tasks"]').innerText();
  if(!endMessage.includes('No more records.'))throw new Error(`End-of-list status was not announced: ${endMessage}`);
  if(!(await page.locator('[data-pipe-cursor-status="tasks"]').isVisible()))throw new Error('End-of-list status is not visible to the user');
  const allRows=[...firstIds,...secondIds,...thirdIds].map(id=>seeded.find(row=>row.id===id));
  if(allRows.some(row=>!row||row.workspaceId!==workspace.workspaceId||row.ownerAuthId!=='member'))throw new Error('Browser task pages leaked a different owner or workspace');
  const evidence={schemaVersion:'bmec.evidence.pulseboard-task-cursor-browser.v1',classification:'maintainer-written PulseBoard HTTP/browser application evidence; not a fresh AI cold-start trial',workspace:workspace.workspaceId,member:{expectedRows:125,pageSizes:[firstIds.length,secondIds.length,thirdIds.length],ids:[...firstIds,...secondIds,...thirdIds],allRowsOwnerScoped:true,allRowsWorkspaceScoped:true,noDuplicates:true,ascendingById:true,requests:requests.map(request=>({path:request.path,status:request.status,rowCount:request.rows.length}))},managerAccess:'covered by authenticated SQLite route tests; manager retains workspace-wide scope',endState:{message:endMessage,visible:true},accessibleControl:{role:'button',name:'Next page',keyboardActivated:true},crud:{editButtons:await table.locator('[data-edit]').count(),deleteButtons:await table.locator('[data-delete]').count(),createFormPresent:await page.locator('[data-model="Task"] form button[type="submit"]').count()===1},screenshots:['task-cursor-next-page.png','task-cursor-final-page.png'],limitations:['SQLite runtime; PostgreSQL cursor route not run live','forward-only cursor traversal; concurrent changes between pages are not snapshot-isolated']};
  await page.screenshot({path:join(evidenceDir,'task-cursor-final-page.png'),fullPage:true});
  writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
  await context.close();
}finally{
  if(browser)await browser.close();
  if(server)await server.close();
  rmSync(dependencyDir,{recursive:true,force:true});
  rmSync(runtimeDir,{recursive:true,force:true});
}
