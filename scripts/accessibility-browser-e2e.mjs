import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const root=process.cwd();
const cli=join(root,'dist','cli','index.js');
const dashboardSource=join(root,'examples','pulseboard','main.bmec');
const dashboardHtml=join(root,'examples','pulseboard','generated','index.html');
const fieldGuideSource=join(root,'examples','field-guide','main.bmec');
const output=process.env.BMEC_VISUAL_DIR??join(root,'docs','evidence','pulseboard');
const fixtures=mkdtempSync(join(tmpdir(),'bmec-a11y-fixtures-'));
const dependencies=mkdtempSync(join(tmpdir(),'bmec-a11y-'));
mkdirSync(output,{recursive:true});
execFileSync(process.execPath,[cli,'build',dashboardSource],{stdio:'inherit'});
const {compileProject}=await import(pathToFileURL(join(root,'dist','compiler.js')).href);
const {buildRelease}=await import(pathToFileURL(join(root,'dist','release','release.js')).href);
const guide=compileProject(fieldGuideSource);
if(guide.diagnostics.length)throw new Error(`Field Guide failed compilation: ${JSON.stringify(guide.diagnostics)}`);
const guideDirectory=join(fixtures,'field-guide');
buildRelease(guide.ir,guideDirectory,{packageName:'field-guide',packageVersion:'0.7.0',languageVersion:'0.1'});
const guideHtml=join(guideDirectory,'index.html');
const listSource=join(fixtures,'main.bmec');
writeFileSync(listSource,'app ResponsiveLists\nmodel Task { title text }\ncomponent TaskRow { show task title }\npage Home { state loading boolean state error boolean state tasks list<Task> loading "Loading tasks" error "Unable to load tasks" for each task in tasks show TaskRow filter by title paginate 2 empty "No tasks yet" }\n');
execFileSync(process.execPath,[cli,'build',listSource],{stdio:'inherit'});
const listHtml=join(fixtures,'generated','index.html');

execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',dependencies,'--no-save','--ignore-scripts','playwright@1.63.0','@axe-core/playwright@4.10.2'],{stdio:'inherit',shell:process.platform==='win32'});
const playwright=await import(pathToFileURL(join(dependencies,'node_modules','playwright','index.js')).href);
const axe=await import(pathToFileURL(join(dependencies,'node_modules','@axe-core','playwright','dist','index.mjs')).href);
const {chromium}=playwright.default??playwright;
const {AxeBuilder}=axe;
let needsBrowser=!existsSync(chromium.executablePath());
if(process.platform==='linux'&&!needsBrowser)try{needsBrowser=execFileSync('ldd',[chromium.executablePath()],{encoding:'utf8'}).includes('not found')}catch{needsBrowser=true}
if(needsBrowser)execFileSync(join(dependencies,'node_modules','.bin',process.platform==='win32'?'playwright.cmd':'playwright'),['install',...(process.platform==='linux'?['--with-deps']:[]),'chromium'],{cwd:dependencies,stdio:'inherit',shell:process.platform==='win32'});

