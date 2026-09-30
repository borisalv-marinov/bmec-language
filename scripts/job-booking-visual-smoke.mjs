import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const url=process.env.BMEC_URL;
if(!url)throw new Error('BMEC_URL is required, for example http://127.0.0.1:52699');
const output=process.env.BMEC_VISUAL_DIR??join(process.cwd(),'docs','evidence','job-booking');
mkdirSync(output,{recursive:true});
const playwrightDir=mkdtempSync(join(tmpdir(),'bmec-job-booking-visual-playwright-'));
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',playwrightDir,'--no-save','--ignore-scripts','playwright@1.63.0'],{stdio:'inherit',shell:process.platform==='win32'});
const playwright=await import(pathToFileURL(join(playwrightDir,'node_modules','playwright','index.js')).href);
const {chromium}=playwright.default??playwright;
const browser=await chromium.launch({headless:true});
try{
  for(const [name,width,height] of [['desktop',1440,900],['tablet',1024,768],['mobile',390,844]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    for(const [view,hash] of [['login',''],['dashboard','#pipe-page--dashboard'],['customers','#pipe-page--customers'],['jobs','#pipe-page--jobs'],['worker','#pipe-page--workerdashboard']]){
      await page.goto(`${url}${hash}`,{waitUntil:'networkidle'});
      await page.screenshot({path:join(output,`${name}-${view}.png`),fullPage:true});
      const visible=await page.locator('section[data-pipe-page]:visible').allTextContents();
      if(visible.length!==1) throw new Error(`${name}/${view}: expected one visible page, got ${visible.length}`);
    }
    console.log(`JOB_BOOKING_VISUAL PASS — ${name} ${width}x${height}; views: login,dashboard,customers,jobs,worker`);
    await page.close();
  }
}finally{await browser.close();rmSync(playwrightDir,{recursive:true,force:true})}
