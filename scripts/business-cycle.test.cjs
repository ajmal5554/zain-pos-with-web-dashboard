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

test('complete business cycle reconciles purchase, discounted sale, expense, partial return and profit',async()=>{
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const now=new Date().toISOString();
 await database.$executeRawUnsafe('CREATE TABLE CashRegister (id TEXT PRIMARY KEY,date TEXT,status TEXT,openedAt TEXT,closedAt TEXT,openingFloat REAL,closingActual REAL)');
 await database.$executeRawUnsafe('CREATE TABLE CashDrawerTx (id TEXT PRIMARY KEY,registerId TEXT,type TEXT,category TEXT,amount REAL,note TEXT,createdAt TEXT)');
 await database.$executeRawUnsafe('INSERT INTO CashRegister VALUES (?, ?, ?, ?, NULL, 5000, NULL)','cycle',date,'OPEN',now);
 const main=fs.readFileSync(path.join(root,'electron/main.ts'),'utf8');let register;
 const context={prisma:database,Date,console,require,ipcMain:{handle:(channel,handler)=>{if(channel==='register:get-current')register=handler;}}};
 const source=main.slice(main.indexOf('function getLocalDateString()'),main.indexOf('// register:add-tx'));
 vm.runInNewContext(compile(source),context);
 const current=async()=>{const result=await register(null);assert.equal(result.success,true,result.error);return result.data;};
 const item=await variant({stock:0});
 const receipt=await buy(item,10,400,{invoiceDate:date,paid:1000,paymentMode:'CASH_DRAWER'});
 const purchases=load('electron/purchases.service'),expenses=load('electron/expenses.service'),profit=load('electron/profit.service');
 assert.equal(await stock(item.id),10);
 let invoice=await purchases.purchaseDetail(database,{id:receipt.id},actor);
 assert.equal(invoice.totalPaise,400000);assert.equal(invoice.paidPaise,100000);assert.equal(invoice.duePaise,300000);
 const request=payload([{variant:item,quantity:2}]);
 request.discount=100;request.grandTotal=1300;request.paidAmount=1300;request.payments[0].amount=1300;
 const result=await checkout(null,request);assert.equal(result.success,true,result.error);const sale=result.data;
 assert.equal(await stock(item.id),8);assert.equal((await cost(sale.id)).knownCostPaise,80000);
 const expense={operationId:randomUUID(),date,category:'ELECTRICITY',amount:100,note:'Cycle test electricity',paymentSource:'CASH_DRAWER'};
 await expenses.createExpense(database,expense,actor);await expenses.createExpense(database,expense,actor);
 let report=await profit.getProfitReport(database,{from:date,to:date},actor);
 assert.equal(report.netSalesPaise,130000);assert.equal(report.grossProfitPaise,50000);assert.equal(report.expensePaise,10000);assert.equal(report.operatingProfitPaise,40000);
 assert.equal((await current()).expectedCashInDrawer,5200);
 const refundRequest={requestId:randomUUID(),originalInvoiceId:sale.id,userId:actor.id,reason:'Return one shirt',originalDiscount:50,totalAmount:650,items:[{id:item.id,qty:1,amount:650}],payments:[{paymentMode:'CASH',amount:650}]};
 const returned=await refund(null,refundRequest,actor);assert.equal(returned.success,true,returned.error);
 const retry=await refund(null,refundRequest,actor);assert.equal(retry.success,true,retry.error);assert.equal(retry.data.id,returned.data.id);
 assert.equal(await stock(item.id),9);assert.equal((await cost(sale.id)).knownCostPaise,40000);
 report=await profit.getProfitReport(database,{from:date,to:date},actor);
 assert.equal(report.billedPaise,130000);assert.equal(report.discountPaise,10000);assert.equal(report.refundPaise,65000);
 assert.equal(report.netSalesPaise,65000);assert.equal(report.knownCostPaise,40000);assert.equal(report.grossProfitPaise,25000);assert.equal(report.operatingProfitPaise,15000);assert.equal(report.missingBills,0);assert.equal(report.reviewCount,0);
 const drawer=await current();assert.equal(drawer.grossCashSales,1300);assert.equal(drawer.cashRefunds,650);assert.equal(drawer.cashSales,650);assert.equal(drawer.cashOut,1100);assert.equal(drawer.expectedCashInDrawer,4550);
 invoice=await purchases.purchaseDetail(database,{id:receipt.id},actor);assert.equal(invoice.duePaise,300000);
 const payment={operationId:randomUUID(),purchaseId:receipt.id,amount:1000,mode:'CASH_DRAWER'};
 await purchases.payPurchase(database,payment,actor);await purchases.payPurchase(database,payment,actor);
 assert.equal((await purchases.purchaseDetail(database,{id:receipt.id},actor)).duePaise,200000);
 assert.equal((await current()).expectedCashInDrawer,3550);
 assert.equal((await profit.getProfitReport(database,{from:date,to:date},actor)).operatingProfitPaise,15000);
 const lots=await database.$queryRawUnsafe('SELECT SUM(remainingQuantity) AS quantity,SUM(remainingCostPaise) AS cost FROM StockCostLot WHERE variantId=?',item.id);
 assert.equal(Number(lots[0].quantity),9);assert.equal(Number(lots[0].cost),360000);
});
