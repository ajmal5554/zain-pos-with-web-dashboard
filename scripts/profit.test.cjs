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
        require: name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))) : require(name) });
    return exports;
}


test('profit: read-only cohort totals, permissions, boundaries and completeness',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zain-profit-'));
 const {PrismaClient}=require(path.join(root,'prisma/generated/client'));
 const db=new PrismaClient({datasources:{db:{url:'file:'+path.join(directory,'test.db').replaceAll('\\','/')}}});
 try{
  const sql=execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/generated/client/schema.prisma'),'--script'],{encoding:'utf8',cwd:root});
  for(const statement of sql.split(';').map(v=>v.trim()).filter(Boolean))await db.$executeRawUnsafe(statement);
  const owner=await db.user.create({data:{username:'owner',password:'test',name:'Owner',role:'ADMIN',isActive:true}});
  const service=load('electron/profit.service'),cost=load('electron/stock-cost.service');
  const range={from:'2026-10-01',to:'2026-10-25'};
  await assert.rejects(()=>service.getProfitReport(db,range,{...owner,role:'CASHIER',permViewCostPrice:true}),/owner/);
  await assert.rejects(()=>service.getProfitReport(db,{from:'2026-02-30',to:range.to},owner),/valid date/);
  const category=await db.category.create({data:{name:'Shirts'}});
  const product=await db.product.create({data:{name:'Shirt',categoryId:category.id}});
  const variant=await db.productVariant.create({data:{productId:product.id,sku:'test',barcode:'123',sellingPrice:700,mrp:700,costPrice:999,stock:1}});
  const base={billNo:'1',userId:owner.id,subtotal:700,discount:50,taxAmount:30,cgst:15,sgst:15,grandTotal:650,paidAmount:650,changeAmount:0,createdAt:new Date('2026-10-02T05:00:00Z')};
  const sale=await db.sale.create({data:{...base,items:{create:{variantId:variant.id,productName:'Shirt',quantity:1,mrp:700,sellingPrice:700,taxRate:5,taxAmount:30,total:700}}}});
  let report=await service.getProfitReport(db,range,owner);
  assert.equal(report.billedPaise,65000);assert.equal(report.missingBills,1);assert.equal(report.grossProfitPaise,null);
  assert.equal((await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE name='StockCostCoverage'")).length,0);
  await db.$transaction(async tx=>{await cost.prepareStockCosts(tx,[variant.id]);await tx.$executeRawUnsafe('UPDATE StockCostLot SET remainingCostPaise=40000');await cost.syncSaleCosts(tx,sale.id,new Map([[variant.id,1]]),new Map(),true);});
  report=await service.getProfitReport(db,range,owner);assert.equal(report.grossProfitPaise,25000);assert.equal(report.operatingProfitPaise,25000);
  await db.$executeRawUnsafe('CREATE TABLE ShopExpense (id TEXT,status TEXT,amountPaise INTEGER,expenseDate TEXT,drawerTxId TEXT)');
  await db.$executeRawUnsafe("INSERT INTO ShopExpense VALUES ('e','ACTIVE',10000,'2026-10-03',NULL),('x','EXCLUDED',99000,'2026-10-03',NULL)");
  report=await service.getProfitReport(db,range,owner);assert.equal(report.expensePaise,10000);assert.equal(report.operatingProfitPaise,15000);
  await db.$executeRawUnsafe('CREATE TABLE CashRegister (id TEXT,date TEXT)');await db.$executeRawUnsafe('CREATE TABLE CashDrawerTx (id TEXT,registerId TEXT,type TEXT,category TEXT,amount REAL)');
  await db.$executeRawUnsafe("INSERT INTO CashRegister VALUES ('r','2026-10-03')");await db.$executeRawUnsafe("INSERT INTO CashDrawerTx VALUES ('tea','r','CASH_OUT','EXPENSE',100),('home','r','CASH_OUT','OWNER_WITHDRAWAL',10000)");
  report=await service.getProfitReport(db,range,owner);assert.equal(report.reviewAmountPaise,10000);assert.equal(report.operatingProfitPaise,null);
  await db.refund.create({data:{originalInvoiceId:sale.id,totalRefundAmount:50,reason:'test',createdBy:owner.id,refundDate:new Date('2026-10-26T05:00:00Z')}});
  report=await service.getProfitReport(db,range,owner);assert.equal(report.netSalesPaise,60000);assert.equal(report.laterReturns,1);assert.equal(report.operatingProfitPaise,null);
  await db.invoicePayment.create({data:{saleId:sale.id,paymentMode:'EXCHANGE_CREDIT',amount:50}});
  report=await service.getProfitReport(db,range,owner);assert.equal(report.netSalesPaise,null);assert.equal(report.grossProfitPaise,null);
  await db.sale.create({data:{...base,billNo:'2',status:'VOIDED'}});await db.sale.create({data:{...base,billNo:'3',isHistorical:true}});
  await db.sale.create({data:{...base,billNo:'4',createdAt:new Date('2026-10-01T00:00:00Z'),actualSaleDate:new Date('2026-09-30T18:29:59Z')}});
  assert.equal((await service.getProfitReport(db,range,owner)).bills,1);
 }finally{await db.$disconnect();if(directory.startsWith(os.tmpdir())&&path.basename(directory).startsWith('zain-profit-'))fs.rmSync(directory,{recursive:true,force:true});}
});
