const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const XLSX = require('xlsx');
const root = path.resolve(__dirname, '..');
const modules = new Map();
function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const exports = {}; modules.set(relative, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative + '.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText, { exports, module: { exports }, Buffer, Uint8Array, ArrayBuffer, Date, Error, console,
        require: name => name==='./logger'?{logger:{info(){},warn(){},error(){}}}:name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))) : require(name) });
    return exports;
}



const {salesOutlook,shiftDay}=load('src/lib/salesOutlook');
const day='2026-10-26';
function series(n,fn){return Array.from({length:n},(_,i)=>{const date=shiftDay(day,i-n);return {date,netPaise:fn?fn(i,date):70000,bills:1};});}
test('outlook respects calendar weekdays, compares a real baseline and excludes partial/future days',()=>{
 const rows=series(84,(_,date)=>(new Date(date+'T00:00:00Z').getUTCDay()+1)*10000);
 const result=salesOutlook(rows,day);assert.equal(result.status,'READY');assert.equal(result.method,'WEEKDAY');assert.equal(result.backtest.maePaise,0);assert.ok(result.backtest.baselineMaePaise>0);assert.equal(result.points.length,7);assert.equal(result.nextWeekPaise,280000);assert.equal(result.points[0].date,day);
 const contaminated=[...rows,{date:day,netPaise:999999999,bills:1000},{date:shiftDay(day,1),netPaise:99999999,bills:1}];assert.equal(JSON.stringify(salesOutlook(contaminated,day)),JSON.stringify(result));
});
test('short, missing, zero and volatile history cannot become a confident growth prediction',()=>{
 assert.equal(salesOutlook([],day).status,'NO_SALES');assert.equal(salesOutlook(series(20),day).status,'EARLY');assert.equal(salesOutlook(series(28),day).status,'READY');
 assert.equal(salesOutlook(series(56,()=>0),day).status,'NO_SALES');
 const gaps=series(56);for(let i=40;i<47;i++){gaps[i].bills=0;gaps[i].netPaise=0;}assert.equal(salesOutlook(gaps,day).status,'GAPS');
 assert.equal(salesOutlook(series(84, i=>i%13===0?1000000:0),day).status,'VOLATILE');assert.equal(salesOutlook(series(56),day,true).status,'UNRECONCILED');
 const nonCalendar=series(56);nonCalendar.splice(20,1);assert.equal(salesOutlook(nonCalendar,day).status,'GAPS');
});
test('real zero-sales weekdays are retained in the backtest, not discarded from error metrics',()=>{
 const rows=series(84,(_,date)=>new Date(date+'T00:00:00Z').getUTCDay()===0?0:10000);for(const row of rows)if(!row.netPaise)row.bills=0;
 const result=salesOutlook(rows,day);assert.equal(result.status,'READY');assert.equal(result.backtest.days,28);assert.equal(result.backtest.wapePercent,0);assert.equal(result.nextWeekPaise,60000);assert.equal(result.noBillDays,12);
});

