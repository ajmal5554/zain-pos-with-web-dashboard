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
    }).outputText, { exports, module: { exports }, Buffer, Uint8Array, ArrayBuffer, Date, console,
        require: name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))) : require(name) });
    return exports;
}


test('GST purchase capture preserves invoice totals, pending costs and supplier corrections',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zain-purchase-tax-'));
 const {PrismaClient}=require(path.join(root,'prisma/generated/client'));
 const db=new PrismaClient({datasources:{db:{url:'file:'+path.join(directory,'tax.db').replaceAll('\\','/')}}});
 try{
  const sql=execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/generated/client/schema.prisma'),'--script'],{encoding:'utf8',cwd:root});for(const s of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(s);
  const user=await db.user.create({data:{username:'tax-owner',password:'test',name:'Owner',role:'ADMIN',isActive:true}});
  const service=load('electron/purchases.service'),adjust=load('electron/purchase-adjustments.service');await service.ensurePurchaseSchema(db);
  const cat=await db.category.create({data:{name:'Shirts'}}),product=await db.product.create({data:{name:'Test item',categoryId:cat.id}});
  async function line(quantity,unitCost,hsn='61091000'){
   const row=await db.productVariant.create({data:{productId:product.id,sku:randomUUID(),barcode:randomUUID(),mrp:1000,sellingPrice:700,costPrice:0,stock:0}});
   await db.$executeRawUnsafe('INSERT INTO StockVariantTracking (variantId,activatedAt) VALUES (?,?)',row.id,new Date().toISOString());
   return {variantId:row.id,quantity,unitCost,hsn,sellingPrice:700,mrp:1000,expectedSellingPrice:700,expectedMrp:1000};
  }
  const tax=(cgst,sgst,roundOff=0)=>({supplierGstin:'',cgst,sgst,igst:0,roundOff,itcStatus:'PENDING'});
  const input=(number,lines,vat)=>({operationId:randomUUID(),supplier:'Test supplier',invoiceNumber:number,invoiceDate:'2026-10-01',batchName:'Tax test',discount:0,charges:0,paid:0,paymentMode:'UPI',lines,tax:vat});
  let mamta,crazy;
  await t.test('Mamta: 137 pieces, 49980 taxable, 2499 GST, 52479 payable and provisional cost',async()=>{
   const request=input('MAMTA',[await line(32,240,'62101000'),await line(80,410,'620342'),await line(25,380,'620342')],tax(1249.50,1249.50));
   mamta=await service.receivePurchase(db,request,user);assert.equal(mamta.totalPaise,5247900);
   const state=await service.purchaseDetail(db,{id:mamta.id},user);assert.equal(state.tax.taxablePaise,4998000);assert.equal(state.tax.totalTaxPaise,249900);assert.equal(state.tax.itcStatus,'PENDING');assert.equal(state.duePaise,5247900);assert.equal(state.lines.reduce((n,l)=>n+l.landedTotalPaise,0),5247900);assert.equal(state.lines[1].hsn,'620342');
   const retry=await service.receivePurchase(db,request,user);assert.equal(retry.id,mamta.id);assert.equal((await db.productVariant.findUnique({where:{id:request.lines[0].variantId}})).stock,32);
   await assert.rejects(service.receivePurchase(db,{...request,tax:tax(1000,1000)},user),/different content/);
  });
  await t.test('Crazy Heart: 30 pieces at 390 plus GST = 12285, paid and due use invoice total',async()=>{
   const request=input('CRAZY',[await line(30,390)],tax(292.5,292.5));request.paid=1000;crazy=await service.receivePurchase(db,request,user);
   const state=await service.purchaseDetail(db,{id:crazy.id},user);assert.equal(state.totalPaise,1228500);assert.equal(state.duePaise,1128500);assert.equal(state.lines[0].landedTotalPaise,1228500);assert.equal(state.lines[0].unitCostPaise,39000);
  });
  await t.test('Rajdhani: negative ten-paise rounding reconciles the printed total',async()=>{
   const amounts=[[24,318],[24,242],[12,210],[24,230],[12,245],[12,255],[12,275],[12,286],[6,235],[12,250],[6,265],[6,275],[60,240],[16,245],[8,230],[12,245]];
   const lines=[];for(const [q,c] of amounts)lines.push(await line(q,c));const saved=await service.receivePurchase(db,input('RAJDHANI',lines,tax(1624.05,1624.05,-.10)),user);
   const state=await service.purchaseDetail(db,{id:saved.id},user);assert.equal(state.tax.taxablePaise,6496200);assert.equal(state.totalPaise,6821000);assert.equal(state.tax.roundOffPaise,-10);assert.equal(state.lines.reduce((n,l)=>n+l.landedTotalPaise,0),6821000);
  });
  await t.test('invalid mixed tax, claimed ITC, malformed metadata and rounding reject before receiving stock',async()=>{
   const sample=await line(1,400);const base=input('BAD',[sample],tax(10,10));
   for(const patch of [{igst:20},{itcStatus:'ELIGIBLE'},{roundOff:5},{cgst:1.001},{cgst:-1},{supplierGstin:'bad'}])await assert.rejects(service.receivePurchase(db,{...base,tax:{...base.tax,...patch}},user));
   await assert.rejects(service.receivePurchase(db,{...base,lines:[{...sample,hsn:'abc'}]},user),/HSN/);assert.equal((await db.productVariant.findUnique({where:{id:sample.variantId}})).stock,0);
  });
  await t.test('correction requires the tax breakdown, keeps its original, and revises cost atomically',async()=>{
   const state=await service.purchaseDetail(db,{id:crazy.id},user),row=state.lines[0];
   const request={operationId:randomUUID(),purchaseId:state.id,expectedRevision:state.revision,kind:'CORRECTION',reason:'Correct copied rate',supplier:state.supplier,invoiceNumber:state.invoiceNumber,invoiceDate:state.invoiceDate,batchName:state.batchName,discount:0,charges:0,lines:[{lineId:row.id,quantity:30,unitCost:400,hsn:'61099090'}]};
   await assert.rejects(adjust.adjustPurchase(db,request,user),/GST breakdown/);
   request.tax=tax(300,300);await adjust.adjustPurchase(db,request,user);await adjust.adjustPurchase(db,request,user);
   const revised=await service.purchaseDetail(db,{id:state.id},user);assert.equal(revised.totalPaise,1260000);assert.equal(revised.duePaise,1160000);assert.equal(revised.tax.totalTaxPaise,60000);assert.equal(revised.original.tax.totalTaxPaise,58500);assert.equal(revised.lines[0].landedTotalPaise,1260000);assert.equal(revised.lines[0].hsn,'61099090');
  });
  await t.test('supplier return reduces payable while preserving the original GST evidence for review',async()=>{
   const state=await service.purchaseDetail(db,{id:mamta.id},user);await adjust.adjustPurchase(db,{operationId:randomUUID(),purchaseId:state.id,expectedRevision:state.revision,kind:'RETURN',reason:'Credit note to review',credit:252,lines:[{lineId:state.lines[0].id,quantity:1}]},user);
   const after=await service.purchaseDetail(db,{id:state.id},user);assert.equal(after.totalPaise,5222700);assert.equal(after.tax.totalTaxPaise,249900);assert.equal(after.lines[0].returnedQuantity,1);
  });
  await t.test('IGST and tax-free recorded invoices do not need a hard-coded tax rate',async()=>{
   const request=input('IGST',[await line(1,400)],{...tax(0,0),igst:20});const saved=await service.receivePurchase(db,request,user);assert.equal(saved.totalPaise,42000);
   const noTax=await service.receivePurchase(db,input('ZERO',[await line(1,400)],tax(0,0)),user);assert.equal(noTax.totalPaise,40000);
  });
  await t.test('late failure rolls back stock, invoice, tax and HSN snapshots together',async()=>{
   const sample=await line(1,400);const request=input('ROLLBACK',[sample],tax(10,10));request.paymentMode='CASH_DRAWER';request.paid=420;
   await assert.rejects(service.receivePurchase(db,request,user),/Open today/);assert.equal((await db.productVariant.findUnique({where:{id:sample.variantId}})).stock,0);
   assert.equal((await db.$queryRawUnsafe("SELECT id FROM PurchaseInvoice WHERE invoiceNumber='ROLLBACK'")).length,0);
   assert.equal((await db.$queryRawUnsafe('SELECT t.* FROM PurchaseTaxLine t LEFT JOIN PurchaseReceiptLine l ON l.id=t.lineId WHERE l.id IS NULL')).length,0);
  });
 }finally{await db.$disconnect();if(path.dirname(path.resolve(directory))===path.resolve(os.tmpdir())&&path.basename(directory).startsWith('zain-purchase-tax-'))fs.rmSync(directory,{recursive:true,force:true});}
});
