import * as crypto from 'node:crypto';
import {EXPENSE_CATEGORIES} from '../src/types/expenses';
import type {ExpenseInput,ExpenseAction,ExpenseQuery,ExpenseRecord} from '../src/types/expenses';

const sources=['CASH_DRAWER','UPI','BANK','PERSONAL_CASH'];
const statuses=['ALL','ACTIVE','REVIEW','EXCLUDED','VOIDED'];
const ready=new WeakSet<object>(),pending=new WeakMap<object,Promise<void>>();
const numeric=(row:any):any=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?Number(value):value]));
function authorize(user:any){if(!user?.id||!user.isActive||!(user.role==='ADMIN'||user.permManageCashDrawer))throw new Error('Cash-register permission is required to manage expenses.');}
function text(value:unknown,label:string,max=500):string{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error(`${label} is required and must be valid text.`);return value.trim();}
function money(value:unknown){if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>100_000_000||Math.abs(value*100-Math.round(value*100))>0.00001)throw new Error('Enter a positive amount with at most two decimal places.');return Math.round(value*100);}
function category(value:unknown){if(typeof value!=='string'||!Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORIES,value))throw new Error('Choose a business expense category.');return value;}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function date(value:unknown){const result=text(value,'Date',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result))||new Date(result).toISOString().slice(0,10)!==result)throw new Error('Choose a valid date.');return result;}
async function schema(db:any){
    if(ready.has(db))return;if(pending.has(db))return pending.get(db);
    const work=(async()=>{
        for(const sql of [
            `CREATE TABLE IF NOT EXISTS ShopExpense (id TEXT PRIMARY KEY,expenseDate TEXT NOT NULL,category TEXT NOT NULL,amountPaise INTEGER NOT NULL CHECK(amountPaise>0),note TEXT NOT NULL,paymentSource TEXT NOT NULL,drawerTxId TEXT UNIQUE,reversalDrawerTxId TEXT UNIQUE,status TEXT NOT NULL,revision INTEGER NOT NULL,createdBy TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL)`,
            `CREATE INDEX IF NOT EXISTS ShopExpense_date_idx ON ShopExpense(expenseDate)`,
            `CREATE TABLE IF NOT EXISTS ShopExpenseAudit (id TEXT PRIMARY KEY,expenseId TEXT NOT NULL REFERENCES ShopExpense(id),action TEXT NOT NULL,reason TEXT NOT NULL,beforeJson TEXT,afterJson TEXT NOT NULL,createdBy TEXT NOT NULL,createdAt TEXT NOT NULL)`,
            `CREATE INDEX IF NOT EXISTS ShopExpenseAudit_expense_idx ON ShopExpenseAudit(expenseId)`,
            `CREATE TABLE IF NOT EXISTS ShopExpenseOperation (id TEXT PRIMARY KEY,userId TEXT NOT NULL,hash TEXT NOT NULL,resultJson TEXT NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS ShopExpenseLock (id INTEGER PRIMARY KEY,token INTEGER NOT NULL)`,
            `INSERT OR IGNORE INTO ShopExpenseLock VALUES (1,0)`,
        ])await db.$executeRawUnsafe(sql);
        ready.add(db);
    })();pending.set(db,work);try{await work;}finally{pending.delete(db);}
}
async function replay(tx:any,id:string,hash:string,user:any){const rows=await tx.$queryRawUnsafe('SELECT * FROM ShopExpenseOperation WHERE id=?',id);if(!rows.length)return null;if(rows[0].userId!==user.id||rows[0].hash!==hash)throw new Error('This request ID was already used for a different expense or operator.');return JSON.parse(rows[0].resultJson);}
async function record(tx:any,id:string,hash:string,user:any,result:any){await tx.$executeRawUnsafe('INSERT INTO ShopExpenseOperation VALUES (?, ?, ?, ?)',id,user.id,hash,JSON.stringify(result));}
async function audit(tx:any,id:string,action:string,reason:string,before:any,after:any,user:any,now:string){await tx.$executeRawUnsafe('INSERT INTO ShopExpenseAudit VALUES (?, ?, ?, ?, ?, ?, ?, ?)',crypto.randomUUID(),id,action,reason,before?JSON.stringify(before):null,JSON.stringify(after),user.id,now);}
async function tableNames(tx:any){return new Set((await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('CashRegister','CashDrawerTx','PurchasePayment')")).map((r:any)=>r.name));}
/** Drawer review is a projection, not an import: one cash movement is represented once. */
async function projection(tx:any){
    const tables=await tableNames(tx);
    const legacy=tables.has('CashRegister')&&tables.has('CashDrawerTx')?`UNION ALL SELECT 'drawer:'||ct.id AS id,cr.date AS expenseDate,
        CASE ct.category WHEN 'FREIGHT' THEN 'TRANSPORT' WHEN 'MUNICIPALITY' THEN 'FEES' ELSE 'OTHER' END AS category,
        CAST(ROUND(ct.amount*100) AS INTEGER) AS amountPaise,ct.note,'CASH_DRAWER' AS paymentSource,ct.id AS drawerTxId,'REVIEW' AS status,0 AS revision,ct.createdAt,NULL AS createdBy
        FROM CashDrawerTx ct JOIN CashRegister cr ON cr.id=ct.registerId
        WHERE ct.type='CASH_OUT' AND ct.category IN ('EXPENSE','FREIGHT','MUNICIPALITY')
        AND NOT EXISTS(SELECT 1 FROM ShopExpense e WHERE e.drawerTxId=ct.id)
        ${tables.has('PurchasePayment')?'AND NOT EXISTS(SELECT 1 FROM PurchasePayment p WHERE p.drawerTxId=ct.id)':''}`:'';
    return `WITH expenseRows AS (SELECT id,expenseDate,category,amountPaise,note,paymentSource,drawerTxId,status,revision,createdAt,createdBy FROM ShopExpense ${legacy})`;
}
function query(input:ExpenseQuery){
    const from=date(input?.from),to=date(input?.to);if(from>to)throw new Error('Start date must be before the end date.');
    const search=typeof input?.search==='string'?input.search.trim().slice(0,200):'';
    const status=input.status??'ALL',source=input.paymentSource??'ALL';
    if(!statuses.includes(status)||!(source==='ALL'||sources.includes(source)))throw new Error('Choose valid expense filters.');
    const page=input.page??1;if(!Number.isSafeInteger(page)||page<1||page>100000)throw new Error('Invalid expense page.');
    return {from,to,search,status,source,page};
}
function conditions(input:ReturnType<typeof query>){return {sql:`WHERE expenseDate>=? AND expenseDate<=? AND (?='ALL' OR status=?) AND (?='ALL' OR paymentSource=?) AND instr(lower(note||' '||category),lower(?))>0`,values:[input.from,input.to,input.status,input.status,input.source,input.source,input.search]};}
export async function listExpenses(db:any,input:ExpenseQuery,user:any){
    authorize(user);const filter=query(input);await schema(db);
    return db.$transaction(async(tx:any)=>{
        const source=await projection(tx),where=conditions(filter);
        const totals=numeric((await tx.$queryRawUnsafe(`${source} SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN status='ACTIVE' THEN amountPaise ELSE 0 END),0) AS expensePaise,COALESCE(SUM(CASE WHEN status='REVIEW' THEN amountPaise ELSE 0 END),0) AS reviewPaise,COALESCE(SUM(CASE WHEN status='REVIEW' THEN 1 ELSE 0 END),0) AS reviewCount FROM expenseRows ${where.sql}`,...where.values))[0]);
        const items=(await tx.$queryRawUnsafe(`${source} SELECT * FROM expenseRows ${where.sql} ORDER BY expenseDate DESC,createdAt DESC,id DESC LIMIT 50 OFFSET ?`,...where.values,(filter.page-1)*50)).map(numeric);
        return {items,total:totals.total,page:filter.page,totals:{expensePaise:totals.expensePaise,reviewPaise:totals.reviewPaise,reviewCount:totals.reviewCount}};
    });
}
async function get(tx:any,id:string):Promise<ExpenseRecord>{
    const source=await projection(tx),rows=await tx.$queryRawUnsafe(`${source} SELECT * FROM expenseRows WHERE id=?`,id);
    if(!rows.length)throw new Error('Expense entry no longer exists. Refresh the page.');return numeric(rows[0]);
}
async function openDrawer(tx:any){
    const tables=await tableNames(tx);if(!tables.has('CashRegister')||!tables.has('CashDrawerTx'))throw new Error('Open today’s cash register before recording drawer expenses.');
    const rows=await tx.$queryRawUnsafe("SELECT * FROM CashRegister WHERE status='OPEN' AND date=?",today());if(rows.length!==1)throw new Error('Open today’s cash register before recording drawer expenses.');return rows[0];
}
export async function createExpense(db:any,input:ExpenseInput,user:any){
    authorize(user);const operationId=text(input?.operationId,'Request ID',200),expenseDate=date(input.date),expenseCategory=category(input.category),amount=money(input.amount),note=text(input.note,'Description'),source=input.paymentSource;
    if(expenseDate>today())throw new Error('Expenses cannot be dated in the future.');if(!sources.includes(source))throw new Error('Choose a valid payment source.');
    if(source==='CASH_DRAWER'&&expenseDate!==today())throw new Error('New drawer expenses must be dated today. Classify an existing drawer entry for an earlier payment instead.');
    const body={action:'CREATE',expenseDate,category:expenseCategory,amount,note,source},hash=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    await schema(db);
    return db.$transaction(async(tx:any)=>{
        await tx.$executeRawUnsafe('UPDATE ShopExpenseLock SET token=token WHERE id=1');const prior=await replay(tx,operationId,hash,user);if(prior)return prior;
        const id=crypto.randomUUID(),now=new Date().toISOString();let drawerTxId:string|null=null;
        if(source==='CASH_DRAWER'){
            const drawer=await openDrawer(tx);drawerTxId=crypto.randomUUID();
            await tx.$executeRawUnsafe('INSERT INTO CashDrawerTx (id,registerId,type,category,amount,note,createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',drawerTxId,drawer.id,'CASH_OUT','BUSINESS_EXPENSE',amount/100,`${EXPENSE_CATEGORIES[expenseCategory as keyof typeof EXPENSE_CATEGORIES]} · ${note}`,now);
        }
        await tx.$executeRawUnsafe('INSERT INTO ShopExpense VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?)',id,expenseDate,expenseCategory,amount,note,source,drawerTxId,'ACTIVE',user.id,now,now);
        const after=await get(tx,id);await audit(tx,id,'CREATE','Expense recorded',null,after,user,now);const result={id};await record(tx,operationId,hash,user,result);return result;
    });
}
export async function actOnExpense(db:any,input:ExpenseAction,user:any){
    authorize(user);const operationId=text(input?.operationId,'Request ID',200),id=text(input.id,'Expense ID',300),reason=text(input.reason,'Reason');
    if(!['CLASSIFY','EXCLUDE','VOID'].includes(input.action)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw new Error('Reload this expense before changing it.');
    const newCategory=input.action==='CLASSIFY'?category(input.category):null;
    const hash=crypto.createHash('sha256').update(JSON.stringify({id,reason,action:input.action,newCategory,expectedRevision:input.expectedRevision})).digest('hex');await schema(db);
    return db.$transaction(async(tx:any)=>{
        await tx.$executeRawUnsafe('UPDATE ShopExpenseLock SET token=token WHERE id=1');const prior=await replay(tx,operationId,hash,user);if(prior)return prior;
        const before=await get(tx,id);if(before.revision!==input.expectedRevision)throw new Error('This expense changed. Reload it before continuing.');if(before.status==='VOIDED')throw new Error('This entry is already voided.');
        const now=new Date().toISOString();let realId=before.id;
        if(before.status==='REVIEW'){
            // Capture the original cash movement only; never generate another payment during classification.
            const raw=await tx.$queryRawUnsafe('SELECT amount FROM CashDrawerTx WHERE id=?',before.drawerTxId);money(Number(raw[0]?.amount));
            realId=crypto.randomUUID();
            await tx.$executeRawUnsafe('INSERT INTO ShopExpense VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?)',realId,before.expenseDate,before.category,before.amountPaise,before.note,'CASH_DRAWER',before.drawerTxId,'REVIEW',user.id,now,now);
        }
        let reversalId:string|null=null;
        if(input.action==='VOID'&&before.drawerTxId){
            const drawer=await openDrawer(tx);
            const rows=await tx.$queryRawUnsafe('SELECT registerId FROM CashDrawerTx WHERE id=?',before.drawerTxId);
            if(!rows.length||rows[0].registerId!==drawer.id)throw new Error('A closed-register cash entry cannot be voided here. Exclude or reclassify the expense without changing its recorded cash movement.');
            reversalId=crypto.randomUUID();
            await tx.$executeRawUnsafe('INSERT INTO CashDrawerTx (id,registerId,type,category,amount,note,createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',reversalId,drawer.id,'CASH_IN','EXPENSE_REVERSAL',before.amountPaise/100,`Expense entry correction · ${reason}`,now);
        }
        const status=input.action==='CLASSIFY'?'ACTIVE':input.action==='EXCLUDE'?'EXCLUDED':'VOIDED';
        await tx.$executeRawUnsafe('UPDATE ShopExpense SET category=?,status=?,revision=revision+1,reversalDrawerTxId=?,updatedAt=? WHERE id=?',newCategory??before.category,status,reversalId,now,realId);
        const after=await get(tx,realId);await audit(tx,realId,input.action,reason,before,after,user,now);const result={id:realId};await record(tx,operationId,hash,user,result);return result;
    });
}
export async function expenseDetail(db:any,input:any,user:any){
    authorize(user);const id=text(input?.id,'Expense ID',300);await schema(db);
    return db.$transaction(async(tx:any)=>{const entry=await get(tx,id);const history=entry.status==='REVIEW'?[]:await tx.$queryRawUnsafe('SELECT a.id,a.action,a.reason,a.createdAt,COALESCE(u.name,a.createdBy) AS actor FROM ShopExpenseAudit a LEFT JOIN User u ON u.id=a.createdBy WHERE expenseId=? ORDER BY a.rowid',id);return {...entry,history};});
}
function csvCell(value:unknown){let text=String(value??'');if(/^\s*[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
export async function exportExpenses(db:any,input:ExpenseQuery,user:any){
    authorize(user);const filter=query(input);await schema(db);
    return db.$transaction(async(tx:any)=>{
        const source=await projection(tx),where=conditions(filter);
        const rows=(await tx.$queryRawUnsafe(`${source} SELECT * FROM expenseRows ${where.sql} ORDER BY expenseDate,id LIMIT 10001`,...where.values)).map(numeric);
        if(rows.length>10000)throw new Error('Export a smaller date range, up to 10,000 entries.');
        const header=['Date','Category','Amount INR','Description','Payment source','Status','Included in recorded expenses','Tax treatment'];
        const csv=[header,...rows.map((row:any)=>[row.expenseDate,EXPENSE_CATEGORIES[row.category as keyof typeof EXPENSE_CATEGORIES]??row.category,(row.amountPaise/100).toFixed(2),row.note,row.paymentSource,row.status,row.status==='ACTIVE'?'YES':'NO','Not reviewed'])].map(row=>row.map(csvCell).join(',')).join('\r\n');
        return {csv,rowCount:rows.length};
    });
}