test('business insights use dated net sales, exclude untrusted stock, and remain read-only',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zain-insights-'));const {PrismaClient}=require(path.join(root,'prisma/generated/client'));
 const db=new PrismaClient({datasources:{db:{url:'file:'+path.join(directory,'insights.db').replaceAll('\\','/')}}});
 try{
  const sql=execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/generated/client/schema.prisma'),'--script'],{encoding:'utf8',cwd:root});for(const s of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(s);
  const user=await db.user.create({data:{username:'insights-owner',password:'test',name:'Owner',role:'ADMIN',isActive:true}}),service=load('electron/insights.service');const now=new Date('2026-10-26T08:00:00Z');
  const cat=await db.category.create({data:{name:'Shirts'}}),product=await db.product.create({data:{name:'Plain Shirt',categoryId:cat.id}});
  const variant=async(name,stock=2)=>db.productVariant.create({data:{productId:product.id,sku:name,barcode:name,mrp:700,sellingPrice:700,costPrice:0,stock}});
  const tracked=await variant('tracked'),legacy=await variant('legacy',-99),newItem=await variant('new'),invalid=await variant('invalid',-1),noDemand=await variant('quiet',15),prepared=await variant('prepared');
  await db.$executeRawUnsafe('CREATE TABLE StockVariantTracking (variantId TEXT PRIMARY KEY,activatedAt TEXT NOT NULL)');await db.$executeRawUnsafe('ALTER TABLE ProductVariant ADD COLUMN isPrepared INTEGER NOT NULL DEFAULT 0');await db.$executeRawUnsafe('UPDATE ProductVariant SET isPrepared=1 WHERE id=?',prepared.id);
  for(const item of [tracked,invalid,noDemand,prepared])await db.$executeRawUnsafe('INSERT INTO StockVariantTracking VALUES (?,?)',item.id,'2026-07-01T00:00:00Z');await db.$executeRawUnsafe('INSERT INTO StockVariantTracking VALUES (?,?)',newItem.id,'2026-10-20T00:00:00Z');
  const base={userId:user.id,subtotal:700,discount:0,taxAmount:0,cgst:0,sgst:0,grandTotal:700,paidAmount:700,changeAmount:0};
  const make=async(number,date,extra={})=>db.sale.create({data:{...base,billNo:number,createdAt:new Date(date+'T08:00:00Z'),items:{create:{variantId:tracked.id,productName:'Plain Shirt',quantity:1,mrp:700,sellingPrice:700,taxRate:5,taxAmount:0,total:700}},...extra}});
  const bills=[];for(let i=84;i>0;i--)bills.push(await make('B'+i,shiftDay(day,-i)));
  await make('PARTIAL',day,{grandTotal:1000000});await make('FUTURE',shiftDay(day,1),{grandTotal:1000000});await make('VOID',shiftDay(day,-1),{status:'VOIDED',grandTotal:1000000});await make('OLD-IMPORT',shiftDay(day,-1),{isHistorical:true,grandTotal:1000000});await make('DEMO-TEST',shiftDay(day,-1),{grandTotal:1000000});
  await t.test('forecast and stock do not use partial days, imported/void/demo bills, generic negative stock or zero catalogue costs',async()=>{
   const value=await service.getBusinessInsights(db,user,now);assert.equal(value.recentNetPaise,1960000);assert.equal(value.previousNetPaise,1960000);assert.equal(value.changePercent,0);assert.equal(value.outlook.nextWeekPaise,490000);assert.equal(value.excludedDemoBills,1);
   assert.equal(value.inventory.legacy,1);assert.equal(value.inventory.tracked,4);assert.equal(value.inventory.invalidCounts,1);assert.equal(value.stock.find(r=>r.id===tracked.id).reviewUnits,26);assert.equal(value.stock.find(r=>r.id===newItem.id).daysCover,null);assert.equal(value.stock.find(r=>r.id===noDemand.id).status,'NO_DEMAND');assert.equal(value.stock.some(r=>r.id===prepared.id),false);assert.equal(JSON.stringify(value).includes('costPrice'),false);
  });
  await t.test('backdated actual-sale dates and refund event dates drive recorded net results',async()=>{
   await make('BACKDATED',day,{actualSaleDate:new Date('2026-10-24T08:00:00Z')});await db.refund.create({data:{originalInvoiceId:bills[0].id,refundDate:new Date('2026-10-25T08:00:00Z'),totalRefundAmount:700,reason:'Test return',createdBy:user.id,items:{create:{variantId:tracked.id,quantity:1,amount:700}}}});
   const value=await service.getBusinessInsights(db,user,now);assert.equal(value.recentNetPaise,1960000);assert.equal(value.stock.find(r=>r.id===tracked.id).netUnits28,28);assert.equal(value.history.find(d=>d.date==='2026-10-24').netPaise,140000);assert.equal(value.history.find(d=>d.date==='2026-10-25').netPaise,0);
  });
  await t.test('permission is fresh and no financial or tracking tables are created by reading',async()=>{
   await assert.rejects(service.getBusinessInsights(db,{...user,role:'CASHIER',permViewInsights:false},now),/permission/);await assert.rejects(service.getBusinessInsights(db,{...user,isActive:false},now),/permission/);
   const allowed=await service.getBusinessInsights(db,{...user,role:'CASHIER',permViewInsights:true,permViewCostPrice:false},now);assert.equal(allowed.bills28,29);
   assert.equal((await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE name IN ('StockCostCoverage','ExchangeRevenue','PurchaseInvoice')")).length,0);
  });
  await t.test('desktop and browser channels use fresh authenticated permissions, not supplied owner IDs',async()=>{
   const auth=load('electron/session-auth.service'),event={sender:{id:7123,isDestroyed:()=>false}};
   const cashier=await db.user.create({data:{username:'insights-user',password:'test',name:'Insights user',role:'CASHIER',isActive:true,permViewInsights:true}});
   const handlers=new Map(),main=fs.readFileSync(path.join(root,'electron/main.ts'),'utf8');
   const helper=main.slice(main.indexOf('function createSecureIpcHandler<'),main.indexOf('// --- Input Validation Helpers ---'));
   const route=main.slice(main.indexOf('// --- Business Insights Read Handler ---'),main.indexOf('// --- End Business Insights Read Handler ---'));
   const context={prisma:db,ipcMain:{handle:(channel,fn)=>handlers.set(channel,fn)},resolveElectronSessionUser:auth.resolveElectronSessionUser,PermissionMiddleware:load('electron/permission.service').PermissionMiddleware,getBusinessInsights:(db,user)=>service.getBusinessInsights(db,user,now),logger:{warn(){},error(){}}};
   vm.runInNewContext(ts.transpileModule(helper+route,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
   let bridge;vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'electron/preload.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:{},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_,api)=>bridge=api},ipcRenderer:{invoke:(channel,args)=>handlers.get(channel)(event,args)}};}});
   assert.equal((await handlers.get('insights:get')(event,{userId:user.id})).success,false);
   auth.electronSessions.bind(event.sender.id,cashier.id);assert.equal((await bridge.insights.get()).success,true);
   const {EventEmitter}=require('events'),{createDevBridgeHandler}=require('../electron/devBridge.cjs');
   const sessions=new auth.SessionAuthStore();sessions.bind('test-insights-token',cashier.id);const browser=createDevBridgeHandler({prisma:db,sessions});
   async function request(){return new Promise(async(resolve,reject)=>{const req=new EventEmitter();req.method='POST';req.headers={authorization:'Bearer test-insights-token',host:'localhost'};req.socket={};const res={statusCode:0,setHeader(){},end:body=>resolve(JSON.parse(body))};try{await browser(req,res);req.emit('data',JSON.stringify({channel:'insights:get',args:{userId:user.id}}));req.emit('end');}catch(error){reject(error);}});}
   assert.equal((await request()).success,true);
   await db.user.update({where:{id:cashier.id},data:{permViewInsights:false}});
   assert.equal((await bridge.insights.get()).success,false);assert.equal((await request()).success,false);
  });
  await t.test('unreconciled net sales retain a clearly labelled six-month billed-sales projection',async()=>{
   await db.invoicePayment.create({data:{saleId:bills[bills.length-1].id,paymentMode:'EXCHANGE_CREDIT',amount:50}});
   const value=await service.getBusinessInsights(db,user,now);assert.equal(value.recentNetPaise,null);assert.ok(value.unresolvedExchangeBills>0);assert.equal(value.monthly.basis,'BILLED');assert.match(value.monthly.basisNote,/not net revenue/);assert.equal(value.monthly.projections.length,6);assert.ok(value.monthly.projections[0].predictedPaise>0);assert.equal(value.monthly.projections[0].month,'2026-11');
  });
 }finally{await db.$disconnect();if(path.dirname(path.resolve(directory))===path.resolve(os.tmpdir())&&path.basename(directory).startsWith('zain-insights-'))fs.rmSync(directory,{recursive:true,force:true});}
});

const {monthlyForecast,shiftMonth}=load('src/lib/monthlyForecast');
const {seasonAlerts}=load('src/lib/forecastSeasons');
function fullDays(start,today,value=70000){const days=[];for(let date=start;date<today;date=shiftDay(date,1))days.push({date,netPaise:typeof value==='function'?value(date):value,bills:1});return days;}
test('monthly forecasts retain six future months across years and account for month length',()=>{
 const records=fullDays('2024-10-01',day),plan=monthlyForecast(records,day,'NET');
 assert.equal(plan.projections.length,6);assert.equal(plan.projections[0].month,'2026-11');assert.equal(plan.projections[5].month,'2027-04');assert.equal(plan.projections[0].predictedPaise,2100000);assert.equal(plan.projections[3].predictedPaise,1960000);assert.equal(plan.history.length,24);assert.equal(plan.seasonality,true);assert.equal(plan.backtest.maePaise,0);
 for(const p of plan.projections){assert.ok(p.lowerPaise<=p.predictedPaise);assert.ok(p.upperPaise>=p.predictedPaise);assert.ok(p.lowerPaise>=0);assert.notEqual(p.lastYearPaise,null);}
 assert.ok(plan.projections[5].upperPaise-plan.projections[5].predictedPaise>plan.projections[0].upperPaise-plan.projections[0].predictedPaise);
});
test('partial months and future entries cannot become observed monthly training or fake year comparisons',()=>{
 const records=fullDays('2026-07-15',day),plan=monthlyForecast(records,day,'NET');assert.deepEqual(Array.from(plan.history,m=>m.month),['2026-08','2026-09']);assert.equal(plan.seasonality,false);assert.equal(plan.backtest,null);assert.equal(plan.projections[0].lastYearPaise,null);assert.equal(plan.comparisons[1].previousPaise,null);
 const changed=records.map(d=>d.date.startsWith('2026-10')?{...d,netPaise:99999999}:d);changed.push({date:day,netPaise:999999999,bills:1});changed.push({date:'2027-02-01',netPaise:999999999,bills:1});const other=monthlyForecast(changed,day,'NET');assert.equal(other.projections[0].predictedPaise,plan.projections[0].predictedPaise);assert.notEqual(other.currentMonth.actualPaise,plan.currentMonth.actualPaise);
});
test('early and billed-value planning keeps all horizons with explicit limitations',()=>{
 const early=monthlyForecast(fullDays('2026-10-10',day),day,'BILLED');assert.equal(early.method,'DAILY_RUN_RATE');assert.equal(early.basis,'BILLED');assert.match(early.basisNote,/not net revenue/);assert.equal(early.projections.length,6);assert.ok(early.projections[0].predictedPaise>0);
 const empty=monthlyForecast([],day,'NET');assert.equal(empty.method,'NONE');assert.equal(empty.projections.length,6);assert.ok(empty.projections.every(p=>p.predictedPaise===null));
});
test('comparisons match elapsed calendar days and preserve zero and missing comparison values',()=>{
 const plan=monthlyForecast(fullDays('2025-01-01','2026-03-31',10000),'2026-03-31','NET'),comparison=plan.comparisons[0];assert.equal(comparison.currentPaise,280000);assert.equal(comparison.previousPaise,280000);assert.match(comparison.currentLabel,/first 28 days/);assert.equal(comparison.changePercent,0);
 const first=monthlyForecast(fullDays('2026-01-01','2026-03-01'),'2026-03-01','NET');assert.equal(first.comparisons[0].currentPaise,null);assert.equal(first.currentMonth.projectedPaise,null);assert.equal(shiftMonth('2026-12',1),'2027-01');
});
test('season alerts cover the selected planning horizon without assigning fake religious dates',()=>{
 const alerts=seasonAlerts(day,6,[{id:'confirmed-eid',name:'Confirmed Eid planning',date:'2027-03-10'},{id:'past',name:'Past season',date:'2026-02-01'}]);assert.ok(alerts.some(a=>a.id==='christmas-2026'));assert.ok(alerts.some(a=>a.id==='newyear-2027'));assert.ok(alerts.some(a=>a.id==='vishu-2027'&&a.start==='2027-04-01'&&a.end==='2027-04-30'));assert.ok(alerts.some(a=>a.id==='confirmed-eid'));assert.equal(alerts.some(a=>a.id==='past'),false);assert.equal(seasonAlerts(day,1).some(a=>a.id==='christmas-2026'),false);assert.equal(alerts.some(a=>a.id.startsWith('onam')),false);
});

test('annual seasonality is removed from the baseline before the target-month adjustment',()=>{
 const records=fullDays('2024-10-01',day,date=>['10','11','12'].includes(date.slice(5,7))?130000:date.slice(5,7)==='01'?100000:90000);
 const plan=monthlyForecast(records,day,'NET');assert.equal(plan.seasonality,true);assert.equal(plan.projections[0].predictedPaise,3900000);assert.equal(plan.projections[5].predictedPaise,2700000);
});
