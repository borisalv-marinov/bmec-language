import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {compile} from '../dist/compiler.js';
import {startRuntime} from '../dist/runtime/server.js';

const root=mkdtempSync(join(tmpdir(),'bmec-community-issues-browser-'));
const playwrightDir=mkdtempSync(join(tmpdir(),'bmec-community-issues-playwright-'));
let server,browser;
const startupSamplesMs=[],uiInteractionSamples=[],requestSamples=[];
const concurrentRequestSamples=[];
const repositorySearchPath='/repositories/by-slug/bmec-search-fixture/issues/search/needle%20%26%20build';
const elapsedMs=start=>Number((performance.now()-start).toFixed(3));
const measureUi=async(name,action)=>{const start=performance.now();await action();uiInteractionSamples.push({name,durationMs:elapsedMs(start)});};
const sampleSummary=samples=>{const values=[...samples].sort((a,b)=>a-b);if(!values.length)return {count:0};const median=values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2;const percentile95=values[Math.ceil(values.length*.95)-1];return {count:values.length,p50Ms:Number(median.toFixed(3)),p95Ms:Number(percentile95.toFixed(3)),minMs:Number(values[0].toFixed(3)),maxMs:Number(values.at(-1).toFixed(3))};};
const databaseBackend=process.env.BMEC_APP_PERF_DATABASE??'sqlite';
const uiRepeats=Number(process.env.BMEC_APP_PERF_UI_REPEATS??1);
const concurrency=Number(process.env.BMEC_APP_PERF_CONCURRENCY??8);
const concurrentWaves=Number(process.env.BMEC_APP_PERF_CONCURRENT_WAVES??1);
let adminPool,scopedPostgresUrl,postgresSchema;
try {
  const source=readFileSync(join(process.cwd(),'examples','community-issues','main.bmec'),'utf8');
  const compiled=compile(source,'examples/community-issues/main.bmec');
  if(compiled.diagnostics.length||!compiled.ir)throw new Error(`Community Issues compile failed: ${compiled.diagnostics.map(item=>item.code).join(', ')}`);
  if(!Number.isSafeInteger(uiRepeats)||uiRepeats<1||uiRepeats>20||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>32||!Number.isSafeInteger(concurrentWaves)||concurrentWaves<1||concurrentWaves>20)throw new Error('App benchmark bounds: UI repeats/waves must be 1–20 and concurrency must be 1–32');
  if(!['sqlite','postgres'].includes(databaseBackend))throw new Error('BMEC_APP_PERF_DATABASE must be sqlite or postgres');
  if(databaseBackend==='postgres'){
    const baseUrl=process.env.BMEC_POSTGRES_URL;
    if(!baseUrl||process.env.BMEC_POSTGRES_DISPOSABLE!=='1')throw new Error('PostgreSQL app benchmark requires BMEC_POSTGRES_URL and explicit BMEC_POSTGRES_DISPOSABLE=1 for a verified disposable target');
    adminPool=new Pool({connectionString:baseUrl});
    postgresSchema=`bmec_issues_perf_${process.pid}_${randomBytes(4).toString('hex')}`;
    await adminPool.query(`CREATE SCHEMA "${postgresSchema}"`);
    const target=new URL(baseUrl);target.searchParams.set('options',`-c search_path=${postgresSchema}`);scopedPostgresUrl=target.toString();
  }
  const databasePath=join(root,'community-issues.sqlite');
  const authUsers=[{id:'reporter',password:'reporter pass',role:'reporter'},{id:'maintainer',password:'maintainer pass',role:'maintainer'}];
  const startMeasuredRuntime=async generation=>{const started=performance.now();const runtime=await startRuntime(compiled.ir,join(root,generation),databasePath,0,{authUsers,defaultPolicy:'none',...(scopedPostgresUrl?{postgresUrl:scopedPostgresUrl}:{})});startupSamplesMs.push(elapsedMs(started));return runtime;};
  server=await startMeasuredRuntime('generated');
  let repository,foreignRepository;
  if(databaseBackend==='sqlite'){
    repository=server.database.create('Repository',{name:'BMEC search fixture',slug:'bmec-search-fixture'});
    foreignRepository=server.database.create('Repository',{name:'Foreign fixture',slug:'foreign-fixture'});
    for(let index=0;index<126;index++){server.database.create('Issue',{repository:repository.id,title:index%9===0?`needle & build report ${index}`:`Report ${index}`,description:index%9===0?'Ordinary report details':`Reproduction includes needle & build as literal description ${index}`,state:'Open',createdBy:'reporter',createdAt:Date.now()});if(index%4===0)server.database.create('Issue',{repository:foreignRepository.id,title:`Foreign ${index}`,description:'Outside selected repository',state:'Open',createdBy:'reporter',createdAt:Date.now()});}
    for(let index=0;index<9;index++)server.database.create('Issue',{repository:repository.id,title:`Noise ${index}`,description:'No search phrase here',state:'Open',createdBy:'reporter',createdAt:Date.now()});
    server.database.create('IssueComment',{issue:1,body:'Browser issue detail fixture comment',createdBy:'reporter'});
  }else{
    const pool=new Pool({connectionString:scopedPostgresUrl});
    try{
      repository=(await pool.query('INSERT INTO "Repository" ("name","slug") VALUES ($1,$2) RETURNING "id"',['BMEC search fixture','bmec-search-fixture'])).rows[0];
      foreignRepository=(await pool.query('INSERT INTO "Repository" ("name","slug") VALUES ($1,$2) RETURNING "id"',['Foreign fixture','foreign-fixture'])).rows[0];
      const issues=[];
      for(let index=0;index<126;index++){issues.push([repository.id,index%9===0?`needle & build report ${index}`:`Report ${index}`,index%9===0?'Ordinary report details':`Reproduction includes needle & build as literal description ${index}`,'Open','reporter',Date.now()]);if(index%4===0)issues.push([foreignRepository.id,`Foreign ${index}`,'Outside selected repository','Open','reporter',Date.now()]);}
      for(let index=0;index<9;index++)issues.push([repository.id,`Noise ${index}`,'No search phrase here','Open','reporter',Date.now()]);
      for(const [repo,title,description,state,createdBy,createdAt] of issues)await pool.query('INSERT INTO "Issue" ("repository","title","description","state","createdBy","createdAt") VALUES ($1,$2,$3,$4,$5,$6)',[repo,title,description,state,createdBy,createdAt]);
      await pool.query('INSERT INTO "IssueComment" ("issue","body","createdBy") VALUES (1,$1,$2)',['Browser issue detail fixture comment','reporter']);
    }finally{await pool.end()}
  }
  repository={...repository,id:Number(repository.id)};foreignRepository={...foreignRepository,id:Number(foreignRepository.id)};
  const anonymous=await fetch(`${server.url}/issues`);
  if(anonymous.status!==403)throw new Error(`Anonymous issue read was not denied (${anonymous.status})`);

  execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',playwrightDir,'--no-save','--ignore-scripts','playwright@1.63.0'],{stdio:'inherit',shell:process.platform==='win32'});
  const playwright=await import(pathToFileURL(join(playwrightDir,'node_modules','playwright','index.js')).href);
  const {chromium}=playwright.default??playwright;
  let needsBrowser=!existsSync(chromium.executablePath());
  if(process.platform==='linux'&&!needsBrowser)try{needsBrowser=execFileSync('ldd',[chromium.executablePath()],{encoding:'utf8'}).includes('not found')}catch{needsBrowser=true}
  if(needsBrowser)execFileSync(join(playwrightDir,'node_modules','.bin',process.platform==='win32'?'playwright.cmd':'playwright'),['install',...(process.platform==='linux'?['--with-deps']:[]),'chromium'],{cwd:playwrightDir,stdio:'inherit',shell:process.platform==='win32'});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const requestStarts=new WeakMap();
  const trackTimings=target=>{target.on('request',request=>requestStarts.set(request,performance.now()));target.on('response',response=>{const started=requestStarts.get(response.request());if(started!==undefined)requestSamples.push({method:response.request().method(),path:new URL(response.url()).pathname,status:response.status(),durationMs:Number((performance.now()-started).toFixed(3))});});};
  trackTimings(page);
  const issueResponses=[],repositoryResponses=[],actionResponses=[],responseCaptureTasks=[];
  page.on('response',response=>{const capture=(async()=>{
    const pathname=new URL(response.url()).pathname;
    if(pathname.startsWith('/issues')) {
      let rows=[];try{rows=await response.json()}catch{}
      issueResponses.push({path:pathname,status:response.status(),ids:Array.isArray(rows)?rows.map(row=>row.id):[],rows:Array.isArray(rows)?rows:[]});
    }
    if(pathname.startsWith('/repositories/by-slug/')){let rows=[];try{rows=await response.json()}catch{}repositoryResponses.push({path:pathname,status:response.status(),ids:Array.isArray(rows)?rows.map(row=>row.id):[],rows:Array.isArray(rows)?rows:[]});}
    if(pathname.startsWith('/issues/')&&response.request().method()!=='GET')actionResponses.push({path:pathname,method:response.request().method(),status:response.status(),body:await response.json().catch(()=>undefined)});
  })();responseCaptureTasks.push(capture);});
  await page.goto(`${server.url}/#/signin`,{waitUntil:'domcontentloaded'});
  await page.getByLabel('User ID').fill('reporter');
  await page.getByLabel('Password').fill('reporter pass');
  const loginResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/login');
  const loginNavigation=page.waitForNavigation({waitUntil:'domcontentloaded'});
  await measureUi('reporter-sign-in',()=>Promise.all([loginResponse,loginNavigation,page.getByRole('button',{name:'Sign in'}).click()]));
  const cookies=await page.context().cookies();
  const sessionCookie=cookies.find(cookie=>cookie.name==='pipe_session');
  if(!sessionCookie||!sessionCookie.httpOnly)throw new Error(`Browser login did not establish an HttpOnly BMEC session cookie (HTTP ${ (await loginResponse).status() }, Set-Cookie: ${ (await loginResponse).headers()['set-cookie']??'missing' })`);
  await page.getByRole('link',{name:'Browse issues'}).click();
  const issueList=page.locator('[data-pipe-page="/issues"] [data-pipe-list="issues"]');
  try { await issueList.getByText('needle & build report 0',{exact:true}).waitFor({timeout:8000}); }
  catch { const state=await issueList.evaluate(node=>({hidden:node.hidden,text:node.textContent,parent:node.parentElement?.innerText}));throw new Error(`Authenticated browser list failed to render: ${JSON.stringify({state,responses:issueResponses.map(response=>({path:response.path,status:response.status,rows:response.rows.length}))})}`); }
  if(await issueList.locator('[data-pipe-component]').count()!==50)throw new Error('Authenticated issue list did not render its bounded 50-row base page');
  const detailLink=issueList.getByRole('link',{name:'View details'}).first();
  if(await detailLink.getAttribute('href')!=='#/issues/1')throw new Error(`Generated integer issue link did not encode its route safely: ${await detailLink.getAttribute('href')}`);
  const detailPage=page.locator('[data-pipe-page="/issues/:id"]');
  await measureUi('open-issue-detail',async()=>{await detailLink.click();await detailPage.getByText('needle & build report 0',{exact:true}).waitFor();await detailPage.getByText('Browser issue detail fixture comment',{exact:true}).waitFor();});
  const routeIdInputs=detailPage.locator('input[name="id"]');
  if(await routeIdInputs.count()!==2||(await routeIdInputs.nth(0).inputValue())!=='1'||(await routeIdInputs.nth(1).inputValue())!=='1')throw new Error('Dynamic issue ID did not bind to the read-only comment and status forms');
  const detailResponse=issueResponses.find(response=>response.path==='/issues/1');
  if(!detailResponse||detailResponse.status!==200||detailResponse.rows.length!==1||detailResponse.rows[0].id!==1)throw new Error('Authenticated integer-ID route did not return exactly its issue detail');
  await page.getByLabel('Comment').fill('Reporter browser comment');
  const commentResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/issues/1/comments'&&response.request().method()==='POST');
  await measureUi('post-comment',()=>Promise.all([commentResponse,page.getByRole('button',{name:'Post comment'}).click()]));
  if((await commentResponse).status()!==200)throw new Error('Authenticated reporter could not post a comment to the selected issue');
  await detailPage.getByText('Submitted.',{exact:true}).waitFor();
  await page.getByLabel('New status').selectOption('Closed');
  const reporterStatusResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/issues/1/status'&&response.request().method()==='PATCH');
  await measureUi('denied-role-change',()=>Promise.all([reporterStatusResponse,page.getByRole('button',{name:'Update status'}).click()]));
  if((await reporterStatusResponse).status()!==403)throw new Error('Reporter was not denied maintainer-only status changes');
  await page.reload({waitUntil:'domcontentloaded'});
  try { await detailPage.getByText('Reporter browser comment',{exact:true}).waitFor({timeout:8000}); }
  catch { throw new Error(`Comment list failed after reload: ${JSON.stringify({url:page.url(),list:await detailPage.locator('[data-pipe-list="comments"]').textContent(),renderedRows:await detailPage.locator('[data-pipe-list="comments"] [data-pipe-component]').count(),bindings:await detailPage.locator('[data-pipe-list="comments"] [data-pipe-bind]').allTextContents(),responses:issueResponses.filter(response=>response.path==='/issues/1/comments').map(response=>({status:response.status,rows:response.rows}))})}`); }
  await page.getByRole('link',{name:'Back to issues'}).click();
  await issueList.getByText('needle & build report 0',{exact:true}).waitFor();
  const search=page.getByRole('searchbox',{name:'Search issues by title or description'});
  await measureUi('search-issues',async()=>{await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/issues/search/needle%20%26%20build'),search.fill('needle & build')]);await issueList.getByText('Report 1',{exact:true}).waitFor();});
  const firstSearch=issueResponses.find(response=>response.path==='/issues/search/needle%20%26%20build');
  if(!firstSearch||firstSearch.status!==200||firstSearch.ids.length!==50||!firstSearch.rows.some(row=>!row.title.toLocaleLowerCase().includes('needle')&&row.description.includes('needle & build')))throw new Error('Encoded server search failed to retain a description-only match');
  const next=page.locator('[data-pipe-page="/issues"] [data-pipe-cursor-state="issues"]');
  await measureUi('issue-cursor-page-2',async()=>{await next.click();await issueList.getByText('Report 51',{exact:true}).waitFor();});
  await next.click();
  await issueList.getByText('Report 125',{exact:true}).waitFor();
  const searchResponses=issueResponses.filter(response=>response.path.startsWith('/issues/search/needle%20%26%20build'));
  const searchPages=searchResponses.map(response=>response.rows);
  const matched=searchPages.flat();
  if(searchPages.map(rows=>rows.length).join(',')!=='50,50,26'||new Set(matched.map(row=>row.id)).size!==126||matched.length!==126||matched.some(row=>!row.title.includes('needle')&&!row.description.includes('needle & build'))||searchResponses.some(response=>response.status!==200))throw new Error(`Authenticated search cursor traversal was incomplete, duplicated, or out of scope: ${JSON.stringify({pages:searchPages.map(rows=>rows.length),ids:matched.map(row=>row.id),statuses:searchResponses.map(response=>response.status),paths:searchResponses.map(response=>response.path)})}`);
  const continuation=searchResponses.slice(1);
  if(continuation.some(response=>!response.path.includes('/pages/')))throw new Error('Search continuation did not keep the term in the cursor URL');
  await next.click();
  await page.getByText('No more records.').waitFor();
  await page.route('**/issues/search/fail',route=>route.abort());
  const cursorStatus=page.locator('[data-pipe-cursor-status="issues"]');
  await search.fill('fail');
  await cursorStatus.getByText('Unable to search items. Try again.').waitFor();
  await page.unroute('**/issues/search/fail');
  await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/issues/search/absent'),search.fill('absent')]);
  await page.getByText('No matching items.').waitFor();
  await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/issues'),search.fill('')]);
  await issueList.getByText('needle & build report 0',{exact:true}).waitFor();
  if(await issueList.locator('[data-pipe-component]').count()!==50)throw new Error('Clearing search did not restore the bounded base issue page');
  for(let repeat=0;repeat<uiRepeats;repeat++){
    const query=repeat%2===0?'needle & build':'absent';
    const expected=repeat%2===0?'Report 1':'No matching items.';
    await measureUi(`repeated-search-${repeat+1}`,async()=>{await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname===`/issues/search/${encodeURIComponent(query)}`),search.fill(query)]);await issueList.getByText(expected,{exact:true}).waitFor();});
    await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/issues'),search.fill('')]);
    await issueList.getByText('needle & build report 0',{exact:true}).waitFor();
  }

  let repositoryHref,scopedPages=[],scopedRows=[],repositorySearchPages=[],repositorySearchRows=[];
  await page.getByRole('link',{name:'Browse repositories'}).click();
  const repositoryLink=page.getByRole('link',{name:'Browse repository'}).first();
  await repositoryLink.waitFor();
  repositoryHref=await repositoryLink.getAttribute('href');
  if(repositoryHref!=='#/repositories/bmec-search-fixture/issues')throw new Error(`Repository link did not preserve its typed slug route: ${repositoryHref}`);
  await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/repositories/by-slug/bmec-search-fixture/issues'),repositoryLink.click()]);
  const repositoryIssueList=page.locator('[data-pipe-page="/repositories/:slug/issues"] [data-pipe-list="issues"]');
  await repositoryIssueList.getByText('needle & build report 0',{exact:true}).waitFor();
  if(!page.url().endsWith('/#/repositories/bmec-search-fixture/issues')||await repositoryIssueList.locator('[data-pipe-component]').count()!==50)throw new Error('Slug route did not load its bounded repository issue page');
  await Promise.all(responseCaptureTasks);
  const repositoryNext=page.locator('[data-pipe-page="/repositories/:slug/issues"] [data-pipe-cursor-state="issues"]');
  const firstRepositoryPage=repositoryResponses.find(response=>response.path==='/repositories/by-slug/bmec-search-fixture/issues');
  if(!firstRepositoryPage||firstRepositoryPage.status!==200||firstRepositoryPage.rows.length!==50||firstRepositoryPage.rows.some(row=>row.repository.id!==repository.id))throw new Error(`Repository-scoped first page leaked issues or failed to load: ${JSON.stringify({repository:repository.id,response:firstRepositoryPage,seen:repositoryResponses.map(response=>({path:response.path,status:response.status,count:response.rows.length,first:response.rows[0]})),requests:requestSamples})}`);
  await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/repositories/by-slug/bmec-search-fixture/issues/pages/63'),repositoryNext.click()]);
  await repositoryIssueList.getByText('Report 50',{exact:true}).waitFor();
  const secondRepositoryPage=repositoryResponses.find(response=>response.path==='/repositories/by-slug/bmec-search-fixture/issues/pages/63');
  if(!secondRepositoryPage||secondRepositoryPage.status!==200||secondRepositoryPage.rows.length!==50||secondRepositoryPage.rows.some(row=>row.repository.id!==repository.id))throw new Error('Repository-scoped cursor did not preserve slug scope');
  await repositoryNext.click();
  await repositoryIssueList.getByText('Noise 8',{exact:true}).waitFor();
  scopedPages=repositoryResponses.filter(response=>response.path.startsWith('/repositories/by-slug/bmec-search-fixture/issues'));
  scopedRows=scopedPages.flatMap(response=>response.rows);
  if(scopedPages.map(response=>response.rows.length).join(',')!=='50,50,35'||scopedPages.some(response=>response.status!==200)||scopedRows.length!==135||new Set(scopedRows.map(row=>row.id)).size!==135||scopedRows.some(row=>row.repository.id!==repository.id))throw new Error(`Repository browser traversal was incomplete, duplicated, or leaked foreign issues: ${JSON.stringify({pages:scopedPages.map(response=>response.rows.length),statuses:scopedPages.map(response=>response.status)})}`);
  const repositorySearch=page.getByRole('searchbox',{name:'Search issues in this repository by title or description'});
  await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname===repositorySearchPath),repositorySearch.fill('needle & build')]);
  await repositoryIssueList.getByText('Report 1',{exact:true}).waitFor();
  const repositorySearchNext=page.locator('[data-pipe-page="/repositories/:slug/issues"] [data-pipe-cursor-state="issues"]');
  await repositorySearchNext.click();await repositoryIssueList.getByText('Report 50',{exact:true}).waitFor();
  await repositorySearchNext.click();await repositoryIssueList.getByText('Report 125',{exact:true}).waitFor();
  repositorySearchPages=repositoryResponses.filter(response=>response.path.startsWith('/repositories/by-slug/bmec-search-fixture/issues/search/needle%20%26%20build'));
  repositorySearchRows=repositorySearchPages.flatMap(response=>response.rows);
  if(repositorySearchPages.map(response=>response.rows.length).join(',')!=='50,50,26'||repositorySearchPages.some(response=>response.status!==200)||repositorySearchRows.length!==126||new Set(repositorySearchRows.map(row=>row.id)).size!==126||repositorySearchRows.some(row=>row.repository.id!==repository.id)||!repositorySearchRows.some(row=>!row.title.toLocaleLowerCase().includes('needle')&&row.description.includes('needle & build')))throw new Error(`Repository search cursor traversal lost scope, matches, or uniqueness: ${JSON.stringify({pages:repositorySearchPages.map(response=>response.rows.length),statuses:repositorySearchPages.map(response=>response.status)})}`);
  await repositorySearch.fill('');
  await repositoryIssueList.getByText('needle & build report 0',{exact:true}).waitFor();
  if(await repositoryIssueList.locator('[data-pipe-component]').count()!==50)throw new Error('Clearing repository search did not restore the bounded scoped page');
  await page.getByRole('link',{name:'Back to repositories'}).click();
  await page.getByRole('link',{name:'Back to issues'}).click();
  await issueList.getByText('needle & build report 0',{exact:true}).waitFor();

  const maintainerPage=await browser.newPage();trackTimings(maintainerPage);
  await maintainerPage.goto(`${server.url}/#/signin`,{waitUntil:'domcontentloaded'});
  await maintainerPage.getByLabel('User ID').fill('maintainer');
  await maintainerPage.getByLabel('Password').fill('maintainer pass');
  const maintainerLogin=maintainerPage.waitForResponse(response=>new URL(response.url()).pathname==='/auth/login');
  const maintainerNavigation=maintainerPage.waitForNavigation({waitUntil:'domcontentloaded'});
  await measureUi('maintainer-sign-in',()=>Promise.all([maintainerLogin,maintainerNavigation,maintainerPage.getByRole('button',{name:'Sign in'}).click()]));
  await maintainerPage.getByRole('link',{name:'Browse issues'}).click();
  const maintainerList=maintainerPage.locator('[data-pipe-page="/issues"] [data-pipe-list="issues"]');
  await maintainerList.getByText('needle & build report 0',{exact:true}).waitFor();
  await maintainerList.getByRole('link',{name:'View details'}).first().click();
  const maintainerDetail=maintainerPage.locator('[data-pipe-page="/issues/:id"]');
  await maintainerDetail.getByText('needle & build report 0',{exact:true}).waitFor();
  await maintainerPage.getByLabel('New status').selectOption('Closed');
  const maintainerStatusResponse=maintainerPage.waitForResponse(response=>new URL(response.url()).pathname==='/issues/1/status'&&response.request().method()==='PATCH');
  await measureUi('allowed-role-change',()=>Promise.all([maintainerStatusResponse,maintainerPage.getByRole('button',{name:'Update status'}).click()]));
  const maintainerStatusResult=await maintainerStatusResponse;
  if(maintainerStatusResult.status()!==200)throw new Error('Maintainer session could not update issue status');
  await maintainerDetail.getByText('Submitted.',{exact:true}).waitFor();

  const sessionCookieValue=(await page.context().cookies()).find(cookie=>cookie.name==='pipe_session')?.value;
  if(!sessionCookieValue)throw new Error('Could not find the reporter cookie for concurrent authenticated reads');
  for(let wave=0;wave<concurrentWaves;wave++){
    const responses=await Promise.all(Array.from({length:concurrency},async()=>{
      const started=performance.now();
      const response=await fetch(`${server.url}/issues`,{headers:{cookie:`pipe_session=${sessionCookieValue}`}});
      const rows=await response.json();
      const durationMs=elapsedMs(started);
      if(response.status!==200||rows.length!==50)throw new Error(`Concurrent authenticated issue read failed: HTTP ${response.status}, rows ${rows.length}`);
      concurrentRequestSamples.push({wave:wave+1,status:response.status,rows:rows.length,durationMs});
      return response.status;
    }));
    if(responses.some(status=>status!==200))throw new Error(`Concurrent request wave ${wave+1} had a failed response`);
  }

  const visibleIssueRows=await issueList.locator('[data-pipe-component]').count();
  const firstDetailHref=await detailLink.getAttribute('href');

  await browser.close();browser=undefined;
  await server.close();
  server=await startMeasuredRuntime('generated-after-restart');
  const restartedLogin=await fetch(`${server.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'maintainer',password:'maintainer pass'})});
  if(restartedLogin.status!==200)throw new Error(`Maintainer could not log in after SQLite restart (${restartedLogin.status})`);
  const restartedCookie=restartedLogin.headers.get('set-cookie')?.split(';',1)[0];if(!restartedCookie)throw new Error('Restarted SQLite runtime did not issue a session cookie');
  const restartedIssues=await fetch(`${server.url}/issues`,{headers:{cookie:restartedCookie}});if(restartedIssues.status!==200)throw new Error(`Issue list after restart returned ${restartedIssues.status}`);
  const restartedRows=await restartedIssues.json();if(!restartedRows.some(row=>row.id===1&&(row.state?.variant==='Closed'||row.state==='Closed')))throw new Error(`Issue status did not persist across SQLite restart: ${JSON.stringify(restartedRows[0]?.state)}`);
  const restartedComments=await fetch(`${server.url}/issues/1/comments`,{headers:{cookie:restartedCookie}});if(restartedComments.status!==200)throw new Error(`Issue comments after restart returned ${restartedComments.status}`);
  const persistedComments=await restartedComments.json();if(!persistedComments.some(comment=>comment.body==='Reporter browser comment'&&comment.createdBy==='reporter'))throw new Error('Reporter comment did not persist across SQLite restart');
  const restartPersistence={issueStatus:'Closed',reporterComment:true,authenticatedRead:true};

  const requestLatencyByMethodAndPath=Object.fromEntries([...new Set(requestSamples.map(sample=>`${sample.method} ${sample.path}`))].map(key=>[key,sampleSummary(requestSamples.filter(sample=>`${sample.method} ${sample.path}`===key).map(sample=>sample.durationMs))]));
  const evidence={schemaVersion:'bmec.evidence.community-issues-browser.v1',classification:`synthetic Community Issues authenticated ${databaseBackend} / Chromium browser and bounded app-performance run`,databaseBackend,benchmark:{coverage:'full-functional-and-performance',representativeData:{issues:135,searchMatches:126,foreignRepositoryRows:32},uiRepeats,concurrency,concurrentWaves},authentication:{anonymousIssueReadStatus:anonymous.status,sessionCookie:{name:sessionCookie.name,httpOnly:sessionCookie.httpOnly,sameSite:sessionCookie.sameSite},authenticatedIssueReadStatus:issueResponses.find(response=>response.path==='/issues'&&response.status===200)?.status},baseList:{firstPageSize:50,visibleRows:visibleIssueRows},repositoryBrowse:{verified:true,choiceListPath:'/repositories',slugRoute:'/repositories/bmec-search-fixture/issues',scopedListPath:'/repositories/by-slug/bmec-search-fixture/issues',pageSizes:scopedPages.map(response=>response.rows.length),totalIssues:scopedRows.length,noDuplicates:new Set(scopedRows.map(row=>row.id)).size===scopedRows.length,allRowsStayInSelectedRepository:scopedRows.every(row=>row.repository.id===repository.id),backToRepositoryChoice:true,returnToGlobalIssueList:true},detail:{href:firstDetailHref,path:'/issues/1',status:detailResponse.status,exactlyOneIssueReturned:detailResponse.rows.length===1,initialCommentVisible:true,reporterCommentStatus:actionResponses.find(response=>response.path==='/issues/1/comments'&&response.method==='POST')?.status,reporterStatusChangeDenied:actionResponses.find(response=>response.path==='/issues/1/status'&&response.method==='PATCH')?.status===403,maintainerStatusChangeAccepted:maintainerStatusResult.status()===200},search:{query:'needle & build',encodedPath:'/issues/search/needle%20%26%20build',pageSizes:searchPages.map(rows=>rows.length),totalMatches:matched.length,descriptionOnlyMatches:matched.filter(row=>!row.title.includes('needle')).length,noDuplicates:new Set(matched.map(row=>row.id)).size===matched.length,onlyTitleOrDescriptionMatches:matched.every(row=>row.title.includes('needle')||row.description.includes('needle & build')),emptyState:'No matching items.',endState:'No more records.',errorState:'Unable to search items. Try again.',clearRestoresBasePage:true},repositorySearch:{verified:true,query:'needle & build',encodedPath:repositorySearchPath,pageSizes:repositorySearchPages.map(response=>response.rows.length),totalMatches:repositorySearchRows.length,noDuplicates:new Set(repositorySearchRows.map(row=>row.id)).size===repositorySearchRows.length,allRowsStayInSelectedRepository:repositorySearchRows.every(row=>row.repository.id===repository.id),descriptionOnlyMatches:repositorySearchRows.filter(row=>!row.title.toLocaleLowerCase().includes('needle')).length,clearRestoresScopedPage:true},limitations:['Local database and browser run only; not a hosted or production service-level objective']};
  evidence.timings={runtimeStartupMs:sampleSummary(startupSamplesMs),uiInteractions:uiInteractionSamples,requestLatencyByMethodAndPath,rawRequestSamples:requestSamples};
  evidence.timings.concurrentAuthenticatedIssueReads={parameters:{concurrency,waves:concurrentWaves,totalRequests:concurrentRequestSamples.length},latency:sampleSummary(concurrentRequestSamples.map(sample=>sample.durationMs)),rawSamples:concurrentRequestSamples};
  evidence.restartPersistence=restartPersistence;
  const evidencePath=process.env.BMEC_COMMUNITY_ISSUES_BROWSER_EVIDENCE??join(tmpdir(),`bmec-community-issues-${databaseBackend}-measurements.json`);
  mkdirSync(dirname(evidencePath),{recursive:true});
  writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
  console.log(`COMMUNITY_ISSUES_BROWSER_SMOKE PASS — cookie login, typed slug repository browsing (50/50/35), scoped search (50/50/26), integer-ID detail/comments/status, global search (50/50/26), repeated UI actions, concurrent reads, and empty/end/error/clear states`);
} finally {
  await browser?.close();
  await server?.close();
  if(adminPool&&postgresSchema){await adminPool.query(`DROP SCHEMA IF EXISTS "${postgresSchema}" CASCADE`).catch(()=>{});await adminPool.end();}
  rmSync(root,{recursive:true,force:true});
  rmSync(playwrightDir,{recursive:true,force:true});
}
