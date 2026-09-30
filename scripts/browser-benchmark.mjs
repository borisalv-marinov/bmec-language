import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),dir=mkdtempSync(join(tmpdir(),'bmec-browser-benchmark-'));
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',dir,'--no-save','--ignore-scripts','playwright@1.63.0'],{stdio:'inherit',shell:process.platform==='win32'});
const playwright=await import(pathToFileURL(join(dir,'node_modules','playwright','index.js')).href);const {chromium}=playwright.default??playwright;
const server=createServer((_,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(readFileSync(join(root,'examples','pulseboard','generated','index.html')))});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address(),samples=10,values=[];
const browser=await chromium.launch({headless:true});
try{for(let i=0;i<samples;i++){const page=await browser.newPage({viewport:{width:1440,height:900}});const start=performance.now();await page.goto(`http://127.0.0.1:${address.port}/#pipe-page--dashboard`,{waitUntil:'networkidle'});await page.locator('section[data-pipe-page]:visible').waitFor();values.push(performance.now()-start);await page.close();}values.sort((a,b)=>a-b);const at=p=>values[Math.min(values.length-1,Math.floor(values.length*p))];const result={version:1,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,platform:`${process.platform} ${process.arch}`,samples,p50Ms:Number(at(.5).toFixed(3)),p95Ms:Number(at(.95).toFixed(3)),minMs:Number(values[0].toFixed(3)),maxMs:Number(at(1).toFixed(3)),pulseboardIndexHtmlBytes:readFileSync(join(root,'examples','pulseboard','generated','index.html')).byteLength};console.log(JSON.stringify(result,null,2));}finally{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true})}
