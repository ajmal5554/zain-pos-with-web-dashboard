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
        require: name => name === './logger' ? {logger: Object.fromEntries(['info','warn','error','debug'].map(k => [k,()=>{}]))} : name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))) : require(name) });
    return exports;
}

// Exercise the actual renderer service -> preload API -> secured main handlers -> SQLite.
// Only Electron's transport is replaced; business and permission code runs unchanged.
test('purchase application flow in an isolated database', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-purchase-flow-'));
    const {PrismaClient} = require(path.join(root, 'prisma/generated/client'));
    const url = 'file:' + path.join(directory, 'flow.db').replaceAll('\\', '/');
    const db = new PrismaClient({datasources:{db:{url}}});
    const auth = load('electron/session-auth.service');
    const event = {sender:{id:cryptoId(),isDestroyed:()=>false}};
    try {
        const sql = execFileSync(process.execPath, [path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/generated/client/schema.prisma'),'--script'], {encoding:'utf8',cwd:root});
        for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
        const owner = await db.user.create({data:{username:'flow-owner',password:'test-only',name:'Test owner',role:'ADMIN',isActive:true}});
        const conversion=load('electron/stock-conversion.service'), backend=load('electron/purchases.service');
        const seed = await conversion.saveStockEntry(db,{operationId:randomUUID(),batchName:'Opening audit',rows:[{name:'Crazy Heart Plain XL',category:'Shirts',brand:'Crazy Heart',size:'XL',mrp:700,quantity:15,attributes:{fabric:'Cotton',pattern:'Plain',custom_finish:'Soft'}}]},owner);
        const handlers=new Map(), context={prisma:db,ipcMain:{handle:(channel,handler)=>handlers.set(channel,handler)},resolveElectronSessionUser:auth.resolveElectronSessionUser,
            PermissionMiddleware:load('electron/permission.service').PermissionMiddleware,
            logger:Object.fromEntries(['warn','error'].map(k=>[k,()=>{}])),validateIpcRequest:()=>{throw new Error('Untrusted user-ID path used');},
            ...backend,...load('electron/purchase-adjustments.service'),Error,Date,Promise};
        const main=fs.readFileSync(path.join(root,'electron/main.ts'),'utf8');
        const helper=main.slice(main.indexOf('function createSecureIpcHandler<'),main.indexOf('// --- Input Validation Helpers ---'));
        const lock=main.slice(main.indexOf('let registerLock:'),main.indexOf('// Check permission for cash drawer operations'));
        const routes=main.slice(main.indexOf('// --- Purchase Handlers:'),main.indexOf('// --- End Purchase Handlers ---'));
        vm.runInNewContext(ts.transpileModule(helper+lock+routes,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
        let bridge;
        const preload={exports:{}};
        let loseNextReply=false,loseReplyChannel='purchases:receive';
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'electron/preload.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
            module:preload,exports:preload.exports,
            require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(key,value)=>{assert.equal(key,'electronAPI');bridge=value;}},ipcRenderer:{invoke:async(channel,input)=>{
                const result=await handlers.get(channel)(event,structuredClone(input));
                if(loseNextReply && channel===loseReplyChannel){loseNextReply=false;throw new Error('Simulated lost IPC reply after database commit');}
                return structuredClone(result);
            }}};},
        });
        const renderer={exports:{}};
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/services/purchases.service.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:renderer,exports:renderer.exports,window:{electronAPI:bridge}});
        const service=renderer.exports.purchasesService;
        await t.test('anonymous and forged operator IDs cannot open purchases',async()=>{
            await assert.rejects(service.list({page:1,search:''}),/Authentication/);
            const response=await bridge.purchases.list({page:1,search:'',userId:owner.id});assert.equal(response.success,false);
        });
        auth.electronSessions.bind(event.sender.id,owner.id);
        const found=await service.items(seed.items[0].barcode);assert.equal(found.length,1);
        const original=found[0];
        const invoice=(number,cost=450,price=700)=>({operationId:randomUUID(),supplier:'Flow supplier',invoiceNumber:number,invoiceDate:'2026-10-01',batchName:number,discount:0,charges:0,paid:0,paymentMode:'UPI',lines:[{variantId:original.id,quantity:5,unitCost:cost,sellingPrice:price,mrp:price,expectedSellingPrice:original.sellingPrice,expectedMrp:original.mrp}]});
        let first,second,third;
        await t.test('five shirts at cost 450 and selling price 700 add exactly five pieces',async()=>{
            first=await service.receive(invoice('FLOW-1'));
            assert.equal(first.barcodes[0],original.barcode);
            assert.equal((await service.items(original.barcode))[0].stock,20);
            const detail=await service.detail(first.id);assert.equal(detail.lines[0].unitCostPaise,45000);assert.equal(detail.totalPaise,225000);
        });
        await t.test('cost changes to 480 keep the barcode and both purchase cost histories',async()=>{
            second=await service.receive(invoice('FLOW-2',480));
            assert.equal(second.barcodes[0],original.barcode);
            assert.equal((await service.items(original.barcode))[0].stock,25);
            assert.equal((await service.detail(first.id)).lines[0].unitCostPaise,45000);
            assert.equal((await service.detail(second.id)).lines[0].unitCostPaise,48000);
            assert.equal((await db.productVariant.findUnique({where:{id:original.id}})).costPrice,0,'unknown opening cost is not replaced');
        });
        await t.test('selling price 750 creates a new barcode while old stock remains 700',async()=>{
            third=await service.receive(invoice('FLOW-3',480,750));
            assert.notEqual(third.barcodes[0],original.barcode);
            const old=(await service.items(original.barcode))[0], fresh=(await service.items(third.barcodes[0]))[0];
            assert.equal(old.stock,25);assert.equal(old.sellingPrice,700);assert.equal(fresh.stock,5);assert.equal(fresh.sellingPrice,750);
            const inventory=await load('electron/inventory-workspace.service').getInventoryWorkspace(db,{scope:'TRACKED',groupBy:'SIZE'});
            assert.equal(inventory.success,true);assert.equal(inventory.data.stats.quantity,30);
            assert.equal((await service.detail(third.id)).lines[0].barcode,third.barcodes[0]);
        });
        await t.test('partial supplier payment and retry reduce debt only once',async()=>{
            const payment={operationId:randomUUID(),purchaseId:first.id,amount:1000,mode:'UPI'};
            await service.pay(payment);await service.pay(payment);
            const detail=await service.detail(first.id);assert.equal(detail.paidPaise,100000);assert.equal(detail.duePaise,125000);assert.equal(detail.payments.length,1);
            await assert.rejects(service.pay({...payment,operationId:randomUUID(),amount:1300}),/exceeds/);
            const report=await service.list({page:1,search:'Flow supplier'});assert.equal(report.total,3);assert.equal(report.totals.totalPaise,705000);assert.equal(report.totals.paidPaise,100000);assert.equal(report.totals.duePaise,605000);
        });
        await t.test('lost save reply retries the committed receipt without another stock increment',async()=>{
            const input=invoice('FLOW-4',480);loseNextReply=true;
            await assert.rejects(service.receive(input),e=>e.confirmedRejected===false);
            const before=(await service.items(original.barcode))[0].stock;
            const recovered=await service.receive(input);
            assert.ok(recovered.id);assert.equal((await service.items(original.barcode))[0].stock,before);assert.equal(before,30);
            assert.equal((await service.list({page:1,search:'FLOW-4'})).total,1);
        });
        await t.test('a duplicate supplier invoice with a fresh operation ID is rejected',async()=>{
            await assert.rejects(service.receive(invoice('FLOW-1')),/already recorded/);
            assert.equal((await service.items(original.barcode))[0].stock,30);
        });
        await t.test('invoices, batches and payment balances survive a database reconnect',async()=>{
            await db.$disconnect();
            const reopened=new PrismaClient({datasources:{db:{url}}});
            try {
                const detail=await backend.purchaseDetail(reopened,{id:first.id},owner);assert.equal(detail.duePaise,125000);assert.equal(detail.lines[0].unitCostPaise,45000);
                assert.equal((await backend.listPurchases(reopened,{search:'Flow supplier'},owner)).total,4);
            } finally {await reopened.$disconnect();}
        });
        await t.test('corrections, returns, cancellation and refunds cross the actual secured purchase bridge',async()=>{
            let detail=await service.detail(third.id);
            const correction={operationId:randomUUID(),purchaseId:third.id,expectedRevision:detail.revision,kind:'CORRECTION',reason:'Correct entered quantity',supplier:detail.supplier,invoiceNumber:detail.invoiceNumber,invoiceDate:detail.invoiceDate,batchName:detail.batchName,discount:0,charges:0,lines:[{lineId:detail.lines[0].id,quantity:4,unitCost:480}]};
            loseNextReply=true;loseReplyChannel='purchases:adjust';
            await assert.rejects(service.adjust(correction),e=>e.confirmedRejected===false);
            await service.adjust(correction);
            detail=await service.detail(third.id);assert.equal(detail.lines[0].stock,4);assert.equal(detail.totalPaise,192000);assert.equal(detail.adjustments.length,1);
            await service.adjust({operationId:randomUUID(),purchaseId:third.id,expectedRevision:1,kind:'RETURN',reason:'Supplier credit CN-7',credit:480,lines:[{lineId:detail.lines[0].id,quantity:1}]});
            detail=await service.detail(third.id);assert.equal(detail.lines[0].stock,3);assert.equal(detail.duePaise,144000);
            await service.pay({operationId:randomUUID(),purchaseId:third.id,amount:1440,mode:'UPI'});
            await service.adjust({operationId:randomUUID(),purchaseId:third.id,expectedRevision:2,kind:'CANCEL',reason:'Cancel remaining delivery'});
            detail=await service.detail(third.id);assert.equal(detail.status,'CANCELLED');assert.equal(detail.creditDuePaise,144000);assert.equal(detail.lines[0].stock,0);
            const refund={operationId:randomUUID(),purchaseId:third.id,amount:1440,mode:'UPI',reason:'Refund received reference R-7'};
            loseNextReply=true;loseReplyChannel='purchases:refund';
            await assert.rejects(service.refund(refund),e=>e.confirmedRejected===false);await service.refund(refund);
            detail=await service.detail(third.id);assert.equal(detail.creditDuePaise,0);assert.equal(detail.payments.length,2);
            assert.equal(detail.original.totalPaise,240000);
        });
        await t.test('revoked inventory and cost access is checked again on the next request',async()=>{
            await db.user.update({where:{id:owner.id},data:{role:'CASHIER',permManageInventory:false,permViewCostPrice:false}});
            await assert.rejects(service.list({page:1,search:''}),/permission/i);
        });
    } finally {
        auth.clearElectronSession(event.sender.id);await db.$disconnect();
        assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
        assert.ok(path.basename(directory).startsWith('zain-purchase-flow-'));
        fs.rmSync(directory,{recursive:true,force:true});
    }
});
function cryptoId(){return Math.floor(Math.random()*1e9);}

