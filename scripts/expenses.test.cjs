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

test('expenses: drawer projection, classifications, corrections, cash conservation, export and permissions',async t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zain-expenses-'));
    const {PrismaClient}=require(path.join(root,'prisma/generated/client'));
    const url='file:'+path.join(directory,'test.db').replaceAll('\\','/');
    const db=new PrismaClient({datasources:{db:{url}}});
    try{
        const sql=execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/generated/client/schema.prisma'),'--script'],{encoding:'utf8',cwd:root});
        for(const statement of sql.split(';').map(v=>v.trim()).filter(Boolean))await db.$executeRawUnsafe(statement);
        const owner=await db.user.create({data:{username:'expense-owner',password:'test-only',name:'Owner',role:'ADMIN',isActive:true}});
        const service=load('electron/expenses.service');
        const now=new Date().toISOString(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        const previous=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
        const filter={from:previous,to:date,status:'ALL',paymentSource:'ALL',page:1};
        await db.$executeRawUnsafe('CREATE TABLE CashRegister (id TEXT PRIMARY KEY,date TEXT NOT NULL,status TEXT,openedAt TEXT,closingActual REAL)');
        await db.$executeRawUnsafe('CREATE TABLE CashDrawerTx (id TEXT PRIMARY KEY,registerId TEXT,type TEXT,category TEXT,amount REAL,note TEXT,createdAt TEXT)');
        await db.$executeRawUnsafe('CREATE TABLE PurchasePayment (id TEXT PRIMARY KEY,drawerTxId TEXT)');
        await db.$executeRawUnsafe('INSERT INTO CashRegister VALUES (?, ?, ?, ?, ?)', 'today',date,'OPEN',now,null);
        await db.$executeRawUnsafe('INSERT INTO CashRegister VALUES (?, ?, ?, ?, ?)', 'past',previous,'CLOSED',now,1234);
        async function cash(id,category,amount=100,type='CASH_OUT',register='today'){await db.$executeRawUnsafe('INSERT INTO CashDrawerTx VALUES (?, ?, ?, ?, ?, ?, ?)',id,register,type,category,amount,id,now);}
        await cash('tea','EXPENSE',100);await cash('freight','FREIGHT',200);await cash('fees','MUNICIPALITY',300);
        await cash('home','OWNER_WITHDRAWAL',10000);await cash('float','CHANGE_FLOAT',100);await cash('topup','TOP_UP',500,'CASH_IN');
        await cash('supplier-new','SUPPLIER_PAYMENT',1000);await cash('supplier-old','EXPENSE',400);await cash('customer-refund','REFUND',700);
        await db.$executeRawUnsafe('INSERT INTO PurchasePayment VALUES (?, ?)',randomUUID(),'supplier-old');
        const countCash=async()=>Number((await db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM CashDrawerTx'))[0].n);
        let tea,created;
        await t.test('existing drawer candidates appear once for review; withdrawals, float and supplier payments are excluded',async()=>{
            const result=await service.listExpenses(db,filter,owner);assert.equal(result.total,3);assert.equal(result.totals.expensePaise,0);assert.equal(result.totals.reviewPaise,60000);assert.equal(result.totals.reviewCount,3);
            assert.ok(result.items.every(row=>row.status==='REVIEW'&&row.id.startsWith('drawer:')));
            assert.equal(await countCash(),9);
        });
        await t.test('classifying an existing cash payment never creates another outflow',async()=>{
            const request={operationId:randomUUID(),id:'drawer:tea',expectedRevision:0,action:'CLASSIFY',category:'REFRESHMENTS',reason:'Tea paid for shop staff'};
            tea=await service.actOnExpense(db,request,owner);assert.equal((await service.actOnExpense(db,request,owner)).id,tea.id);
            const result=await service.listExpenses(db,filter,owner);assert.equal(result.total,3);assert.equal(result.totals.expensePaise,10000);assert.equal(result.totals.reviewPaise,50000);assert.equal(await countCash(),9);
            assert.equal((await service.expenseDetail(db,{id:tea.id},owner)).history.length,1);
        });
        await t.test('UPI, bank and personal-cash expenses leave drawer cash unchanged',async()=>{
            for(const paymentSource of ['UPI','BANK','PERSONAL_CASH'])await service.createExpense(db,{operationId:randomUUID(),date,category:'RENT',amount:600,note:`Rent ${paymentSource}`,paymentSource},owner);
            assert.equal(await countCash(),9);assert.equal((await service.listExpenses(db,filter,owner)).totals.expensePaise,190000);
        });
        await t.test('a new drawer expense and its retry generate exactly one linked payment',async()=>{
            const request={operationId:randomUUID(),date,category:'ELECTRICITY',amount:50,note:'Electricity bill',paymentSource:'CASH_DRAWER'};
            created=await service.createExpense(db,request,owner);await service.createExpense(db,request,owner);
            assert.equal(await countCash(),10);
            const detail=await service.expenseDetail(db,{id:created.id},owner);assert.equal(detail.amountPaise,5000);assert.equal(detail.status,'ACTIVE');
            const rows=await db.$queryRawUnsafe('SELECT * FROM CashDrawerTx WHERE id=?',detail.drawerTxId);assert.equal(rows[0].type,'CASH_OUT');assert.equal(rows[0].amount,50);assert.equal(rows[0].category,'BUSINESS_EXPENSE');
            assert.equal((await service.listExpenses(db,filter,owner)).total,7,'linked outflow does not appear as an extra review entry');
        });
        await t.test('exclusion and reclassification change expenses without altering cash or erasing history',async()=>{
            await service.actOnExpense(db,{operationId:randomUUID(),id:tea.id,expectedRevision:1,action:'EXCLUDE',reason:'Review correction'},owner);
            assert.equal((await service.expenseDetail(db,{id:tea.id},owner)).status,'EXCLUDED');assert.equal(await countCash(),10);
            await service.actOnExpense(db,{operationId:randomUUID(),id:tea.id,expectedRevision:2,action:'CLASSIFY',category:'REFRESHMENTS',reason:'Confirmed staff refreshment expense'},owner);
            assert.equal((await service.expenseDetail(db,{id:tea.id},owner)).history.length,3);assert.equal(await countCash(),10);
            await service.actOnExpense(db,{operationId:randomUUID(),id:'drawer:freight',expectedRevision:0,action:'EXCLUDE',reason:'Already included in stock purchase charges'},owner);
            assert.equal((await service.listExpenses(db,filter,owner)).totals.reviewPaise,30000);
            await assert.rejects(service.actOnExpense(db,{operationId:randomUUID(),id:tea.id,expectedRevision:1,action:'EXCLUDE',reason:'Stale screen'},owner),/changed/);
        });
        await t.test('voiding a mistaken open-drawer expense records one equal reversal',async()=>{
            const request={operationId:randomUUID(),id:created.id,expectedRevision:1,action:'VOID',reason:'Wrong amount entered; payment was not made'};
            await service.actOnExpense(db,request,owner);await service.actOnExpense(db,request,owner);
            assert.equal(await countCash(),11);const reversals=await db.$queryRawUnsafe("SELECT * FROM CashDrawerTx WHERE category='EXPENSE_REVERSAL'");assert.equal(reversals.length,1);assert.equal(reversals[0].type,'CASH_IN');assert.equal(reversals[0].amount,50);
            assert.equal((await service.expenseDetail(db,{id:created.id},owner)).status,'VOIDED');
            assert.equal((await service.listExpenses(db,filter,owner)).totals.expensePaise,190000);
            await assert.rejects(service.actOnExpense(db,{...request,operationId:randomUUID(),expectedRevision:2},owner),/already voided/);
        });
        await t.test('closed-register corrections cannot rewrite the counted cash balance',async()=>{
            await cash('old-tea','EXPENSE',20,'CASH_OUT','past');
            const classified=await service.actOnExpense(db,{operationId:randomUUID(),id:'drawer:old-tea',expectedRevision:0,action:'CLASSIFY',category:'REFRESHMENTS',reason:'Earlier staff tea'},owner);
            const before=await countCash();
            await assert.rejects(service.actOnExpense(db,{operationId:randomUUID(),id:classified.id,expectedRevision:1,action:'VOID',reason:'Wrong earlier entry'},owner),/closed-register/);
            assert.equal((await service.expenseDetail(db,{id:classified.id},owner)).status,'ACTIVE');assert.equal(await countCash(),before);
            await service.actOnExpense(db,{operationId:randomUUID(),id:classified.id,expectedRevision:1,action:'EXCLUDE',reason:'Personal spending; keep the counted cash movement'},owner);
            assert.equal((await db.$queryRawUnsafe('SELECT closingActual FROM CashRegister WHERE id=?','past'))[0].closingActual,1234);
            await assert.rejects(service.createExpense(db,{operationId:randomUUID(),date:previous,category:'OTHER',amount:1,note:'Earlier payment',paymentSource:'CASH_DRAWER'},owner),/dated today/);
        });
        await t.test('CSV reports statuses and includes safe text without spreadsheet-formula execution',async()=>{
            await service.createExpense(db,{operationId:randomUUID(),date,category:'OTHER',amount:10,note:'=1+1',paymentSource:'UPI'},owner);
            const result=await service.exportExpenses(db,filter,owner);assert.match(result.csv,/Included in recorded expenses/);assert.match(result.csv,/"'=1\+1"/);assert.match(result.csv,/"REVIEW","NO"/);assert.match(result.csv,/"VOIDED","NO"/);assert.match(result.csv,/"ACTIVE","YES"/);assert.match(result.csv,/Not reviewed/);
        });
        await t.test('validation and missing cash-register permissions fail before money records change',async()=>{
            const base={operationId:randomUUID(),date,category:'OTHER',amount:10,note:'Valid expense',paymentSource:'UPI'};
            for(const patch of [{amount:0},{amount:-1},{amount:Infinity},{amount:1.001},{category:'OWNER_WITHDRAWAL'},{note:''},{paymentSource:'CARD'},{date:'2026-02-30'}])await assert.rejects(service.createExpense(db,{...base,...patch},owner));
            const denied={...owner,role:'CASHIER',permManageCashDrawer:false};
            await assert.rejects(service.createExpense(db,base,denied),/permission/);await assert.rejects(service.listExpenses(db,filter,denied),/permission/);await assert.rejects(service.exportExpenses(db,filter,denied),/permission/);
            await assert.rejects(service.actOnExpense(db,{operationId:randomUUID(),id:tea.id,expectedRevision:3,action:'EXCLUDE',reason:''},owner),/Reason/);
            await assert.rejects(service.listExpenses(db,{...filter,from:date,to:previous},owner),/Start date/);
        });
        await t.test('pagination keeps the complete filtered totals and records survive a reconnect',async()=>{
            await db.$transaction(async tx=>{for(let i=0;i<51;i++)await tx.$executeRawUnsafe('INSERT INTO ShopExpense VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?, ?)',randomUUID(),date,'SUPPLIES',100,'Pagination sample','UPI','ACTIVE',owner.id,now,now);},{timeout:20000});
            const result=await service.listExpenses(db,{...filter,search:'Pagination sample'},owner);assert.equal(result.items.length,50);assert.equal(result.total,51);assert.equal(result.totals.expensePaise,5100);
            const next=await service.listExpenses(db,{...filter,search:'Pagination sample',page:2},owner);assert.equal(next.items.length,1);assert.equal(next.totals.expensePaise,5100);
            const reconnect=new PrismaClient({datasources:{db:{url}}});try{assert.equal((await service.expenseDetail(reconnect,{id:tea.id},owner)).history.length,3);}finally{await reconnect.$disconnect();}
        });
    }finally{await db.$disconnect();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(directory).startsWith('zain-expenses-'));fs.rmSync(directory,{recursive:true,force:true});}
});

