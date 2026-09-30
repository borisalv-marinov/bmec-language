import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {parse} from '../dist/parser/parser.js';
import {toIR} from '../dist/ir/ir.js';
import {buildRelease} from '../dist/release/release.js';

const releaseDir=mkdtempSync(join(tmpdir(),'bmec-style-browser-release-'));
const playwrightDir=mkdtempSync(join(tmpdir(),'bmec-style-browser-playwright-'));
const source=`app Styled
style named Primary background is neutral
style named Primary state hovered background is blue
style named Primary focus is ringed
style named DashboardLayout layout is grid
style named DashboardColumns columns is 3
style named DashboardResponsive responsive columns is 1
style named DashboardMobile { layout is row on small screens { layout is column } }
style named Dashboard composes DashboardLayout, DashboardColumns, DashboardResponsive, DashboardMobile
component Button uses style Primary { button "Save" on Save }
component Dashboard uses style Dashboard { text "one" text "two" text "three" }
model Item { name text }
page Home { use Button use Dashboard crud Item }`;
const ir=toIR(parse(source,'style-browser.pipe'));
buildRelease(ir,releaseDir,{packageName:'style-browser',packageVersion:'0.1.0',languageVersion:'0.1-alpha'});
const html=readFileSync(join(releaseDir,'index.html'),'utf8');
if(!html.includes('[data-pipe-style="Primary"]{background:var(--bmec-color-neutral-100)}')) throw new Error('semantic style CSS was not emitted');
if(!html.includes('max-width:960px')||!html.includes('min-height:2.5rem')||!html.includes('form>div{display:grid')) throw new Error('professional default UI CSS was not emitted');

execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',playwrightDir,'--no-save','--ignore-scripts','playwright@1.63.0'],{stdio:'inherit',shell:process.platform==='win32'});
const playwright=await import(pathToFileURL(join(playwrightDir,'node_modules','playwright','index.js')).href);
const {chromium}=playwright.default??playwright;
let browserNeedsDeps=!existsSync(chromium.executablePath());
if(process.platform==='linux'&& !browserNeedsDeps) try{browserNeedsDeps=execFileSync('ldd',[chromium.executablePath()],{encoding:'utf8'}).includes('not found');}catch{browserNeedsDeps=true;}
if(browserNeedsDeps) execFileSync(join(playwrightDir,'node_modules','.bin',process.platform==='win32'?'playwright.cmd':'playwright'),['install',...(process.platform==='linux'?['--with-deps']:[]),'chromium'],{cwd:playwrightDir,stdio:'inherit',shell:process.platform==='win32'});
const browser=await chromium.launch({headless:true});
const server=createServer((request,response)=>{
  const name=request.url==='/'?'index.html':request.url?.replace(/^\//,'');
  if(name!=='index.html'&&name!=='app.js'){response.writeHead(404);response.end('not found');return;}
  try{response.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':'text/html'});response.end(readFileSync(join(releaseDir,name)));}
  catch{response.writeHead(404);response.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();
try{
  const page=await browser.newPage();
  let fail=false;
  await page.route('**/api/Item',route=>fail?route.fulfill({status:503,body:'failed'}):route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.addInitScript(() => {
    globalThis.PIPE_UI_EVENTS={Save:()=>{globalThis.__saveClicks=(globalThis.__saveClicks??0)+1}};
  });
  await page.goto(`http://127.0.0.1:${address.port}/#pipe-page--home`,{waitUntil:'networkidle'});
  if(await page.locator('[data-pipe-state="empty"]:visible').count()!==1) throw new Error('empty CRUD state was not rendered');
  const navigationLabels=await page.locator('[data-pipe-nav-item]').allTextContents();
  if(!navigationLabels.includes('Home')) throw new Error(`humanized navigation label missing: ${JSON.stringify(navigationLabels)}`);
  if(await page.locator('[data-pipe-nav-item][aria-current="page"]').count()!==1) throw new Error('active navigation item was not marked');
  const styled=page.locator('[data-pipe-style="Primary"]');
  if(await styled.count()!==1) throw new Error('named style scope was not attached exactly once');
  const background=await styled.evaluate(element=>getComputedStyle(element).backgroundColor);
  if(background!=='rgb(241, 245, 249)') throw new Error(`unexpected computed background: ${background}`);
  const dashboard=page.locator('[data-pipe-style="Dashboard"]');
  if(await dashboard.count()!==1) throw new Error('responsive dashboard scope was not attached exactly once');
  const wideColumns=await dashboard.evaluate(element=>getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length);
  if(wideColumns!==3) throw new Error(`unexpected wide column count: ${wideColumns}`);
  const wideDirection=await dashboard.evaluate(element=>getComputedStyle(element).flexDirection);
  if(wideDirection!=='row') throw new Error(`unexpected wide layout direction: ${wideDirection}`);
  await page.setViewportSize({width:500,height:800});
  const narrowLayout=await dashboard.evaluate(element=>{const style=getComputedStyle(element);return {display:style.display,direction:style.flexDirection}});
  if(narrowLayout.display!=='flex'||narrowLayout.direction!=='column') throw new Error(`unexpected narrow layout: ${JSON.stringify(narrowLayout)}`);
  const button=page.locator('button[data-pipe-event="Save"]');
  if(await button.count()!==1) throw new Error('named click button was not emitted exactly once');
  await button.hover();
  const hoveredBackground=await button.evaluate(element=>getComputedStyle(element).backgroundColor);
  if(hoveredBackground!=='rgb(37, 99, 235)') throw new Error(`unexpected hovered background: ${hoveredBackground}`);
  await button.focus();
  const focusStyle=await button.evaluate(element=>{const style=getComputedStyle(element);return {outlineColor:style.outlineColor,outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth}});
  if(focusStyle.outlineColor!=='rgb(245, 158, 11)'||focusStyle.outlineStyle!=='solid'||focusStyle.outlineWidth!=='3px') throw new Error(`unexpected focus indicator: ${JSON.stringify(focusStyle)}`);
  await button.click();
  const clicks=await page.evaluate(() => globalThis.__saveClicks??0);
  if(clicks!==1) throw new Error(`named click handler fired ${clicks} times`);
  fail=true;
  await page.reload({waitUntil:'networkidle'});
  if(await page.locator('[data-pipe-state="error"]:visible').count()!==1) throw new Error('error CRUD state was not rendered');
  console.log(`STYLE_BROWSER_E2E PASS — Chromium computed ${background}, responsive columns/layout, hover/focus styles, CRUD empty/error states, and dispatched Save click`);
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  rmSync(releaseDir,{recursive:true,force:true});
  rmSync(playwrightDir,{recursive:true,force:true});
}
