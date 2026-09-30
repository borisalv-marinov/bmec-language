import {existsSync,mkdtempSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {compile} from '../dist/compiler.js';
import {startRuntime} from '../dist/runtime/server.js';

const repositoryRoot=process.cwd();
const output=resolve(process.argv[2]??'output/community-issues-showcase.png');
const tempRoot=mkdtempSync(join(tmpdir(),'bmec-community-showcase-'));
const playwrightRoot=join(tempRoot,'playwright');
const fixturePassword=randomBytes(24).toString('base64url');
let server,browser;
try{
  const source=readFileSync(join(repositoryRoot,'examples','community-issues','main.bmec'),'utf8');
  const result=compile(source,'examples/community-issues/main.bmec');
  if(result.diagnostics.length||!result.ir)throw new Error(`Community Issues compile failed: ${result.diagnostics.map(item=>item.code).join(', ')}`);
  server=await startRuntime(result.ir,join(tempRoot,'generated'),join(tempRoot,'app.sqlite'),0,{authUsers:[{id:'reporter',password:fixturePassword,role:'reporter'}],defaultPolicy:'none'});
  const repository=server.database.create('Repository',{name:'BMEC Community',slug:'bmec-community'});
  for(const [index,title] of ['Search misses a repository label','Keep issue history visible','Add a keyboard shortcut'].entries()){
    const issue=server.database.create('Issue',{repository:repository.id,title,description:'A community-submitted issue in the BMEC example tracker.',state:'Open',createdBy:'reporter',createdAt:Date.now()+index});
    server.database.create('IssueComment',{issue:issue.id,body:'This report is ready for community review.',createdBy:'reporter'});
  }
  execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',playwrightRoot,'--no-save','--ignore-scripts','playwright@1.63.0'],{stdio:'inherit',shell:process.platform==='win32'});
  const playwright=await import(pathToFileURL(join(playwrightRoot,'node_modules','playwright','index.js')).href);
  const {chromium}=playwright.default??playwright;
  const browserPath=chromium.executablePath();
  let installBrowser=!existsSync(browserPath);
  if(process.platform==='linux'&&!installBrowser)try{installBrowser=execFileSync('ldd',[browserPath],{encoding:'utf8'}).includes('not found')}catch{installBrowser=true}
  if(installBrowser)execFileSync(join(playwrightRoot,'node_modules','.bin',process.platform==='win32'?'playwright.cmd':'playwright'),['install',...(process.platform==='linux'?['--with-deps']:[]),'chromium'],{cwd:playwrightRoot,stdio:'inherit',shell:process.platform==='win32'});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  await page.goto(`${server.url}/#/signin`,{waitUntil:'domcontentloaded'});
  await page.getByLabel('User ID').fill('reporter');
  await page.getByLabel('Password').fill(fixturePassword);
  const login=page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/login');
  const navigation=page.waitForNavigation({waitUntil:'domcontentloaded'});
  await Promise.all([login,navigation,page.getByRole('button',{name:'Sign in'}).click()]);
  await page.getByRole('link',{name:'Browse issues'}).click();
  const list=page.locator('[data-pipe-page="/issues"] [data-pipe-list="issues"]');
  try{await list.getByText('Search misses a repository label',{exact:true}).waitFor({timeout:10000})}
  catch(error){console.error(JSON.stringify({url:page.url(),body:(await page.locator('body').innerText()).slice(0,2500)}));throw error}
  mkdirSync(dirname(output),{recursive:true});
  await page.screenshot({path:output,fullPage:false});
  console.log(`Captured genuine Community Issues app preview: ${output}`);
}finally{
  await browser?.close();
  await server?.close();
  rmSync(tempRoot,{recursive:true,force:true});
}
