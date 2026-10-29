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

test('expense renderer, preload, trusted IPC and drawer deletion guard use one consistent ledger',async t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zain-expense-flow-'));
    const {PrismaClient}=require(path.join(root,'prisma/generated/client'));
    const db=new PrismaClient({datasources:{db:{url:'file:'+path.join(directory,'test.db').replaceAll('\\','/')}}});
    const auth=load('electron/session-auth.service'),event={sender:{id:Math.floor(Math.random()*1e9),isDestroyed:()=>false}};
    try{
        const sql=execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/generated/client/schema.prisma'),'--script'],{encoding:'utf8',cwd:root});
        for(const statement of sql.split(';').map(v=>v.trim()).filter(Boolean))await db.$executeRawUnsafe(statement);
        const owner=await db.user.create({data:{username:'expense-flow-owner',name:'Owner',password:'test-only',role:'ADMIN',isActive:true}});
        const cashier=await db.user.create({data:{username:'expense-flow-staff',name:'Staff',password:'test-only',role:'CASHIER',permManageCashDrawer:false,isActive:true}});
        const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),now=new Date().toISOString();
        await db.$executeRawUnsafe('CREATE TABLE CashRegister (id TEXT PRIMARY KEY,date TEXT,status TEXT,openedAt TEXT)');
        await db.$executeRawUnsafe('CREATE TABLE CashDrawerTx (id TEXT PRIMARY KEY,registerId TEXT,type TEXT,category TEXT,amount REAL,note TEXT,createdAt TEXT)');
        await db.$executeRawUnsafe('INSERT INTO CashRegister VALUES (?, ?, ?, ?)', 'today',date,'OPEN',now);
        await db.$executeRawUnsafe('INSERT INTO CashDrawerTx VALUES (?, ?, ?, ?, ?, ?, ?)', 'original','today','CASH_OUT','EXPENSE',100,'Tea',now);
        const handlers=new Map(),backend=load('electron/expenses.service');
        const context={...backend,prisma:db,resolveElectronSessionUser:auth.resolveElectronSessionUser,PermissionMiddleware:load('electron/permission.service').PermissionMiddleware,
            ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},getUserPermissions:async()=>owner,validateIpcRequest:()=>{throw new Error('Untrusted identity path used');},logger:{warn(){},error(){}},Error,console,require,Date};
        const main=fs.readFileSync(path.join(root,'electron/main.ts'),'utf8');
        const helper=main.slice(main.indexOf('function createSecureIpcHandler<'),main.indexOf('// --- Input Validation Helpers ---'));
        const registers=main.slice(main.indexOf('function getLocalDateString()'),main.indexOf('// Test printer connection',main.indexOf('function getLocalDateString()')));
        const routes=main.slice(main.indexOf('// --- Expense Handlers:'),main.indexOf('// --- End Expense Handlers ---'));
        vm.runInNewContext(ts.transpileModule(helper+registers+routes,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
        let bridge,loseReply=false;
        const preload={exports:{}};
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'electron/preload.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:preload,exports:preload.exports,require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:async(channel,input)=>{const result=await handlers.get(channel)(event,structuredClone(input));if(loseReply&&channel==='expenses:create'){loseReply=false;throw new Error('Lost saved response');}return structuredClone(result);}}};}});
        const frontend={exports:{}};
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/services/expenses.service.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:frontend,exports:frontend.exports,window:{electronAPI:bridge}});
        const service=frontend.exports.expensesService,filter={from:date,to:date,page:1,status:'ALL',paymentSource:'ALL'};
        await t.test('anonymous and forged admin IDs cannot read or create expenses',async()=>{
            await assert.rejects(service.list(filter),/Authentication/);
            auth.electronSessions.bind(event.sender.id,cashier.id);
            const result=await bridge.expenses.list({...filter,userId:owner.id,permManageCashDrawer:true});assert.equal(result.success,false);
        });
        auth.electronSessions.bind(event.sender.id,owner.id);
        let saved;
        await t.test('lost save reply replays the same committed expense without duplicate cash out',async()=>{
            const input={operationId:randomUUID(),date,category:'SUPPLIES',amount:50,note:'Shop paper',paymentSource:'CASH_DRAWER'};
            loseReply=true;await assert.rejects(service.create(input),error=>error.confirmedRejected===false);saved=await service.create(input);
            const result=await service.list(filter);assert.equal(result.total,2);assert.equal(result.totals.expensePaise,5000);assert.equal(result.totals.reviewPaise,10000);
            assert.equal(Number((await db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM CashDrawerTx'))[0].n),2);
        });
        await t.test('classification through the secured API reuses the existing drawer payment',async()=>{
            await service.act({operationId:randomUUID(),id:'drawer:original',expectedRevision:0,action:'CLASSIFY',category:'REFRESHMENTS',reason:'Shop staff tea'});
            assert.equal((await service.list(filter)).totals.expensePaise,15000);assert.equal(Number((await db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM CashDrawerTx'))[0].n),2);
        });
        await t.test('register deletion cannot erase expense-linked original or reversal cash entries',async()=>{
            const detail=await service.detail(saved.id);
            const result=await handlers.get('register:delete-tx')(event,{txId:detail.drawerTxId,userId:owner.id});assert.equal(result.success,false);assert.match(result.error,/Expenses/);
            await service.act({operationId:randomUUID(),id:saved.id,expectedRevision:1,action:'VOID',reason:'Not actually paid; correcting duplicate note'});
            const reversal=(await db.$queryRawUnsafe('SELECT reversalDrawerTxId FROM ShopExpense WHERE id=?',saved.id))[0].reversalDrawerTxId;
            const blocked=await handlers.get('register:delete-tx')(event,{txId:reversal,userId:owner.id});assert.equal(blocked.success,false);assert.match(blocked.error,/Expenses/);
        });
        await t.test('a failure after the cash insert rolls back the expense and its cash movement',async()=>{
            const before=Number((await db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM CashDrawerTx'))[0].n);
            await db.$executeRawUnsafe("CREATE TRIGGER fail_expense_audit BEFORE INSERT ON ShopExpenseAudit BEGIN SELECT RAISE(ABORT,'forced expense audit failure'); END");
            await assert.rejects(service.create({operationId:randomUUID(),date,category:'OTHER',amount:5,note:'Must roll back',paymentSource:'CASH_DRAWER'}));
            await db.$executeRawUnsafe('DROP TRIGGER fail_expense_audit');
            assert.equal(Number((await db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM CashDrawerTx'))[0].n),before);
            assert.equal((await service.list({...filter,search:'Must roll back'})).total,0);
        });
        await t.test('revoked permissions are checked again for the next export and write',async()=>{
            await db.user.update({where:{id:owner.id},data:{role:'CASHIER',permManageCashDrawer:false}});
            await assert.rejects(service.export(filter),/permission/i);
            await assert.rejects(service.create({operationId:randomUUID(),date,category:'OTHER',amount:5,note:'Denied write',paymentSource:'UPI'}),/permission/i);
        });
    }finally{auth.clearElectronSession(event.sender.id);await db.$disconnect();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(directory).startsWith('zain-expense-flow-'));fs.rmSync(directory,{recursive:true,force:true});}
});

