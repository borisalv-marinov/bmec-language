import {describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {compileProject} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

describe('Northline pending order boundary',()=>{
 it('validates every cart line before persisting a multi-item pending order and retains it after restart',async()=>{
  const compiled=compileProject(join(process.cwd(),'examples','northline','main.bmec'));expect(compiled.diagnostics).toEqual([]);
  const directory=mkdtempSync(join(tmpdir(),'bmec-northline-order-')),out=join(directory,'generated'),db=join(directory,'northline.db');
  let runtime:RuntimeHandle|undefined;
  try{
   runtime=await startRuntime(compiled.ir!,out,db,0);
   runtime.database.create('Product',{sku:'cup-01',name:'Morning ceramic cup',category:'table',price:'28.00',stock:2});
   runtime.database.create('Product',{sku:'pour-over-01',name:'Northline pour-over set',category:'coffee',price:'64.00',stock:4});
   runtime.database.create('Product',{sku:'linen-01',name:'Everyday linen towel',category:'home',price:'32.00',stock:20});
   const request=async(cupQuantity:number,pourOverQuantity:number,linenQuantity:number,idempotencyKey='checkout-default')=>{const response=await fetch(`${runtime!.url}/orders`,{method:'POST',headers:{'content-type':'application/json',idempotencyKey},body:JSON.stringify({cupQuantity,pourOverQuantity,linenQuantity,buyerNote:''})});return {status:response.status,body:await response.json() as any}};
   const triggerClient=(runtime.database as unknown as {db:InstanceType<typeof Database>}).db;
   triggerClient.prepare('UPDATE pipe_Product SET stock=0 WHERE sku=?').run('linen-01');
   expect(await request(1,0,1,'later-stock-missing')).toMatchObject({status:400,body:{state:'err',error:'There is not enough stock for one or more cart items.'}});
   expect(runtime.database.list('Product')).toEqual(expect.arrayContaining([expect.objectContaining({sku:'cup-01',stock:2}),expect.objectContaining({sku:'linen-01',stock:0})]));
   expect(runtime.database.list('StoreOrder')).toHaveLength(0);
   triggerClient.prepare('UPDATE pipe_Product SET stock=20 WHERE sku=?').run('linen-01');
   expect(await request(2,1,0,'checkout-1')).toMatchObject({status:200,body:{state:'ok',value:'checkout-1'}});
   expect(runtime.database.list('Product')).toEqual(expect.arrayContaining([expect.objectContaining({sku:'cup-01',stock:0}),expect.objectContaining({sku:'pour-over-01',stock:3}),expect.objectContaining({sku:'linen-01',stock:20})]));
   triggerClient.exec(`CREATE TRIGGER reject_order_line BEFORE INSERT ON "pipe_StoreOrderLine" BEGIN SELECT RAISE(ABORT, 'line unavailable'); END`);
   const failedOrder=await fetch(`${runtime.url}/orders`,{method:'POST',headers:{'content-type':'application/json',idempotencyKey:'line-failure'},body:JSON.stringify({cupQuantity:0,pourOverQuantity:0,linenQuantity:1,buyerNote:''})});
   expect(failedOrder.status).toBe(500);
   await failedOrder.text();
   expect(runtime.database.list('StoreOrder')).toHaveLength(1);
   expect(runtime.database.list('StoreOrderLine')).toHaveLength(2);
   expect(runtime.database.list('Product')).toEqual(expect.arrayContaining([expect.objectContaining({sku:'linen-01',stock:20})]));
   expect(await request(1,5,0,'insufficient-stock')).toMatchObject({status:400,body:{state:'err',error:'There is not enough stock for one or more cart items.'}});
   expect(await request(0,0,0,'empty-cart')).toMatchObject({status:400,body:{state:'err',error:'Add at least one item to your order.'}});
   expect(await request(-1,0,0,'negative-cart')).toMatchObject({status:400,body:{state:'err',error:'Cart quantities cannot be negative.'}});
   const duplicate=await request(2,1,0,'checkout-1');expect(duplicate).toMatchObject({status:200,body:{state:'ok',value:'checkout-1'}});
   expect(await request(1,1,0,'checkout-1')).toMatchObject({status:400,body:{state:'err',error:'This checkout key was already used for a different request.'}});
   expect(runtime.database.list('StoreOrder')).toHaveLength(1);
   expect(runtime.database.list('StoreOrder')[0]).toMatchObject({id:1,total:{minor:'12000',scale:2},status:'pending-payment'});
   expect(runtime.database.list('StoreOrderLine')).toHaveLength(2);
   expect(runtime.database.list('Product')).toEqual(expect.arrayContaining([expect.objectContaining({sku:'cup-01',stock:0}),expect.objectContaining({sku:'pour-over-01',stock:3}),expect.objectContaining({sku:'linen-01',stock:20})]));
   expect(runtime.database.list('StoreOrderLine')).toEqual(expect.arrayContaining([
    expect.objectContaining({orderId:1,sku:'cup-01',productName:'Morning ceramic cup',quantity:2,unitPrice:{minor:'2800',scale:2},lineTotal:{minor:'5600',scale:2}}),
    expect.objectContaining({orderId:1,sku:'pour-over-01',productName:'Northline pour-over set',quantity:1,unitPrice:{minor:'6400',scale:2},lineTotal:{minor:'6400',scale:2}}),
   ]));
   await runtime.close();runtime=undefined;
   runtime=await startRuntime(compiled.ir!,out,db,0);
   expect(runtime.database.list('StoreOrder')).toHaveLength(1);
   expect(runtime.database.list('StoreOrder')[0]).toMatchObject({id:1,total:{minor:'12000',scale:2},status:'pending-payment'});
   expect(runtime.database.list('StoreOrderLine')).toHaveLength(2);
   expect(runtime.database.list('Product')).toEqual(expect.arrayContaining([expect.objectContaining({sku:'cup-01',stock:0}),expect.objectContaining({sku:'pour-over-01',stock:3}),expect.objectContaining({sku:'linen-01',stock:20})]));
  }finally{await runtime?.close();rmSync(directory,{recursive:true,force:true})}
 });
 it('replays concurrent duplicate checkout requests without creating another order',async()=>{
  const compiled=compileProject(join(process.cwd(),'examples','northline','main.bmec'));expect(compiled.diagnostics).toEqual([]);
  const directory=mkdtempSync(join(tmpdir(),'bmec-northline-reserve-')),out=join(directory,'generated-a'),otherOut=join(directory,'generated-b'),db=join(directory,'northline.db');
  let runtime:RuntimeHandle|undefined,otherRuntime:RuntimeHandle|undefined;
  try{
   runtime=await startRuntime(compiled.ir!,out,db,0);
   otherRuntime=await startRuntime(compiled.ir!,otherOut,db,0);
   runtime.database.create('Product',{sku:'cup-01',name:'Morning ceramic cup',category:'table',price:'28.00',stock:1});
   runtime.database.create('Product',{sku:'pour-over-01',name:'Northline pour-over set',category:'coffee',price:'64.00',stock:4});
   runtime.database.create('Product',{sku:'linen-01',name:'Everyday linen towel',category:'home',price:'32.00',stock:20});
   const checkout=(url:string)=>fetch(`${url}/orders`,{method:'POST',headers:{'content-type':'application/json',idempotencyKey:'same-checkout'},body:JSON.stringify({cupQuantity:1,pourOverQuantity:0,linenQuantity:0,buyerNote:''})}).then(async response=>({status:response.status,body:await response.json() as any}));
   const results=await Promise.all([checkout(runtime.url),checkout(otherRuntime.url)]);
   expect(results).toEqual(expect.arrayContaining([{status:200,body:{state:'ok',value:'same-checkout'}},{status:200,body:{state:'ok',value:'same-checkout'}}]));
   expect(runtime.database.list('Product')).toEqual(expect.arrayContaining([expect.objectContaining({sku:'cup-01',stock:0})]));
   expect(runtime.database.list('StoreOrder')).toHaveLength(1);
   expect(runtime.database.list('StoreOrderLine')).toHaveLength(1);
  }finally{await otherRuntime?.close();await runtime?.close();rmSync(directory,{recursive:true,force:true})}
 });
 it('allows only one distinct checkout to reserve the last unit concurrently',async()=>{
  const compiled=compileProject(join(process.cwd(),'examples','northline','main.bmec'));expect(compiled.diagnostics).toEqual([]);
  const directory=mkdtempSync(join(tmpdir(),'bmec-northline-distinct-')),out=join(directory,'generated-a'),otherOut=join(directory,'generated-b'),db=join(directory,'northline.db');
  let runtime:RuntimeHandle|undefined,otherRuntime:RuntimeHandle|undefined;
  try{
   runtime=await startRuntime(compiled.ir!,out,db,0);otherRuntime=await startRuntime(compiled.ir!,otherOut,db,0);
   runtime.database.create('Product',{sku:'cup-01',name:'Morning ceramic cup',category:'table',price:'28.00',stock:1});
   runtime.database.create('Product',{sku:'pour-over-01',name:'Northline pour-over set',category:'coffee',price:'64.00',stock:4});
   runtime.database.create('Product',{sku:'linen-01',name:'Everyday linen towel',category:'home',price:'32.00',stock:20});
   const checkout=(url:string,key:string)=>fetch(`${url}/orders`,{method:'POST',headers:{'content-type':'application/json',idempotencyKey:key},body:JSON.stringify({cupQuantity:1,pourOverQuantity:0,linenQuantity:0,buyerNote:''})}).then(async response=>({status:response.status,body:await response.json() as any}));
   const results=await Promise.all([checkout(runtime.url,'checkout-a'),checkout(otherRuntime.url,'checkout-b')]);
   expect(results.filter(result=>result.body.state==='ok')).toHaveLength(1);expect(results.filter(result=>result.body.state==='err')).toHaveLength(1);
   expect(runtime.database.list('Product')).toEqual(expect.arrayContaining([expect.objectContaining({sku:'cup-01',stock:0})]));
   expect(runtime.database.list('StoreOrder')).toHaveLength(1);expect(runtime.database.list('StoreOrderLine')).toHaveLength(1);
  }finally{await otherRuntime?.close();await runtime?.close();rmSync(directory,{recursive:true,force:true})}
 });
});
