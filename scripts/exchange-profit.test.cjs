const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
} }).outputText;
const loaded = new Map();
function load(relative) {
    if (loaded.has(relative)) return loaded.get(relative);
    const exports = {};
    loaded.set(relative, exports);
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, relative + '.ts'), 'utf8')), {
        exports, module: { exports }, Buffer, Date,
        require: name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))) : require(name),
    });
    return exports;
}
const guard = load('electron/tracked-stock.service');
const catalogue = load('electron/catalogue.service');
const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
let directory, database, databaseUrl, actor, checkout, update, exchange, refund, voidSale, billNumberRequests = 0;

before(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-stock-cost-'));
    databaseUrl = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`;
    database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const sql = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff',
        '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/generated/client/schema.prisma'), '--script'], { encoding: 'utf8', cwd: root });
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await database.$executeRawUnsafe(statement);
    await catalogue.ensureCatalogueSchema(database);
    await database.$executeRawUnsafe('CREATE TABLE "StockVariantTracking" (variantId TEXT NOT NULL PRIMARY KEY, activatedAt TEXT NOT NULL, FOREIGN KEY (variantId) REFERENCES "ProductVariant" (id) ON DELETE CASCADE)');
    actor = await database.user.create({ data: { username: randomUUID(), password: 'test-only', name: 'Test Owner', role: 'ADMIN', isActive: true, permEditSales: true } });
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const context = {
        ...guard, ...load('src/lib/refund'), ...load('src/lib/saleEdit'), ...load('src/lib/catalogueDescription'),
        ...load('electron/return-stock.service'), ...load('electron/stock-cost.service'),
        enrichCatalogueVariants: catalogue.enrichCatalogueVariants, prisma: database,
        ipcMain: { handle: (channel, handler) => { if (channel === 'sales:checkout') checkout = handler; if (channel === 'sales:updateSale') update = handler; } },
        createSecureIpcHandler: (channel, _permission, handler) => { if (channel === 'sales:exchange') exchange = handler; if(channel==='sales:refund')refund=handler; if(channel==='sales:voidSale')voidSale=handler; },
        PermissionMiddleware: { editSale: null,voidSale:null },
        sanitizeString: value => value == null ? undefined : String(value).trim().slice(0, 500),
        roundCurrency: value => Math.round(Number(value || 0) * 100) / 100,
        getNextBillNoForDate: async () => { billNumberRequests++; return `test-${randomUUID()}`; },
        cloudSync: { queueRefund:async()=>{}, queueSale: async () => {}, queueExchange: async () => {}, syncAuditLogs: async () => {} },
        logger:{info(){},error(){}}, saleCounterSinceLastBackup: 0, performAutoBackup() {}, console: { error() {}, log() {}, info() {}, warn() {} },
    };
    const validation = main.slice(main.indexOf('// --- Input Validation Helpers ---'), main.indexOf('function validateProductData('));
    const checkoutSource = main.slice(main.indexOf("ipcMain.handle('sales:checkout'"), main.indexOf("ipcMain.handle('sales:updatePayment'"));
    const updateSource = main.slice(main.indexOf("ipcMain.handle('sales:updateSale'"), main.indexOf('// Professional Exchange Handler'));
    const exchangeSource = main.slice(main.indexOf('// Professional Exchange Handler'), main.indexOf('// Retrieve structured Exchange/Refund details'));
    const refundSource=main.slice(main.indexOf('// Professional Refund Handler'),main.indexOf('// Void Sale —'));
    const voidSource=main.slice(main.indexOf('// Void Sale —'),main.indexOf('// Print handlers'));
    vm.runInNewContext(compile([validation, checkoutSource, updateSource, exchangeSource,refundSource,voidSource].join('\n')), context);
});

after(async () => {
    await database?.$disconnect();
    if (directory && path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('zain-stock-cost-')) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

async function variant({ stock = 1, tracked = true, price = 700, prepared = false, categoryId = null } = {}) {
    const category = categoryId ? { id: categoryId } : await database.category.create({ data: { name: randomUUID() } });
    const product = await database.product.create({ data: { name: 'Test Shirt', categoryId: category.id } });
    const row = await database.productVariant.create({ data: { productId: product.id, sku: randomUUID(), barcode: randomUUID(), size: 'XL', mrp: price, sellingPrice: price, costPrice: 300, stock } });
    if (tracked) await database.$executeRawUnsafe('INSERT INTO "StockVariantTracking" (variantId,activatedAt) VALUES (?,?)', row.id, '2026-10-14T09:00:00.000Z');
    if (prepared) await database.$executeRawUnsafe('UPDATE "ProductVariant" SET isPrepared = 1 WHERE id = ?', row.id);
    return row;
}
function payload(items) {
    const subtotal = items.reduce((sum, item) => sum + item.variant.sellingPrice * item.quantity, 0);
    return { userId: actor.id, subtotal, discount: 0, discountPercent: 0, taxAmount: 0, cgst: 0, sgst: 0,
        grandTotal: subtotal, paidAmount: subtotal, changeAmount: 0, paymentMethod: 'CASH',
        items: items.map(({ variant: item, quantity }) => ({ variantId: item.id, productName: 'Test Shirt', variantInfo: 'XL', quantity, mrp: item.mrp,
            sellingPrice: item.sellingPrice, discount: 0, taxRate: 5, taxAmount: 0, total: item.sellingPrice * quantity })),
        payments: [{ paymentMode: 'CASH', amount: subtotal }],
    };
}
async function seedSale(item, quantity = 1) {
    const data = payload([{ variant: item, quantity }]);
    return database.sale.create({ data: { ...data, billNo: randomUUID(), items: { create: data.items }, payments: { create: data.payments } }, include: { items: true, payments: true } });
}
const stock = async id => (await database.productVariant.findUnique({ where: { id } })).stock;
const counts = async () => Promise.all([database.sale.count(), database.saleItem.count(), database.invoicePayment.count(), database.inventoryMovement.count(), database.exchange.count(), database.auditLog.count()]);

const costing=load('electron/stock-cost.service');
async function buy(item,quantity,unitCost,extra={}){
    return load('electron/purchases.service').receivePurchase(database,{operationId:randomUUID(),supplier:'Cost test supplier',invoiceNumber:randomUUID(),invoiceDate:'2026-10-01',batchName:'Cost receipt',discount:0,charges:0,paid:0,paymentMode:'UPI',lines:[{variantId:item.id,quantity,unitCost,sellingPrice:item.sellingPrice,mrp:item.mrp,expectedSellingPrice:item.sellingPrice,expectedMrp:item.mrp}],...extra},actor);
}
async function sold(item,quantity){const result=await checkout(null,payload([{variant:item,quantity}]));assert.equal(result.success,true,result.error);return result.data;}
const cost=saleId=>costing.getSaleCosts(database,{saleId},actor);
async function returned(sale,item,quantity,choice){
    const request={requestId:randomUUID(),originalInvoiceId:sale.id,userId:actor.id,reason:'Cost test return',originalDiscount:0,totalAmount:quantity*item.sellingPrice,
        items:[{id:item.id,qty:quantity,amount:quantity*item.sellingPrice,...(choice?{stockChoice:choice}:{})}],payments:[{paymentMode:'CASH',amount:quantity*item.sellingPrice}]};
    const result=await refund(null,request,actor);assert.equal(result.success,true,result.error);return {request,result};
}

const profit=load('electron/profit.service');
const date=n=>`2026-10-${String(n).padStart(2,'0')}`;
const report=n=>profit.getProfitReport(database,{from:date(n),to:date(n)},actor);
async function swap(original,oldItem,newItem,{returnedQty=1,newQty=1,discount=0,payment=0}={}){
 const result=await exchange(null,{originalInvoiceId:original.id,userId:actor.id,discount,items:[{returnedId:oldItem.id,returnedQty,newId:newItem.id,newQty,priceDiff:newItem.sellingPrice-oldItem.sellingPrice}],payments:payment?[{paymentMode:'CASH',amount:payment}]:[],replacementPaymentMethod:'CASH'},actor);
 assert.equal(result.success,true,result.error);return {...result.data,id:result.data.exchange.id};
}
async function retime(day,sales,exchanges=[]){
 const value=new Date(`${date(day)}T06:00:00Z`);
 for(const sale of sales)await database.sale.update({where:{id:sale.id},data:{actualSaleDate:value}});
 for(const exchange of exchanges)await database.exchange.update({where:{id:exchange.id},data:{exchangeDate:value}});
}

test('upgrade reverses full agreed credit once on a partial discounted bill',async()=>{
 const old=await variant({stock:0}),fresh=await variant({stock:0,price:800});await buy(old,2,400);await buy(fresh,1,500);
 const request=payload([{variant:old,quantity:2}]);request.discount=100;request.grandTotal=1300;request.paidAmount=1300;request.payments[0].amount=1300;
 const result=await checkout(null,request);assert.equal(result.success,true,result.error);const original=result.data;
 const ex=await swap(original,old,fresh,{payment:100});await retime(1,[original,ex.replacementSale],[ex]);
 const totals=await report(1);assert.equal(totals.billedPaise,210000);assert.equal(totals.exchangeReversalPaise,70000);assert.equal(totals.netSalesPaise,140000);assert.equal(totals.knownCostPaise,90000);assert.equal(totals.grossProfitPaise,50000);assert.equal(totals.operatingProfitPaise,50000);assert.equal(totals.unresolvedExchangeBills,0);
 assert.equal((await database.sale.findUnique({where:{id:original.id}})).grandTotal,1300);assert.equal(await stock(old.id),1);assert.equal(await stock(fresh.id),0);
 const rows=await database.$queryRawUnsafe('SELECT * FROM ExchangeRevenue WHERE exchangeId=?',ex.id);assert.equal(Number(rows[0].freshPaymentPaise),10000);assert.equal(Number(rows[0].returnedCreditPaise),70000);
 const insights=await load('electron/insights.service').getBusinessInsights(database,actor,new Date('2026-10-02T08:00:00Z'));assert.equal(insights.recentNetPaise,140000);assert.equal(insights.unresolvedExchangeBills,0);
});

test('even swap preserves original discount and saved cost with no new payment',async()=>{
 const item=await variant({stock:0});await buy(item,1,400);
 const request=payload([{variant:item,quantity:1}]);request.discount=50;request.grandTotal=650;request.paidAmount=650;request.payments[0].amount=650;
 const original=(await checkout(null,request)).data;const ex=await swap(original,item,item);await retime(2,[original,ex.replacementSale],[ex]);
 const totals=await report(2);assert.equal(totals.netSalesPaise,65000);assert.equal(totals.grossProfitPaise,25000);assert.equal(totals.knownCostPaise,40000);assert.equal(totals.surplusCreditIssuedPaise,0);assert.equal(await stock(item.id),0);
 await buy(item,1,900);assert.equal((await report(2)).grossProfitPaise,25000);
});

test('downgrade surplus is an issued customer obligation, not additional revenue',async()=>{
 const old=await variant({stock:0,price:1295}),fresh=await variant({stock:0,price:875});await buy(old,1,700);await buy(fresh,1,400);
 const original=await sold(old,1),ex=await swap(original,old,fresh);await retime(3,[original,ex.replacementSale],[ex]);
 const totals=await report(3);assert.equal(totals.netSalesPaise,87500);assert.equal(totals.surplusCreditIssuedPaise,42000);assert.equal(totals.grossProfitPaise,47500);assert.equal(totals.unresolvedExchangeBills,0);
});

test('replacement cash refund cannot pay out the internal exchange credit',async()=>{
 const old=await variant({stock:0}),fresh=await variant({stock:0,price:800});await buy(old,1,400);await buy(fresh,1,500);
 const original=await sold(old,1),ex=await swap(original,old,fresh,{payment:100});
 const response=await refund(null,{requestId:randomUUID(),originalInvoiceId:ex.replacementSale.id,userId:actor.id,reason:'Cash out exchange credit',originalDiscount:0,totalAmount:800,items:[{id:fresh.id,qty:1,amount:800}],payments:[{paymentMode:'CASH',amount:800}]},actor);
 assert.equal(response.success,false);assert.match(response.error,/Exchange credit/);
 await retime(4,[original,ex.replacementSale],[ex]);
 const totals=await report(4);assert.equal(totals.netSalesPaise,80000);assert.equal(totals.knownCostPaise,50000);assert.equal(totals.grossProfitPaise,30000);assert.equal(totals.unresolvedExchangeBills,0);assert.equal(await stock(fresh.id),0);
});

test('separate bill dates reconcile without pulling the original revenue into replacement day',async()=>{
 const old=await variant({stock:0}),fresh=await variant({stock:0,price:800});await buy(old,1,400);await buy(fresh,1,500);
 const original=await sold(old,1),ex=await swap(original,old,fresh,{payment:100});await retime(5,[original]);await retime(6,[ex.replacementSale],[ex]);
 const first=await report(5),second=await report(6),combined=await profit.getProfitReport(database,{from:date(5),to:date(6)},actor);
 assert.equal(first.netSalesPaise,0);assert.equal(first.operatingProfitPaise,null);assert.equal(first.laterReturns,1);assert.equal(second.netSalesPaise,80000);assert.equal(second.grossProfitPaise,30000);assert.equal(combined.grossProfitPaise,30000);assert.equal(combined.operatingProfitPaise,30000);
});

test('older structured exchange audit can reconcile without writing back guessed data',async()=>{
 const old=await variant({stock:0}),fresh=await variant({stock:0,price:800});await buy(old,1,400);await buy(fresh,1,500);
 const original=await sold(old,1),ex=await swap(original,old,fresh,{payment:100});await retime(7,[original,ex.replacementSale],[ex]);
 await database.$executeRawUnsafe('DELETE FROM ExchangeRevenue WHERE exchangeId=?',ex.id);
 assert.equal((await report(7)).grossProfitPaise,30000);
 assert.equal((await database.$queryRawUnsafe('SELECT * FROM ExchangeRevenue WHERE exchangeId=?',ex.id)).length,0);
 const logs=await database.auditLog.findMany({where:{action:'EXCHANGE'}});const log=logs.find(row=>JSON.parse(row.details).replacementSaleId===ex.replacementSale.id);await database.auditLog.delete({where:{id:log.id}});
 const unknown=await report(7);assert.equal(unknown.netSalesPaise,null);assert.equal(unknown.unresolvedExchangeBills,2);
});

test('inconsistent saved exchange payment blocks profit instead of inventing revenue',async()=>{
 const old=await variant({stock:0}),fresh=await variant({stock:0,price:800});await buy(old,1,400);await buy(fresh,1,500);
 const original=await sold(old,1),ex=await swap(original,old,fresh,{payment:100});await retime(8,[original,ex.replacementSale],[ex]);
 await database.invoicePayment.updateMany({where:{saleId:ex.replacementSale.id,paymentMode:'EXCHANGE_CREDIT'},data:{amount:699}});
 const unknown=await report(8);assert.equal(unknown.netSalesPaise,null);assert.equal(unknown.grossProfitPaise,null);assert.equal(unknown.unresolvedExchangeBills,2);
});

test('failure after saved exchange values rolls back its stock, credit link and replacement bill',async()=>{
 const old=await variant({stock:0}),fresh=await variant({stock:0,price:800});await buy(old,1,400);await buy(fresh,1,500);const original=await sold(old,1);
 const before=await database.$queryRawUnsafe('SELECT COUNT(*) AS n FROM ExchangeRevenue');const bills=await database.sale.count();
 await database.$executeRawUnsafe("CREATE TRIGGER fail_exchange_audit BEFORE INSERT ON AuditLog WHEN NEW.action='EXCHANGE' BEGIN SELECT RAISE(ABORT,'Forced final audit failure'); END");
 try{const result=await exchange(null,{originalInvoiceId:original.id,userId:actor.id,discount:0,items:[{returnedId:old.id,returnedQty:1,newId:fresh.id,newQty:1,priceDiff:100}],payments:[{paymentMode:'CASH',amount:100}],replacementPaymentMethod:'CASH'},actor);assert.equal(result.success,false);}finally{await database.$executeRawUnsafe('DROP TRIGGER fail_exchange_audit');}
 assert.equal(await stock(old.id),0);assert.equal(await stock(fresh.id),1);assert.equal(await database.sale.count(),bills);assert.equal(Number((await database.$queryRawUnsafe('SELECT COUNT(*) AS n FROM ExchangeRevenue'))[0].n),Number(before[0].n));assert.equal((await cost(original.id)).knownCostPaise,40000);
});

test('repeated exchanges count only the final retained goods and fresh payments',async()=>{
 const a=await variant({stock:0}),b=await variant({stock:0,price:800}),c=await variant({stock:0,price:900});await buy(a,1,400);await buy(b,1,500);await buy(c,1,600);
 const original=await sold(a,1),first=await swap(original,a,b,{payment:100}),second=await swap(first.replacementSale,b,c,{payment:100});
 await retime(9,[original,first.replacementSale,second.replacementSale],[first,second]);
 const totals=await report(9);assert.equal(totals.billedPaise,240000);assert.equal(totals.exchangeReversalPaise,150000);assert.equal(totals.netSalesPaise,90000);assert.equal(totals.knownCostPaise,60000);assert.equal(totals.grossProfitPaise,30000);assert.equal(totals.unresolvedExchangeBills,0);
});

test('a fresh discount on replacement reduces its revenue exactly once',async()=>{
 const a=await variant({stock:0}),b=await variant({stock:0,price:800});await buy(a,1,400);await buy(b,1,500);
 const original=await sold(a,1),ex=await swap(original,a,b,{discount:50,payment:50});await retime(10,[original,ex.replacementSale],[ex]);
 const totals=await report(10);assert.equal(totals.netSalesPaise,75000);assert.equal(totals.grossProfitPaise,25000);assert.equal(totals.discountPaise,5000);
});

test('held exchange returns retain their known loss in gross profit',async()=>{
 const a=await variant({stock:0}),b=await variant({stock:0,price:800});await buy(a,1,400);await buy(b,1,500);const original=await sold(a,1);
 const result=await exchange(null,{originalInvoiceId:original.id,userId:actor.id,discount:0,items:[{returnedId:a.id,returnedQty:1,newId:b.id,newQty:1,priceDiff:100,stockChoice:{disposition:'HOLD',confirmed:true,reason:'Damaged'}}],payments:[{paymentMode:'CASH',amount:100}],replacementPaymentMethod:'CASH'},actor);
 assert.equal(result.success,true,result.error);const ex={...result.data,id:result.data.exchange.id};await retime(11,[original,ex.replacementSale],[ex]);
 const totals=await report(11);assert.equal(totals.netSalesPaise,80000);assert.equal(totals.knownCostPaise,50000);assert.equal(totals.heldCostPaise,40000);assert.equal(totals.grossProfitPaise,-10000);assert.equal(await stock(a.id),0);
});

test('saved links still flag a replacement whose visible exchange markers were removed',async()=>{
 const a=await variant({stock:0}),b=await variant({stock:0,price:800});await buy(a,1,400);await buy(b,1,500);const original=await sold(a,1),ex=await swap(original,a,b,{payment:100});await retime(12,[original]);await retime(13,[ex.replacementSale],[ex]);
 await database.sale.update({where:{id:ex.replacementSale.id},data:{remarks:null,paymentMethod:'CASH'}});await database.invoicePayment.updateMany({where:{saleId:ex.replacementSale.id},data:{paymentMode:'CASH'}});
 const totals=await report(13);assert.equal(totals.netSalesPaise,null);assert.equal(totals.unresolvedExchangeBills,1);
});

