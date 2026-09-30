import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {extname,join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),site=resolve(root,'website','dist'),evidence=resolve(process.env.BMEC_SITE_EVIDENCE_DIR??join(root,'output','website-smoke'));
if(!existsSync(join(site,'index.html')))throw new Error('Build the website before running its smoke gate');
mkdirSync(evidence,{recursive:true});
const dependencyDir=resolve(root,'.tmp','website-test-deps');
if(!existsSync(join(dependencyDir,'node_modules','playwright','package.json'))||!existsSync(join(dependencyDir,'node_modules','axe-core','axe.min.js'))){
  mkdirSync(dependencyDir,{recursive:true});
  execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',dependencyDir,'--no-save','--ignore-scripts','playwright@1.63.0','axe-core@4.10.3'],{stdio:'inherit',shell:process.platform==='win32'});
}
const playwright=await import(pathToFileURL(join(dependencyDir,'node_modules','playwright','index.js')).href);
const {chromium}=playwright.default??playwright;
const axePath=join(dependencyDir,'node_modules','axe-core','axe.min.js');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8','.bmec':'text/plain; charset=utf-8','.pipe':'text/plain; charset=utf-8','.vsix':'application/octet-stream','.tgz':'application/gzip','.png':'image/png','.svg':'image/svg+xml','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const server=createServer((request,response)=>{try{let pathname=decodeURIComponent(new URL(request.url??'/', 'http://site.local').pathname);if(pathname==='/_test/axe.min.js'){response.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});response.end(readFileSync(axePath));return;}if(pathname==='/')pathname='/index.html';if(pathname.endsWith('/'))pathname+='index.html';const target=resolve(site,`.${pathname}`);if(target!==site&&!target.startsWith(`${site}${sep}`))throw new Error('bad path');if(!existsSync(target)||!statSync(target).isFile()){response.writeHead(404,{'content-type':'text/html; charset=utf-8'});response.end(readFileSync(join(site,'404.html')));return;}response.writeHead(200,{'content-type':types[extname(target)]??'application/octet-stream'});response.end(readFileSync(target));}catch{response.writeHead(400);response.end('Bad request');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address(),url=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({headless:true});
try{
  for(const [name,width,height] of [['mobile',360,800],['tablet',768,900],['compact',850,900],['desktop',1440,1000]]){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
    const browserErrors=[];
    page.on('pageerror',error=>browserErrors.push(`page: ${error.message}`));
    page.on('console',message=>{if(message.type()==='error'&&!message.location().url.endsWith('/definitely-not-a-bmec-page'))browserErrors.push(`console at ${message.location().url}: ${message.text()}`);});
    page.on('response',response=>{if(response.status()>=400&&response.url()!==`${url}/definitely-not-a-bmec-page`)browserErrors.push(`http ${response.status()}: ${response.url()}`);});
    await page.goto(url,{waitUntil:'networkidle'});
    const siteChecks=await page.evaluate(async allowIndexing=>{const failures=[];for(const [selector,label] of [['link[rel="canonical"]','canonical'],['meta[property="og:title"]','OpenGraph title'],['meta[property="og:description"]','OpenGraph description'],['meta[property="og:image"]','OpenGraph image'],['meta[name="twitter:card"]','Twitter card'],['link[rel="icon"]','favicon']])if(!document.querySelector(selector)?.getAttribute('content')&&!document.querySelector(selector)?.getAttribute('href'))failures.push(`${label} metadata missing`);const canonical=document.querySelector('link[rel="canonical"]')?.href;if(!canonical?.startsWith('https://'))failures.push('canonical URL must be absolute HTTPS');const robots=await fetch('/robots.txt'),robotsText=await robots.text(),sitemap=await fetch('/sitemap.xml'),sitemapText=await sitemap.text(),icon=await fetch('/assets/bmec-mark.png');if(!robots.ok||(allowIndexing?(!robotsText.includes('Allow: /')||robotsText.includes('Disallow: /')):!robotsText.includes('Disallow: /')))failures.push('robots.txt does not match the selected indexing policy');if(!sitemap.ok||!sitemapText.includes('<urlset')||!sitemapText.includes('https://'))failures.push('sitemap.xml missing or invalid');if(!icon.ok||!icon.headers.get('content-type')?.includes('image/png'))failures.push('transparent brand mark missing or wrong content type');const missing=await fetch('/definitely-not-a-bmec-page');if(missing.status!==404||!(await missing.text()).includes('Page not found'))failures.push('404 route is missing or has the wrong status');return failures;},process.env.BMEC_ALLOW_INDEXING==='1');
    if(siteChecks.length)throw new Error(`${name}: site metadata and discovery checks failed: ${siteChecks.join(', ')}`);
    const sharingImage=await page.locator('meta[property="og:image"]').getAttribute('content');
    if(!sharingImage?.endsWith('/assets/bmec-social.png'))throw new Error(`${name}: sharing image must use BMEC branding`);
    await page.getByRole('heading',{name:'One language. Real applications.'}).waitFor();
    for(const section of ['Your data, server, database, and interface share one contract.','Start small. Connect the pieces when you’re ready.','The compiler connects your application layers.','Ask for language facts that fit the task.','Start with the CLI. Keep the compiler close.','Write, check, and run a function.','Follow a clear path into the language.','Readable source. Checked behavior.','Know what BMEC checks—and what your host owns.','Read the source and its contracts.'])await page.getByRole('heading',{name:section}).waitFor();
    if(await page.locator('#showcase, .showcase-card').count())throw new Error(`${name}: removed example showcase is still visible on the homepage`);
    const initialOverflow=await page.evaluate(()=>{const nodes=[...document.body.querySelectorAll('*')].map(el=>({el,rect:el.getBoundingClientRect(),text:(el.textContent??'').trim().replace(/\s+/g,' ').slice(0,70)})).filter(item=>item.rect.right>innerWidth+1||item.rect.left< -1).sort((a,b)=>Math.max(b.rect.right-innerWidth,-b.rect.left)-Math.max(a.rect.right-innerWidth,-a.rect.left)).slice(0,8);return `document=${document.documentElement.scrollWidth} body=${document.body.scrollWidth} client=${innerWidth}; ${nodes.map(item=>`${item.el.tagName.toLowerCase()}${item.el.className&&typeof item.el.className==='string'?'.'+item.el.className.split(' ').filter(Boolean).join('.'):''} left=${Math.round(item.rect.left)} right=${Math.round(item.rect.right)} text="${item.text}"`).join(' | ')}`;});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error(`${name}: horizontal overflow (${initialOverflow})`);
    const compactThemeMenu=name==='desktop'?undefined:page.getByRole('button',{name:'Toggle navigation'});
    if(compactThemeMenu)await compactThemeMenu.click();
    await page.getByRole('button',{name:'Switch to light theme'}).click();
    const lightContrast=await page.evaluate(()=>{const parse=value=>{const m=value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);return m?[+m[1],+m[2],+m[3]]:null;},luminance=rgb=>{const c=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];},failures=[];for(const selector of ['.hero h1','.hero-lede','.download-section h2','.download-grid>div>p','.source-section h2','.source-section>div>div>p','.site-footer p','.site-header nav .nav-download','.learn-code pre','.route-terminal']){const el=document.querySelector(selector);if(!el)continue;let node=el,bg;while(node&&!bg){const color=getComputedStyle(node).backgroundColor,rgba=color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);if(color!=='transparent'&&(!rgba||Number(rgba[1])>=.98))bg=parse(color);node=node.parentElement;}const fg=parse(getComputedStyle(el).color);if(!fg||!bg)continue;const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);if(ratio<4.5)failures.push(`${selector}: ${ratio.toFixed(2)}:1`);}return failures;},process.env.BMEC_ALLOW_INDEXING==='1');
    if(lightContrast.length)throw new Error(`${name}: light theme text contrast below 4.5:1: ${lightContrast.join(', ')}`);
    await page.getByRole('button',{name:'Switch to dark theme'}).click();
    if(compactThemeMenu)await compactThemeMenu.click();
    const broken=await page.locator('a[href^="/"]').evaluateAll(async links=>{const failures=[];for(const link of links){const href=link.getAttribute('href');if(!href||href.startsWith('#'))continue;const path=href.split('#',1)[0];if(!path)continue;try{const response=await fetch(path,{method:'HEAD'});if(!response.ok)failures.push(`${href} (${response.status})`);}catch{failures.push(`${href} (network)`);}}return failures;},process.env.BMEC_ALLOW_INDEXING==='1');
    if(broken.length)throw new Error(`${name}: broken internal links: ${broken.join(', ')}`);
    const contract=await page.evaluate(async()=>{const index=await(await fetch('/ai/index.json')).json(),schema=await(await fetch('/ai/index.schema.json')).json(),version=await(await fetch('/version.json')).json(),data=await(await fetch('/site-data.json')).json(),aiPage=await fetch('/ai/'),llmsResponse=await fetch('/llms.txt'),failures=[];if(index.schemaVersion!=='bmec.website-index.v1'||schema.properties.schemaVersion.const!==index.schemaVersion||index.version!==version.packageVersion||index.version!==data.version||index.languageVersion!==version.languageVersion)failures.push('index/version metadata mismatch');if(!aiPage.ok||(await aiPage.text()).indexOf('/ai/knowledge-index.json')<0)failures.push('/ai knowledge entry unavailable');if(!llmsResponse.ok||(await llmsResponse.text()).indexOf('bmec knowledge')<0)failures.push('/llms.txt is missing AI command guidance');for(const item of index.catalogs){const response=await fetch(item.href);if(!response.ok){failures.push(`${item.id} unavailable`);continue;}const catalog=await response.json();if(catalog.schemaVersion!==item.schemaVersion)failures.push(`${item.id} schema mismatch`);for(const pointer of item.jsonPointers??[]){const value=pointer.slice(1).split('/').map(part=>part.replaceAll('~1','/').replaceAll('~0','~')).reduce((parent,key)=>parent?.[key],catalog);if(value===undefined)failures.push(`${item.id} pointer ${pointer} unavailable`);}}return failures;},process.env.BMEC_ALLOW_INDEXING==='1');
    if(contract.length)throw new Error(`${name}: AI discovery index invalid: ${contract.join(', ')}`);
    await page.addScriptTag({url:`${url}/_test/axe.min.js`});
    const axe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));
    if(axe.violations.length)throw new Error(`${name}: accessibility violations: ${axe.violations.map(item=>`${item.id} (${item.impact}) ${item.nodes.map(node=>`${node.target.join(', ')}: ${node.failureSummary}`).join('; ')}`).join(' | ')}`);
    await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
    await page.screenshot({path:join(evidence,`${name}.png`),fullPage:true});
    if(name==='mobile'){
      const toggle=page.getByRole('button',{name:'Toggle navigation'});await toggle.click();
      if(await toggle.getAttribute('aria-expanded')!=='true')throw new Error('Mobile navigation did not open');
      await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Docs'}).click();
      if(!page.url().endsWith('/docs/'))throw new Error('Mobile navigation did not open the selected route');
    }
    if(name==='desktop'){
        const routes=[['/docs/','Guides for building with BMEC'],['/docs/how-bmec-works/','How BMEC works'],['/learn/','Learn BMEC'],['/library/','BMEC code library'],['/playground/','BMEC playground'],['/ai/','Build with BMEC and coding tools'],['/benchmarks/','Benchmarking BMEC'],['/architecture/','How BMEC works'],['/security/','Security and trust boundaries'],['/deploy/','Deployment and operations'],['/roadmap/','Project status'],['/support/','Support BMEC'],['/contact/','Contact'],['/showcase/','Built with BMEC']];
      for(const [path,title] of routes){
        const response=await page.goto(`${url}${path}`,{waitUntil:'networkidle'});
        if(!response?.ok())throw new Error(`Required website route ${path} returned ${response?.status()}`);
        const metadata=await page.evaluate(()=>({canonical:document.querySelector('link[rel="canonical"]')?.href,ogTitle:document.querySelector('meta[property="og:title"]')?.content,ogUrl:document.querySelector('meta[property="og:url"]')?.content,description:document.querySelector('meta[name="description"]')?.content}));
        if(!metadata.canonical?.endsWith(path)||metadata.ogUrl!==metadata.canonical||!metadata.ogTitle||!metadata.description)throw new Error(`Route ${path} has incomplete or inconsistent metadata`);
        await page.getByRole('heading',{level:1,name:title}).waitFor();
        if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error(`Route ${path} has horizontal overflow`);
        const routeLinks=await page.locator('a[href^="/"]').evaluateAll(async links=>{const failures=[];for(const link of links){const href=link.getAttribute('href');if(!href||href.startsWith('#'))continue;const target=href.split('#',1)[0];try{const result=await fetch(target,{method:'HEAD'});if(!result.ok)failures.push(`${href} (${result.status})`);}catch{failures.push(`${href} (network)`);}}return failures;},process.env.BMEC_ALLOW_INDEXING==='1');
        if(routeLinks.length)throw new Error(`Route ${path} has broken links: ${routeLinks.join(', ')}`);
        await page.addScriptTag({url:`${url}/_test/axe.min.js`});
        const routeAxe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));
        if(routeAxe.violations.length)throw new Error(`Route ${path} has accessibility violations: ${routeAxe.violations.map(item=>item.id).join(', ')}`);
      }
      const guide=await page.goto(`${url}/docs/how-bmec-works/`,{waitUntil:'networkidle'});
      if(!guide?.ok())throw new Error('Rendered How BMEC works guide did not load');
      const markdownPath=await page.getByRole('link',{name:'Download Markdown'}).getAttribute('href');
      if(markdownPath!=='/docs/HOW_BMEC_WORKS.md')throw new Error(`Markdown download points to ${markdownPath}`);
      const markdown=await page.evaluate(async path=>{const response=await fetch(path);return {ok:response.ok,type:response.headers.get('content-type'),body:await response.text()};},markdownPath);
      if(!markdown.ok||!markdown.type?.includes('text/markdown')||markdown.body!==readFileSync(join(root,'docs','HOW_BMEC_WORKS.md'),'utf8'))throw new Error('Download Markdown does not match the maintained guide source');
      const raw=await page.goto(`${url}${markdownPath}`,{waitUntil:'networkidle'});
      if(!raw?.ok()||!await page.locator('body').innerText().then(text=>text.startsWith('# How BMEC works')))throw new Error('View raw Markdown is not readable source text');
    }
    const playgroundRequests=[];
    page.on('request',request=>playgroundRequests.push({url:request.url(),method:request.method(),postData:request.postData()}));
    const playgroundResponse=await page.goto(`${url}/playground/`,{waitUntil:'networkidle'});
    if(!playgroundResponse?.ok())throw new Error(`${name}: playground route returned ${playgroundResponse?.status()}`);
    await page.getByRole('heading',{name:'A real BMEC check. A local place to run a function.'}).waitFor();
    const policy=await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    if(!policy?.includes("default-src 'self'")||!policy.includes("connect-src 'self'")||!policy.includes("worker-src 'self'")||!policy.includes("script-src 'self'"))throw new Error(`${name}: playground content security policy is missing required local-only directives`);
    await page.getByRole('button',{name:'Check code'}).waitFor();
    const exampleIds=await page.locator('#playground-example option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));
    if(exampleIds.length!==6)throw new Error(`${name}: expected six checked playground examples, received ${exampleIds.length}`);
    for(const id of exampleIds){
      await page.locator('#playground-example').selectOption(id);
      await page.getByRole('button',{name:'Check code'}).click();
      await page.waitForFunction(()=>document.querySelector('#playground-status')?.textContent?.startsWith('Check complete'));
      if(!await page.locator('#playground-summary').innerText().then(text=>text.includes('Source checks successfully')))throw new Error(`${name}: playground example ${id} did not compile successfully`);
      if(id==='EXAMPLE-HELLO-001'){
        await page.getByRole('button',{name:'Run function'}).click();
        await page.waitForFunction(()=>document.querySelector('#playground-status')?.textContent?.startsWith('Run complete'));
        if(await page.locator('#playground-run-output').innerText()==='No result yet')throw new Error(`${name}: playground did not execute the checked pure function`);
        await page.getByRole('button',{name:'Typed IR'}).click();
        const typedIr=await page.locator('#playground-ir').textContent();
        if(!typedIr||!typedIr.includes('"app"')&&!typedIr.includes('"name"'))throw new Error(`${name}: playground did not return typed IR`);
      }
      if(id==='EXAMPLE-RECORD-001'){
        await page.getByRole('button',{name:'Typed IR'}).click();
        const recordIr=await page.locator('#playground-ir').textContent();
        if(!recordIr?.includes('Preferences'))throw new Error(`${name}: typed-record example did not produce the record IR`);
      }
    }
    await page.getByRole('button',{name:'AI context'}).click();
    const context=await page.locator('#playground-context').textContent();
    if(!context?.includes('bmec.knowledge-context.v1'))throw new Error(`${name}: playground did not return the BMEC AI context format`);
    await page.locator('#playground-source').fill('app PrivatePlaygroundMarker\nfunction greeting() -> text { return 42 }');
    await page.getByRole('button',{name:'Check code'}).click();
    await page.getByRole('button',{name:'Errors and hints'}).click();
    await page.locator('#playground-diagnostics strong').first().waitFor();
    if(!await page.locator('#playground-diagnostics').innerText())throw new Error(`${name}: compiler diagnostics were empty`);
    await page.locator('#playground-source').fill('app RunnerBoundary\nfunction overflow() -> integer { return 9223372036854775807 + 1 }');
    await page.getByRole('button',{name:'Check code'}).click();
    await page.waitForFunction(()=>document.querySelector('#playground-status')?.textContent?.startsWith('Check complete'));
    await page.locator('#playground-function').selectOption({label:'overflow()'});
    await page.getByRole('button',{name:'Run function'}).click();
    await page.waitForFunction(()=>document.querySelector('#playground-status')?.textContent?.startsWith('Run stopped'));
    if(!await page.locator('#playground-run-output').innerText().then(text=>text.includes('Integer overflow')))throw new Error(`${name}: runner did not report signed 64-bit overflow`);
    if(name==='desktop'){
      await page.evaluate(()=>{
        const original=window.Worker;
        class HungWorker extends EventTarget{
          postMessage(message){if(message.type==='init')queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{type:'ready'}})));}
          terminate(){window.__bmecTimeoutWorkerTerminated=true;}
        }
        window.__bmecOriginalWorker=original;
        window.__bmecTimeoutWorkerTerminated=false;
        Object.defineProperty(window,'Worker',{value:HungWorker,configurable:true});
      });
      await page.getByRole('button',{name:'Run function'}).click();
      await page.waitForFunction(()=>document.querySelector('#playground-status')?.textContent?.includes('reached its 2-second limit'));
      if(!await page.evaluate(()=>window.__bmecTimeoutWorkerTerminated))throw new Error(`${name}: playground did not terminate a timed-out Worker`);
      await page.evaluate(()=>Object.defineProperty(window,'Worker',{value:window.__bmecOriginalWorker,configurable:true}));
    }
    await page.locator('#playground-source').fill('app RunnerRecovery\nfunction answer() -> integer { return 42 }');
    await page.getByRole('button',{name:'Check code'}).click();
    await page.waitForFunction(()=>document.querySelector('#playground-status')?.textContent?.startsWith('Check complete'));
    await page.locator('#playground-function').selectOption({label:'answer()'});
    await page.getByRole('button',{name:'Run function'}).click();
    await page.waitForFunction(()=>document.querySelector('#playground-status')?.textContent?.startsWith('Run complete'));
    const recoveredOutput=(await page.locator('#playground-run-output').innerText()).trim();
    if(recoveredOutput!=='"42"')throw new Error(`${name}: playground did not recover after a bounded runner failure (received ${JSON.stringify(recoveredOutput)})`);
    const origin=new URL(url).origin;
    if(playgroundRequests.some(request=>new URL(request.url).origin!==origin||request.method!=='GET'&&request.method!=='HEAD'||request.postData||request.url.includes('PrivatePlaygroundMarker')||request.url.includes('greeting')))throw new Error(`${name}: playground made a write, cross-origin, or source-bearing request`);
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error(`${name}: playground has horizontal overflow`);
    await page.addScriptTag({url:`${url}/_test/axe.min.js`});
    const playgroundAxe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));
    if(playgroundAxe.violations.length)throw new Error(`${name}: playground accessibility violations: ${playgroundAxe.violations.map(item=>`${item.id} (${item.impact}) ${item.nodes.map(node=>`${node.target.join(', ')}: ${node.failureSummary}`).join('; ')}`).join(' | ')}`);
    await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
    await page.screenshot({path:join(evidence,`${name}-playground.png`),fullPage:true});
    if(browserErrors.length)throw new Error(`${name}: browser errors: ${browserErrors.join(' | ')}`);
    console.log(`BMEC_PLAYGROUND PASS — ${name} ${width}x${height}; real compiler/IR/AI context; syntax diagnostics; local-only requests; axe 0 violations`);
    console.log(`BMEC_SITE PASS — ${name} ${width}x${height}; no overflow; links resolve; axe 0 violations`);
    await page.close();
  }
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
