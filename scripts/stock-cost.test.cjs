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
test('FIFO captures costs across receipts; later receipts and price-only bill edits never reprice old sales',async()=>{
    const item=await variant({stock:0});
    await buy(item,2,450);await buy(item,2,480);
    const sale=await sold(item,3);
    let summary=await cost(sale.id);assert.equal(summary.status,'CAPTURED');assert.equal(summary.knownCostPaise,138000);assert.equal(summary.unknownQuantity,0);
    await buy(item,2,600);assert.equal((await cost(sale.id)).knownCostPaise,138000);
    const increased=await update(null,{saleId:sale.id,userId:actor.id,saleData:payload([{variant:item,quantity:4}])});assert.equal(increased.success,true,increased.error);
    assert.equal((await cost(sale.id)).knownCostPaise,186000);
    const reduced=await update(null,{saleId:sale.id,userId:actor.id,saleData:payload([{variant:item,quantity:3}])});assert.equal(reduced.success,true,reduced.error);
    assert.equal((await cost(sale.id)).knownCostPaise,138000);
    const repriced=payload([{variant:item,quantity:3}]);repriced.discount=50;repriced.grandTotal-=50;repriced.paidAmount-=50;repriced.payments[0].amount-=50;
    const edited=await update(null,{saleId:sale.id,userId:actor.id,saleData:repriced});assert.equal(edited.success,true,edited.error);
    assert.equal((await cost(sale.id)).knownCostPaise,138000);
});
test('customer refund restores the exact original sale cost and retry cannot restore stock twice',async()=>{
    const item=await variant({stock:0});await buy(item,1,450);await buy(item,1,480);
    const sale=await sold(item,2);
    const {request,result}=await returned(sale,item,1);
    assert.equal((await cost(sale.id)).knownCostPaise,48000);assert.equal(await stock(item.id),1);
    const retry=await refund(null,request,actor);assert.equal(retry.success,true,retry.error);assert.equal(retry.data.id,result.data.id);assert.equal(await stock(item.id),1);
    const resale=await sold(item,1);assert.equal((await cost(resale.id)).knownCostPaise,45000);
});
test('same-code exchange reuses restored lot cost and separately captures the replacement sale',async()=>{
    const item=await variant({stock:0});await buy(item,1,450);const sale=await sold(item,1);
    const result=await exchange(null,{originalInvoiceId:sale.id,userId:actor.id,discount:0,items:[{returnedId:item.id,returnedQty:1,newId:item.id,newQty:1,priceDiff:0}],payments:[],replacementPaymentMethod:'CASH'},actor);
    assert.equal(result.success,true,result.error);assert.equal(await stock(item.id),0);
    assert.equal((await cost(sale.id)).knownCostPaise,0);assert.equal((await cost(result.data.replacementSale.id)).knownCostPaise,45000);
});
test('held returns reverse sold cost but never enter a saleable lot; their cost remains visible separately',async()=>{
    const item=await variant({stock:0});await buy(item,1,450);const sale=await sold(item,1);
    await returned(sale,item,1,{disposition:'HOLD',confirmed:true,reason:'Damaged beyond resale'});
    const summary=await cost(sale.id);assert.equal(summary.knownCostPaise,0);assert.equal(summary.heldCostPaise,45000);assert.equal(await stock(item.id),0);
    const lots=await database.$queryRawUnsafe('SELECT SUM(remainingQuantity) AS q FROM StockCostLot WHERE variantId=?',item.id);assert.equal(Number(lots[0].q),0);
});
test('void restores captured costs once and preserves the original allocation history',async()=>{
    const item=await variant({stock:0});await buy(item,2,480);const sale=await sold(item,2);
    const result=await voidSale(null,{saleId:sale.id,reason:'Test void',userId:actor.id},actor);assert.equal(result.success,true,result.error);
    assert.equal(await stock(item.id),2);assert.equal((await cost(sale.id)).knownCostPaise,0);
    const again=await voidSale(null,{saleId:sale.id,reason:'Retry',userId:actor.id},actor);assert.equal(again.success,false);assert.equal(await stock(item.id),2);
    assert.equal((await cost((await sold(item,2)).id)).knownCostPaise,96000);
});
test('opening stock and legacy negative stock are explicitly unknown, never catalogue-cost zero profit',async()=>{
    const item=await variant({stock:2});await buy(item,2,450);const sale=await sold(item,3);
    const summary=await cost(sale.id);assert.equal(summary.status,'UNKNOWN_COST');assert.equal(summary.unknownQuantity,2);assert.equal(summary.knownCostPaise,45000);
    await buy(item,1,900);assert.equal((await cost(sale.id)).unknownQuantity,2);
    const legacy=await variant({stock:0,tracked:false});const old=await sold(legacy,2);
    assert.equal(await stock(legacy.id),-2);assert.equal((await cost(old.id)).unknownQuantity,2);
});
test('paise conservation holds across partial sales, fractional unit costs and partial refunds',async()=>{
    const item=await variant({stock:0,price:1});await buy(item,3,1,{discount:1.99});
    const first=await sold(item,2),last=await sold(item,1);
    assert.equal((await cost(first.id)).knownCostPaise+(await cost(last.id)).knownCostPaise,101);
    await returned(first,item,1);const resale=await sold(item,1);
    assert.equal((await cost(first.id)).knownCostPaise+(await cost(last.id)).knownCostPaise+(await cost(resale.id)).knownCostPaise,101);
    assert.equal((await cost(resale.id)).knownCostPaise,34);
});
test('supplier corrections cannot rewrite consumed lots and supplier returns cannot use another delivery',async()=>{
    const item=await variant({stock:0});const receipt=await buy(item,2,450);await buy(item,5,480);const sale=await sold(item,1);
    const invoice=await load('electron/purchases.service').purchaseDetail(database,{id:receipt.id},actor),line=invoice.lines[0];
    const adjust=load('electron/purchase-adjustments.service');
    await assert.rejects(adjust.adjustPurchase(database,{operationId:randomUUID(),purchaseId:receipt.id,expectedRevision:0,kind:'CORRECTION',reason:'Change cost',supplier:invoice.supplier,invoiceNumber:invoice.invoiceNumber,invoiceDate:invoice.invoiceDate,batchName:invoice.batchName,discount:0,charges:0,lines:[{lineId:line.id,quantity:2,unitCost:500}]},actor),/already been sold/);
    await assert.rejects(adjust.adjustPurchase(database,{operationId:randomUUID(),purchaseId:receipt.id,expectedRevision:0,kind:'RETURN',reason:'Return older batch',credit:900,lines:[{lineId:line.id,quantity:2}]},actor),/Not enough unsold/);
    await adjust.adjustPurchase(database,{operationId:randomUUID(),purchaseId:receipt.id,expectedRevision:0,kind:'RETURN',reason:'Return remaining old batch',credit:450,lines:[{lineId:line.id,quantity:1}]},actor);
    assert.equal((await cost(sale.id)).knownCostPaise,45000);assert.equal(await stock(item.id),5);
    assert.equal((await cost((await sold(item,1)).id)).knownCostPaise,48000);
});
test('manual count additions remain unknown while reductions reconcile without repricing sold units',async()=>{
    const item=await variant({stock:0});await buy(item,3,450);const sale=await sold(item,1);
    await database.productVariant.update({where:{id:item.id},data:{stock:4}}); // Two unattributed pieces found during recount.
    const extra=await sold(item,3);assert.equal((await cost(extra.id)).knownCostPaise,90000);assert.equal((await cost(extra.id)).unknownQuantity,1);
    assert.equal((await cost(sale.id)).knownCostPaise,45000);
    await database.productVariant.update({where:{id:item.id},data:{stock:0}});
    await database.$transaction(tx=>costing.prepareStockCosts(tx,[item.id]));
    const lots=await database.$queryRawUnsafe('SELECT SUM(remainingQuantity) AS q FROM StockCostLot WHERE variantId=?',item.id);assert.equal(Number(lots[0].q),0);
});
test('cost writes roll back with a failed sale and reads reject missing cost permission',async()=>{
    const item=await variant({stock:0});await buy(item,2,450);
    const before=await database.$queryRawUnsafe('SELECT * FROM StockCostLot WHERE variantId=?',item.id);
    await assert.rejects(database.$transaction(async tx=>{const sale=await tx.sale.create({data:{billNo:randomUUID(),userId:actor.id,subtotal:700,grandTotal:700,taxAmount:0,cgst:0,sgst:0,paidAmount:700,changeAmount:0}});await costing.syncSaleCosts(tx,sale.id,new Map([[item.id,1]]));throw new Error('Forced later sale failure');}),/Forced/);
    assert.deepEqual(await database.$queryRawUnsafe('SELECT * FROM StockCostLot WHERE variantId=?',item.id),before);
    const sale=await sold(item,1);
    await assert.rejects(costing.getSaleCosts(database,{saleId:sale.id},{...actor,role:'CASHIER',permViewSales:true,permViewCostPrice:false}),/permissions/);
    const prior=await seedSale(item,1);assert.equal((await cost(prior.id)).status,'NOT_CAPTURED');
});

