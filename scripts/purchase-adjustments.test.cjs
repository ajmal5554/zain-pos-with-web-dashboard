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

test('purchase corrections, supplier returns, cancellation and actual refunds preserve an audit trail',async t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zain-purchase-adjust-'));
    const {PrismaClient}=require(path.join(root,'prisma/generated/client'));
    const db=new PrismaClient({datasources:{db:{url:'file:'+path.join(directory,'test.db').replaceAll('\\','/')}}});
    try{
        const sql=execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/generated/client/schema.prisma'),'--script'],{encoding:'utf8',cwd:root});
        for(const statement of sql.split(';').map(v=>v.trim()).filter(Boolean))await db.$executeRawUnsafe(statement);
        const user=await db.user.create({data:{username:'adjust-owner',name:'Owner',password:'test-only',role:'ADMIN',isActive:true}});
        const core=load('electron/purchases.service'),adjust=load('electron/purchase-adjustments.service'),conversion=load('electron/stock-conversion.service');
        const zero=await conversion.saveStockEntry(db,{operationId:randomUUID(),batchName:'Codes only',rows:[{name:'Shirt XL',category:'Shirts',brand:'CH',size:'XL',mrp:700,quantity:0,attributes:{fabric:'Cotton'}}]},user);
        const variantId=zero.items[0].variantId;
        const input={operationId:randomUUID(),supplier:'Supplier A',invoiceNumber:'A-1',invoiceDate:'2026-10-01',batchName:'Delivery',discount:0,charges:0,paid:4000,paymentMode:'UPI',lines:[{variantId,quantity:10,unitCost:450,sellingPrice:700,mrp:700,expectedSellingPrice:700,expectedMrp:700}]};
        const received=await core.receivePurchase(db,input,user);
        let state=await core.purchaseDetail(db,{id:received.id},user);
        const lineId=state.lines[0].id;
        const correction={operationId:randomUUID(),purchaseId:received.id,expectedRevision:0,kind:'CORRECTION',reason:'Invoice quantity and cost were entered incorrectly',supplier:'Supplier A',invoiceNumber:'A-1',invoiceDate:'2026-10-01',batchName:'Corrected delivery',discount:0,charges:0,lines:[{lineId,quantity:8,unitCost:500}]};
        await t.test('correct quantity and cost without overwriting the original invoice',async()=>{
            await adjust.adjustPurchase(db,correction,user);await adjust.adjustPurchase(db,correction,user);
            state=await core.purchaseDetail(db,{id:received.id},user);
            assert.equal(state.totalPaise,400000);assert.equal(state.duePaise,0);assert.equal(state.lines[0].stock,8);
            assert.equal(state.lines[0].quantity,8);assert.equal(state.lines[0].unitCostPaise,50000);
            assert.equal(state.original.totalPaise,450000);assert.equal(state.original.lines[0].quantity,10);assert.equal(state.original.lines[0].unitCostPaise,45000);
            assert.equal(state.adjustments.length,1);assert.equal(state.revision,1);
        });
        const returned={operationId:randomUUID(),purchaseId:received.id,expectedRevision:1,kind:'RETURN',reason:'Supplier accepted two damaged shirts · CN-1',credit:1000,lines:[{lineId,quantity:2}]};
        await t.test('return goods, reduce supplier debt and create a refund due without inventing cash',async()=>{
            await adjust.adjustPurchase(db,returned,user);await adjust.adjustPurchase(db,returned,user);
            state=await core.purchaseDetail(db,{id:received.id},user);
            assert.equal(state.lines[0].stock,6);assert.equal(state.lines[0].returnedQuantity,2);assert.equal(state.totalPaise,300000);
            assert.equal(state.paidPaise,400000);assert.equal(state.creditDuePaise,100000);assert.equal(state.duePaise,0);assert.equal(state.payments.length,1);
            await assert.rejects(adjust.adjustPurchase(db,{...correction,operationId:randomUUID(),expectedRevision:2},user),/already has supplier returns/);
            await assert.rejects(adjust.adjustPurchase(db,{...returned,operationId:randomUUID()},user),/invoice changed/);
            await assert.rejects(adjust.adjustPurchase(db,{...returned,operationId:randomUUID(),expectedRevision:2,lines:[{lineId,quantity:7}]},user),/exceeds/);
            await assert.rejects(adjust.adjustPurchase(db,{...returned,operationId:randomUUID(),expectedRevision:2,credit:4000},user),/credit cannot exceed/);
        });
        const refund={operationId:randomUUID(),purchaseId:received.id,amount:500,mode:'BANK',reason:'Bank refund reference 123'};
        await t.test('actual partial refund is separate and retry-safe',async()=>{
            await adjust.refundPurchase(db,refund,user);await adjust.refundPurchase(db,refund,user);
            state=await core.purchaseDetail(db,{id:received.id},user);
            assert.equal(state.paidPaise,350000);assert.equal(state.creditDuePaise,50000);assert.equal(state.payments.length,2);
            assert.equal(state.payments[1].amountPaise,-50000);assert.equal(state.payments[1].reason,refund.reason);
            await assert.rejects(adjust.refundPurchase(db,{...refund,operationId:randomUUID(),amount:501},user),/exceeds/);
        });
        const cancel={operationId:randomUUID(),purchaseId:received.id,expectedRevision:2,kind:'CANCEL',reason:'Cancelled remaining delivery by agreement'};
        await t.test('cancel remaining goods, preserve payments, release invoice number for a replacement',async()=>{
            await adjust.adjustPurchase(db,cancel,user);await adjust.adjustPurchase(db,cancel,user);
            state=await core.purchaseDetail(db,{id:received.id},user);
            assert.equal(state.status,'CANCELLED');assert.equal(state.totalPaise,0);assert.equal(state.lines[0].stock,0);assert.equal(state.creditDuePaise,350000);
            assert.equal(state.lines[0].returnedQuantity,8);assert.equal(state.original.invoiceNumber,'A-1');
            await assert.rejects(core.payPurchase(db,{operationId:randomUUID(),purchaseId:received.id,amount:1,mode:'UPI'},user),/exceeds/);
            const replacement=await core.receivePurchase(db,{...input,operationId:randomUUID(),paid:0,lines:[{...input.lines[0],quantity:5}]},user);
            assert.notEqual(replacement.id,received.id);
            const report=await core.listPurchases(db,{search:'Supplier A'},user);
            assert.equal(report.total,2);assert.equal(report.totals.duePaise,225000);assert.equal(report.totals.creditDuePaise,350000);
            assert.equal(report.items.filter(r=>r.status==='CANCELLED').length,1);
        });
        await t.test('refund into the drawer creates one cash-in entry and checks the open register',async()=>{
            const cash={...refund,operationId:randomUUID(),amount:3500,mode:'CASH_DRAWER',reason:'Supplier cash refund received'};
            await assert.rejects(adjust.refundPurchase(db,cash,user),/Open today/);
            await db.$executeRawUnsafe('CREATE TABLE CashRegister (id TEXT PRIMARY KEY,date TEXT,status TEXT,openedAt TEXT)');
            await db.$executeRawUnsafe('CREATE TABLE CashDrawerTx (id TEXT PRIMARY KEY,registerId TEXT,type TEXT,category TEXT,amount REAL,note TEXT,createdAt TEXT)');
            await db.$executeRawUnsafe('INSERT INTO CashRegister VALUES (?, ?, ?, ?)',randomUUID(),core.today(),'OPEN',new Date().toISOString());
            await adjust.refundPurchase(db,cash,user);await adjust.refundPurchase(db,cash,user);
            const rows=await db.$queryRawUnsafe('SELECT * FROM CashDrawerTx');assert.equal(rows.length,1);assert.equal(rows[0].type,'CASH_IN');assert.equal(rows[0].amount,3500);
            state=await core.purchaseDetail(db,{id:received.id},user);assert.equal(state.paidPaise,0);assert.equal(state.creditDuePaise,0);
        });
        await t.test('not enough physical stock blocks return and rolls back the complete correction',async()=>{
            const secondCode=await conversion.saveStockEntry(db,{operationId:randomUUID(),batchName:'Other code',rows:[{name:'Other Shirt',category:'Shirts',brand:'Other',size:'L',mrp:700,quantity:0,attributes:{}}]},user);
            const second=await core.receivePurchase(db,{...input,operationId:randomUUID(),invoiceNumber:'B-2',paid:0,lines:[{...input.lines[0],quantity:5},{...input.lines[0],variantId:secondCode.items[0].variantId,quantity:5}]},user);
            const invoice=await core.purchaseDetail(db,{id:second.id},user);
            await db.productVariant.update({where:{id:secondCode.items[0].variantId},data:{stock:0}});
            const before=await db.productVariant.findUnique({where:{id:variantId}});
            const request={...correction,operationId:randomUUID(),purchaseId:second.id,invoiceNumber:'B-2',lines:invoice.lines.map((line,index)=>({lineId:line.id,quantity:index===0?8:0,unitCost:450}))};
            await assert.rejects(adjust.adjustPurchase(db,request,user),/Not enough stock|batch has already been sold or returned/);
            assert.equal((await db.productVariant.findUnique({where:{id:variantId}})).stock,before.stock);
            assert.equal((await core.purchaseDetail(db,{id:second.id},user)).revision,0);
        });
        await t.test('permissions, missing reasons and supplier changes with recorded payments are rejected',async()=>{
            await assert.rejects(adjust.adjustPurchase(db,{...cancel,operationId:randomUUID()},{...user,isActive:false}),/permissions/);
            await assert.rejects(adjust.refundPurchase(db,{...refund,operationId:randomUUID(),reason:''},user),/Reason|reason/);
            await assert.rejects(adjust.adjustPurchase(db,{...returned,operationId:randomUUID(),reason:''},user),/Reason/);
            const invoice=await core.receivePurchase(db,{...input,operationId:randomUUID(),invoiceNumber:'P-3'},user);
            const current=await core.purchaseDetail(db,{id:invoice.id},user);
            await assert.rejects(adjust.adjustPurchase(db,{...correction,operationId:randomUUID(),purchaseId:invoice.id,invoiceNumber:'P-3',supplier:'Wrong supplier',lines:[{lineId:current.lines[0].id,quantity:10,unitCost:450}]},user),/cannot be reassigned/);
        });
    }finally{
        await db.$disconnect();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(directory).startsWith('zain-purchase-adjust-'));fs.rmSync(directory,{recursive:true,force:true});
    }
});

