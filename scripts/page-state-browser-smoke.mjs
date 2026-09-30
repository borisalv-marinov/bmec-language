import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {compile} from '../dist/compiler.js';
import {buildRelease} from '../dist/release/release.js';
import {startNodeRelease} from '../dist/release/server.js';

const source=`app Shop
model Product { title text required price integer required quantity integer required }
component ProductRow { show product title button "Add" on add with product from product }
component CartRow { show cartItem title show cartItem quantity button "More" on more with cartItem from cartItem button "Less" on less with cartItem from cartItem button "Remove" on remove with cartItem from cartItem }
component CartSummary { text "Subtotal: " show total of cart by price times quantity }
page Store {
 event add(product Product) appends product to cart
 event more(cartItem Product) increases quantity of cartItem in cart
 event less(cartItem Product) decreases quantity of cartItem in cart
 event remove(cartItem Product) removes cartItem from cart
 state cart list<Product> = [] persisted in local storage
 state products list<Product>
 for each product in products show ProductRow
 for each cartItem in cart show CartRow empty "Your cart is empty"
 use CartSummary
}`;
const compiled=compile(source,'page-state-browser-smoke.bmec');
if(compiled.diagnostics.length||!compiled.ir)throw new Error(`Page-state fixture did not compile: ${JSON.stringify(compiled.diagnostics)}`);
const root=mkdtempSync(join(tmpdir(),'bmec-page-state-browser-'));
const releaseDir=join(root,'release'),playwrightDir=join(root,'playwright');
buildRelease(compiled.ir,releaseDir,{packageName:'shop',packageVersion:'0.1.0',languageVersion:'0.1-alpha'});
let server,browser;
try{
 execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',playwrightDir,'--no-save','--ignore-scripts','playwright@1.63.0'],{stdio:'inherit',shell:process.platform==='win32'});
 const playwright=await import(pathToFileURL(join(playwrightDir,'node_modules','playwright','index.js')).href);
 const {chromium}=playwright.default??playwright;
 let needsBrowser=!existsSync(chromium.executablePath());
 if(process.platform==='linux'&&!needsBrowser)try{needsBrowser=execFileSync('ldd',[chromium.executablePath()],{encoding:'utf8'}).includes('not found')}catch{needsBrowser=true}
 if(needsBrowser)execFileSync(join(playwrightDir,'node_modules','.bin',process.platform==='win32'?'playwright.cmd':'playwright'),['install',...(process.platform==='linux'?['--with-deps']:[]),'chromium'],{cwd:playwrightDir,stdio:'inherit',shell:process.platform==='win32'});
 server=await startNodeRelease(releaseDir);
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.addInitScript(()=>{globalThis.PIPE_UI_STATE={products:[{id:7,title:'Book',price:12,quantity:1},{id:8,title:'Tea',price:12,quantity:1}]}});
 await page.goto(`${server.url}/`,{waitUntil:'networkidle'});
 const products=page.locator('[data-pipe-list="products"]'),cart=page.locator('[data-pipe-list="cart"]');
 await products.getByRole('button',{name:'Add'}).first().click();
 if(await page.locator('[data-pipe-total]').textContent()!=='12')throw new Error('Derived cart subtotal did not update after add');
 await products.getByRole('button',{name:'Add'}).last().click();
 if(await cart.locator('[data-pipe-row]').count()!==2)throw new Error('Repeated Add clicks did not append two typed cart items');
 if(await page.locator('[data-pipe-total]').textContent()!=='24')throw new Error('Derived cart subtotal did not sum repeated items');
 await cart.getByRole('button',{name:'More'}).first().click();
 if(!(await cart.locator('[data-pipe-row]').first().innerText()).includes('2'))throw new Error('Quantity increase did not update the selected cart row');
 if(await page.locator('[data-pipe-total]').textContent()!=='36')throw new Error('Derived cart subtotal did not update after quantity increase');
 await cart.getByRole('button',{name:'Less'}).first().click();
 if(!(await cart.locator('[data-pipe-row]').first().innerText()).includes('1'))throw new Error('Quantity decrease did not update the selected cart row');
 if(await page.locator('[data-pipe-total]').textContent()!=='24')throw new Error('Derived cart subtotal did not update after quantity decrease');
 await cart.getByRole('button',{name:'More'}).first().click();
 await cart.getByRole('button',{name:'Remove'}).last().click();
 if(await cart.locator('[data-pipe-row]').count()!==1)throw new Error('Remove did not delete the matching typed cart item');
 if(await page.locator('[data-pipe-total]').textContent()!=='24')throw new Error('Derived cart subtotal did not update after remove');
 await page.reload({waitUntil:'networkidle'});
 if(await cart.locator('[data-pipe-row]').count()!==1)throw new Error('Typed cart state did not restore after reload');
 if(await page.locator('[data-pipe-total]').textContent()!=='24')throw new Error('Changed quantity did not persist through reload');
 const stored=await page.evaluate(()=>Object.entries(localStorage).find(([key])=>key.startsWith('bmec-state:Shop:'))?.[1]);
 if(!stored||JSON.parse(stored).length!==1)throw new Error('App/page/state-scoped local storage does not match the rendered cart');
 const evidence={schemaVersion:'bmec.ui-state-browser.v1',result:'PASS',recordedAt:new Date().toISOString(),platform:`${process.platform}/${process.arch}`,browser:browser.version(),sourceSha256:createHash('sha256').update(source).digest('hex'),checks:['two repeated-row add clicks remain bound across rerender','increase and decrease change only the selected row quantity','derived subtotal recalculates after add/change/remove','cart quantity and subtotal are restored after page reload','persisted value is stored under an app/page/state key']};
 writeFileSync(join(process.cwd(),'docs','evidence','bmec-0.7-ui-state-browser.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log('PAGE_STATE_BROWSER PASS — add/change/remove, derived subtotal, typed storage, and reload restore');
}finally{
 await browser?.close();
 await server?.close();
 rmSync(root,{recursive:true,force:true});
}