const server=createServer((request,response)=>{const path=request.url??'/';const file=path.startsWith('/lists')?listHtml:path.startsWith('/guide')?guideHtml:dashboardHtml;response.writeHead(200,{'content-type':'text/html'});response.end(readFileSync(file))});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
try{
 for(const [name,width,height] of [['mobile',360,800],['tablet',768,900],['desktop',1440,900]]){
  const dashboard=await context.newPage({viewport:{width,height},deviceScaleFactor:1});
  await dashboard.goto(`http://127.0.0.1:${address.port}/`,{waitUntil:'networkidle'});
  const layout=await dashboard.evaluate(()=>({viewport:window.innerWidth,document:document.documentElement.scrollWidth,table:!!document.querySelector('[data-model="Task"] .pipe-table-wrap'),tableOverflow:getComputedStyle(document.querySelector('[data-model="Task"] .pipe-table-wrap')).overflowX,form:!!document.querySelector('[data-model="Task"] form'),navLinks:document.querySelectorAll('nav[data-pipe-nav] a').length,bodyFont:parseFloat(getComputedStyle(document.body).fontSize),lineHeight:parseFloat(getComputedStyle(document.body).lineHeight)}));
  if(layout.document>layout.viewport+1)throw new Error(`${name}: dashboard horizontal page overflow ${layout.document}px > ${layout.viewport}px`);
  if(!layout.table||!layout.form||layout.tableOverflow!=='auto')throw new Error(`${name}: PulseBoard form/table fixture is incomplete or not scroll wrapped`);
  if(layout.bodyFont<16||layout.lineHeight/layout.bodyFont<1.4)throw new Error(`${name}: body typography is below the documented readable baseline`);
  const required=await dashboard.locator('[data-model="Task"] input[name="title"]').evaluate(input=>({required:input.required,valid:input.checkValidity()}));
  if(!required.required||required.valid)throw new Error(`${name}: required Task title does not expose native required validation`);
  await dashboard.keyboard.press('Tab');
  const firstFocus=await dashboard.evaluate(()=>({visible:document.activeElement instanceof HTMLElement&&document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineStyle,insideNavigation:!!document.activeElement.closest('nav[data-pipe-nav]')}));
  if(!firstFocus.visible||firstFocus.outline==='none'||!firstFocus.insideNavigation)throw new Error(`${name}: route navigation is not first in keyboard order with visible focus`);
  let taskFieldFocused=false;
  for(let index=0;index<layout.navLinks+10;index++){
   await dashboard.keyboard.press('Tab');
   if(await dashboard.evaluate(()=>document.activeElement instanceof HTMLInputElement&&!!document.activeElement.closest('[data-model="Task"] form'))){taskFieldFocused=true;break;}
  }
  if(!taskFieldFocused)throw new Error(`${name}: keyboard order does not reach the first Task form field after navigation and in-page links`);
  const tableRegion=dashboard.locator('[data-model="Task"] .pipe-table-wrap');
  const tableMetrics=await tableRegion.evaluate(element=>({scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}));
  let tableRegionFocused=false;
  for(let index=0;index<80;index++){
   if(await tableRegion.evaluate(element=>document.activeElement===element)){tableRegionFocused=true;break}
   await dashboard.keyboard.press('Tab');
  }
  if(!tableRegionFocused)throw new Error(`${name}: horizontally scrollable table region is missing from keyboard order`);
  const tableFocus=await tableRegion.evaluate(element=>({visible:element.matches(':focus-visible'),outline:getComputedStyle(element).outlineStyle}));
  if(!tableFocus.visible||tableFocus.outline==='none')throw new Error(`${name}: table region has no visible keyboard focus`);
  if(name==='mobile'){
   if(tableMetrics.scrollWidth>tableMetrics.clientWidth){
    const before=await tableRegion.evaluate(element=>element.scrollLeft);
    await dashboard.keyboard.press('ArrowRight');
    const after=await tableRegion.evaluate(element=>element.scrollLeft);
    if(after<=before)throw new Error('mobile: keyboard could not scroll the overflowing table region horizontally');
   }
  }
  const targets=await dashboard.locator('nav[data-pipe-nav] a, input, select, button').evaluateAll(elements=>elements.filter(element=>element.getClientRects().length>0).map(element=>Math.round(element.getBoundingClientRect().height)));
  if(targets.some(height=>height<40))throw new Error(`${name}: an interactive target is below 40px: ${JSON.stringify(targets)}`);
  await dashboard.emulateMedia({reducedMotion:'reduce'});
  const transitions=await dashboard.locator('[data-pipe-style]').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).transitionDuration));
  if(transitions.some(value=>value.split(',').some(duration=>parseFloat(duration)>0)))throw new Error(`${name}: style transitions remain active under reduced-motion preference`);
  const dashboardAxe=await new AxeBuilder({page:dashboard}).analyze();
  if(dashboardAxe.violations.length)throw new Error(`${name}: PulseBoard axe violations ${JSON.stringify(dashboardAxe.violations)}`);
  await dashboard.close();

  const guidePage=await context.newPage({viewport:{width,height},deviceScaleFactor:1});
  await guidePage.goto(`http://127.0.0.1:${address.port}/guide`,{waitUntil:'networkidle'});
  const guideLayout=await guidePage.evaluate(()=>({viewport:window.innerWidth,document:document.documentElement.scrollWidth,title:document.title,links:[...document.querySelectorAll('nav[data-pipe-nav] a')].map(link=>({label:link.textContent.trim(),href:link.getAttribute('href')})),pages:[...document.querySelectorAll('section[data-pipe-page]')].map(page=>page.dataset.pipePage)}));
  if(guideLayout.document>guideLayout.viewport+1)throw new Error(`${name}: Field Guide horizontal overflow ${guideLayout.document}px > ${guideLayout.viewport}px`);
  if(guideLayout.title!=='Field Guide'||guideLayout.links.length!==3||guideLayout.pages.length!==3)throw new Error(`${name}: Field Guide static release metadata, navigation, or pages are incomplete`);
  await guidePage.keyboard.press('Tab');
  const guideFocus=await guidePage.evaluate(()=>({visible:document.activeElement instanceof HTMLElement&&document.activeElement.matches(':focus-visible'),inNavigation:!!document.activeElement.closest('nav[data-pipe-nav]')}));
  if(!guideFocus.visible||!guideFocus.inNavigation)throw new Error(`${name}: Field Guide navigation does not start with visible keyboard focus`);
  await guidePage.keyboard.press('Tab');
  await guidePage.keyboard.press('Enter');
  const guideDestination=await guidePage.evaluate(()=>({hash:location.hash,page:[...document.querySelectorAll('section[data-pipe-page]')].find(section=>getComputedStyle(section).display!=='none')?.dataset.pipePage}));
  if(guideDestination.hash!==guideLayout.links[1].href||guideDestination.page!=='/language')throw new Error(`${name}: Field Guide keyboard navigation did not open its linked page (${JSON.stringify(guideDestination)})`);
  const guideAxe=await new AxeBuilder({page:guidePage}).analyze();
  if(guideAxe.violations.length)throw new Error(`${name}: Field Guide axe violations ${JSON.stringify(guideAxe.violations)}`);
  console.log(`FIELD_GUIDE_ACCESSIBILITY PASS — ${name} ${width}x${height}; static release, responsive page, keyboard navigation, axe`);
  await guidePage.close();

  const listPage=await context.newPage({viewport:{width,height},deviceScaleFactor:1});
  await listPage.addInitScript(()=>{globalThis.PIPE_UI_STATE={tasks:Array.from({length:5},(_,index)=>({title:`Task ${index+1}`})),loading:false,error:false}});
  await listPage.goto(`http://127.0.0.1:${address.port}/lists`,{waitUntil:'networkidle'});
  const listLayout=await listPage.evaluate(()=>({viewport:window.innerWidth,document:document.documentElement.scrollWidth}));
  if(listLayout.document>listLayout.viewport+1)throw new Error(`${name}: list page horizontal overflow ${listLayout.document}px > ${listLayout.viewport}px`);
  const list=listPage.locator('[data-pipe-list]'),range=listPage.locator('[data-pipe-list-range]'),previous=listPage.locator('[data-pipe-list-prev]'),next=listPage.locator('[data-pipe-list-next]'),filter=listPage.locator('[data-pipe-list-filter]');
  if(await list.locator('[data-pipe-component]').count()!==2||await range.textContent()!=='Showing 1-2 of 5')throw new Error(`${name}: initial list page or range is incorrect`);
  await next.click();
  if(await range.textContent()!=='Showing 3-4 of 5'||await previous.isDisabled())throw new Error(`${name}: next-page control did not advance the list`);
  await filter.fill('Task 4');
  if(await range.textContent()!=='Showing 1-1 of 1'||await list.locator('[data-pipe-component]').allTextContents().then(values=>values.join(' ').trim())!=='Task 4')throw new Error(`${name}: text filter did not reset pagination and retain its matching row`);
  await filter.fill('missing');
  if(await list.getByRole('status').textContent()!=='No matching items.')throw new Error(`${name}: filtered no-match status is missing or inaccessible`);
  await listPage.emulateMedia({reducedMotion:'reduce'});
  const listAxe=await new AxeBuilder({page:listPage}).analyze();
  if(listAxe.violations.length)throw new Error(`${name}: typed-list axe violations ${JSON.stringify(listAxe.violations)}`);
  await listPage.close();

  const emptyPage=await context.newPage({viewport:{width,height},deviceScaleFactor:1});
  await emptyPage.addInitScript(()=>{globalThis.PIPE_UI_STATE={tasks:[],loading:false,error:false}});
  await emptyPage.goto(`http://127.0.0.1:${address.port}/lists`,{waitUntil:'networkidle'});
  if(await emptyPage.getByRole('status').textContent()!=='No tasks yet')throw new Error(`${name}: settled empty list status is missing`);
  await emptyPage.close();
  const loadingPage=await context.newPage({viewport:{width,height},deviceScaleFactor:1});
  await loadingPage.addInitScript(()=>{globalThis.PIPE_UI_STATE={tasks:[],loading:true,error:false}});
  await loadingPage.goto(`http://127.0.0.1:${address.port}/lists`,{waitUntil:'networkidle'});
  if(await loadingPage.getByText('No tasks yet').count()!==0||await loadingPage.getByRole('status').textContent()!=='Loading tasks')throw new Error(`${name}: loading state did not take precedence over list empty feedback`);
  await loadingPage.close();
  console.log(`ACCESSIBILITY_BROWSER PASS — ${name} ${width}x${height}; dashboard, typed list filter/pagination/empty/loading, keyboard, table, touch, reduced motion, axe`);
 }
}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(dependencies,{recursive:true,force:true});rmSync(fixtures,{recursive:true,force:true})}
