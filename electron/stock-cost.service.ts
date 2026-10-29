import * as crypto from 'node:crypto';

const numberRow=(row:any):any=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?Number(value):value]));
const tables=['StockCostLot','StockCostCoverage','StockCostAllocation','StockCostRestoration','StockCostReturn','StockCostChange'];
/** Called inside the stock mutation transaction. No cache can survive a rolled-back migration. */
async function schema(tx:any){
    const found=await tx.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${tables.map(()=>'?').join(',')})`,...tables);
    if(found.length===tables.length)return;
    for(const sql of [
        `CREATE TABLE IF NOT EXISTS StockCostLot (id TEXT PRIMARY KEY,variantId TEXT NOT NULL REFERENCES ProductVariant(id),source TEXT NOT NULL,sourceId TEXT,quantity INTEGER NOT NULL,remainingQuantity INTEGER NOT NULL,remainingCostPaise INTEGER,createdAt TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS StockCostCoverage (saleId TEXT PRIMARY KEY REFERENCES Sale(id),legacy INTEGER NOT NULL,createdAt TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS StockCostAllocation (id TEXT PRIMARY KEY,saleId TEXT NOT NULL,variantId TEXT NOT NULL,lotId TEXT NOT NULL REFERENCES StockCostLot(id),quantity INTEGER NOT NULL,costPaise INTEGER,releasedQuantity INTEGER NOT NULL DEFAULT 0,releasedCostPaise INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS StockCostRestoration (id TEXT PRIMARY KEY,allocationId TEXT,sourceSaleId TEXT NOT NULL,sourceVariantId TEXT NOT NULL,targetVariantId TEXT,kind TEXT NOT NULL,reference TEXT NOT NULL,quantity INTEGER NOT NULL,costPaise INTEGER,createdAt TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS StockCostReturn (id TEXT PRIMARY KEY,payload TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS StockCostChange (id TEXT PRIMARY KEY,lotId TEXT NOT NULL,kind TEXT NOT NULL,reference TEXT NOT NULL,quantity INTEGER NOT NULL,costPaise INTEGER,createdAt TEXT NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS StockCostLot_variant_idx ON StockCostLot(variantId,createdAt)`,
        `CREATE INDEX IF NOT EXISTS StockCostAllocation_sale_idx ON StockCostAllocation(saleId,variantId)`,
        `CREATE INDEX IF NOT EXISTS StockCostAllocation_lot_idx ON StockCostAllocation(lotId)`,
    ])await tx.$executeRawUnsafe(sql);
}
async function lot(tx:any,variantId:string,quantity:number,cost:number|null,source:string,sourceId:string|null,id:string=crypto.randomUUID()){
    await tx.$executeRawUnsafe('INSERT INTO StockCostLot VALUES (?, ?, ?, ?, ?, ?, ?, ?)',id,variantId,source,sourceId,quantity,quantity,cost,new Date().toISOString());
    return id;
}
async function change(tx:any,lotId:string,kind:string,reference:string,quantity:number,cost:number|null){
    await tx.$executeRawUnsafe('INSERT INTO StockCostChange VALUES (?, ?, ?, ?, ?, ?, ?)',crypto.randomUUID(),lotId,kind,reference,quantity,cost,new Date().toISOString());
}
async function take(tx:any,row:any,quantity:number,kind:string,reference:string):Promise<number|null>{
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>row.remainingQuantity)throw new Error('Batch cost quantity is inconsistent. Check stock before continuing.');
    const cost=row.remainingCostPaise===null?null:Math.round(row.remainingCostPaise*quantity/row.remainingQuantity);
    await tx.$executeRawUnsafe('UPDATE StockCostLot SET remainingQuantity=remainingQuantity-?,remainingCostPaise=CASE WHEN remainingCostPaise IS NULL THEN NULL ELSE remainingCostPaise-? END WHERE id=?',quantity,cost??0,row.id);
    await change(tx,row.id,kind,reference,-quantity,cost===null?null:-cost);
    return cost;
}
/** Recounts and legacy imports cannot invent costs. Unexplained additions are unknown-cost stock. */
export async function prepareStockCosts(tx:any,variantIds:string[]){
    await schema(tx);
    for(const variantId of new Set(variantIds)){
        const variant=await tx.productVariant.findUnique({where:{id:variantId},select:{stock:true}});
        if(!variant)throw new Error('Cost tracking item no longer exists.');
        const rows=(await tx.$queryRawUnsafe('SELECT * FROM StockCostLot WHERE variantId=? AND remainingQuantity>0 ORDER BY rowid',variantId)).map(numberRow);
        const expected=Math.max(0,variant.stock),current=rows.reduce((sum:number,row:any)=>sum+row.remainingQuantity,0);
        if(expected>current)await lot(tx,variantId,expected-current,null,'UNATTRIBUTED',null);
        else if(current>expected){
            let excess=current-expected;
            // Remove unknown units first; remaining unexplained losses use FIFO and are auditable.
            for(const row of [...rows.filter((r:any)=>r.remainingCostPaise===null),...rows.filter((r:any)=>r.remainingCostPaise!==null)]){
                const quantity=Math.min(excess,row.remainingQuantity);if(!quantity)break;
                await take(tx,row,quantity,'RECONCILIATION','Unattributed stock reduction');excess-=quantity;
            }
        }
    }
}
/** Baseline must be prepared BEFORE the physical receipt increments stock. */
export async function recordPurchaseCost(tx:any,lineId:string,variantId:string,quantity:number,totalCostPaise:number){
    await schema(tx);
    await lot(tx,variantId,quantity,totalCostPaise,'PURCHASE',lineId,`purchase:${lineId}`);
}
/** Only unconsumed receipt costs may be corrected; past sale allocations never change. */
export async function correctPurchaseCost(tx:any,line:any,quantity:number,totalCostPaise:number,reference:string){
    await prepareStockCosts(tx,[line.variantId]);
    const rows=(await tx.$queryRawUnsafe('SELECT * FROM StockCostLot WHERE id=?',`purchase:${line.id}`)).map(numberRow);
    if(!rows.length)return; // Pre-tracking purchases stay unattributed rather than guessing their remaining goods.
    const row=rows[0];
    if(quantity===line.quantity&&totalCostPaise===line.landedTotalPaise)return;
    if(row.remainingQuantity!==row.quantity)throw new Error('This purchase batch has already been sold or returned. Its cost cannot be rewritten; use a supplier return or a separate new receipt.');
    await tx.$executeRawUnsafe('UPDATE StockCostLot SET quantity=?,remainingQuantity=?,remainingCostPaise=? WHERE id=?',quantity,quantity,totalCostPaise,row.id);
    await change(tx,row.id,'PURCHASE_CORRECTION',reference,quantity-row.quantity,totalCostPaise-row.remainingCostPaise);
}
/** Supplier returns take THIS receipt's unsold batch, never a newer batch with another cost. */
export async function removePurchaseCost(tx:any,line:any,quantity:number,reference:string){
    await prepareStockCosts(tx,[line.variantId]);
    const rows=(await tx.$queryRawUnsafe('SELECT * FROM StockCostLot WHERE id=?',`purchase:${line.id}`)).map(numberRow);
    if(rows.length){
        if(rows[0].remainingQuantity<quantity)throw new Error('Not enough unsold pieces remain in this purchase batch. Do not return stock from another delivery against it.');
        await take(tx,rows[0],quantity,'SUPPLIER_RETURN',reference);return;
    }
    const unknown=(await tx.$queryRawUnsafe('SELECT * FROM StockCostLot WHERE variantId=? AND remainingQuantity>0 AND remainingCostPaise IS NULL ORDER BY rowid',line.variantId)).map(numberRow);
    if(unknown.reduce((sum:number,row:any)=>sum+row.remainingQuantity,0)<quantity)throw new Error('This older purchase has insufficient unallocated stock. Newer known-cost batches cannot be reversed against it.');
    let remaining=quantity;
    for(const row of unknown){const q=Math.min(remaining,row.remainingQuantity);if(!q)break;await take(tx,row,q,'LEGACY_SUPPLIER_RETURN',reference);remaining-=q;}
}
async function coverage(tx:any,saleId:string,old:Map<string,number>){
    const found=await tx.$queryRawUnsafe('SELECT * FROM StockCostCoverage WHERE saleId=?',saleId);
    if(found.length)return;
    await tx.$executeRawUnsafe('INSERT INTO StockCostCoverage VALUES (?, ?, ?)',saleId,old.size?1:0,new Date().toISOString());
    for(const [variantId,quantity] of old)if(quantity>0){
        const lotId=await lot(tx,variantId,0,null,'LEGACY_SALE',saleId);
        await allocation(tx,saleId,variantId,lotId,quantity,null);
    }
}
async function allocation(tx:any,saleId:string,variantId:string,lotId:string,quantity:number,cost:number|null){
    await tx.$executeRawUnsafe('INSERT INTO StockCostAllocation VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)',crypto.randomUUID(),saleId,variantId,lotId,quantity,cost,new Date().toISOString());
}
async function release(tx:any,row:any,quantity:number,target:string|null,kind:string,reference:string){
    const released=row.releasedQuantity+quantity;
    const cumulative=row.costPaise===null?null:Math.round(row.costPaise*released/row.quantity);
    const cost=cumulative===null?null:cumulative-row.releasedCostPaise;
    await tx.$executeRawUnsafe('UPDATE StockCostAllocation SET releasedQuantity=?,releasedCostPaise=? WHERE id=?',released,cumulative??0,row.id);
    if(target){
        const original=(await tx.$queryRawUnsafe('SELECT * FROM StockCostLot WHERE id=?',row.lotId)).map(numberRow)[0];
        if(target===row.variantId && original && original.source!=='LEGACY_SALE' && original.source!=='SHORTAGE'){
            await tx.$executeRawUnsafe('UPDATE StockCostLot SET remainingQuantity=remainingQuantity+?,remainingCostPaise=CASE WHEN remainingCostPaise IS NULL THEN NULL ELSE remainingCostPaise+? END WHERE id=?',quantity,cost??0,original.id);
            await change(tx,original.id,kind,reference,quantity,cost);
        }else await lot(tx,target,quantity,target===row.variantId?cost:null,'CUSTOMER_RETURN',reference);
    }
    await tx.$executeRawUnsafe('INSERT INTO StockCostRestoration VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',crypto.randomUUID(),row.id,row.saleId,row.variantId,target,kind,reference,quantity,cost,new Date().toISOString());
}
/** Called before physical stock changes. Old quantities make pre-tracking sale edits explicitly unknown. */
export async function syncSaleCosts(tx:any,saleId:string,newQuantities:Map<string,number>,oldQuantities=new Map<string,number>(),prepared=false){
    await schema(tx);
    if(!prepared)await prepareStockCosts(tx,[...new Set([...newQuantities.keys(),...oldQuantities.keys()])]);
    await coverage(tx,saleId,oldQuantities);
    for(const variantId of new Set([...newQuantities.keys(),...oldQuantities.keys()])){
        const rows=(await tx.$queryRawUnsafe('SELECT * FROM StockCostAllocation WHERE saleId=? AND variantId=? ORDER BY rowid',saleId,variantId)).map(numberRow);
        const current=rows.reduce((sum:number,row:any)=>sum+row.quantity-row.releasedQuantity,0),wanted=newQuantities.get(variantId)??0;
        if(!Number.isSafeInteger(wanted)||wanted<0)throw new Error('Invalid sale quantity for cost capture.');
        if(current>wanted){
            let remaining=current-wanted;
            for(const row of [...rows].reverse()){
                const quantity=Math.min(remaining,row.quantity-row.releasedQuantity);if(!quantity)continue;
                await release(tx,row,quantity,variantId,'SALE_EDIT',saleId);remaining-=quantity;if(!remaining)break;
            }
        }else if(wanted>current){
            let remaining=wanted-current;
            const available=(await tx.$queryRawUnsafe('SELECT * FROM StockCostLot WHERE variantId=? AND remainingQuantity>0 ORDER BY rowid',variantId)).map(numberRow);
            for(const row of available){
                const quantity=Math.min(remaining,row.remainingQuantity);if(!quantity)break;
                const cost=await take(tx,row,quantity,'SALE',saleId);await allocation(tx,saleId,variantId,row.id,quantity,cost);remaining-=quantity;
            }
            if(remaining){
                const lotId=await lot(tx,variantId,0,null,'SHORTAGE',saleId);
                await allocation(tx,saleId,variantId,lotId,remaining,null);
            }
        }
    }
}
export async function restoreSaleCosts(tx:any,sale:any,routes:Map<string,any>,reference:string,kind:'REFUND'|'EXCHANGE',prepared=false){
    await schema(tx);
    if(!prepared)await prepareStockCosts(tx,[...routes.values()].map(route=>route.targetVariantId).filter(Boolean));
    const found=await tx.$queryRawUnsafe('SELECT saleId FROM StockCostCoverage WHERE saleId=?',sale.id);
    if(!found.length){
        // Earlier refunds/exchanges have no captured costs. Only the unreturned quantities remain eligible.
        const remaining=new Map<string,number>();
        for(const item of sale.items)remaining.set(item.variantId,(remaining.get(item.variantId)??0)+item.quantity);
        for(const refund of sale.refunds??[])for(const item of refund.items??[])remaining.set(item.variantId,(remaining.get(item.variantId)??0)-item.quantity);
        for(const exchange of sale.exchanges??[])for(const item of exchange.items??[])if(item.returnedItemId)remaining.set(item.returnedItemId,(remaining.get(item.returnedItemId)??0)-item.returnedQty);
        await coverage(tx,sale.id,remaining);
    }
    for(const route of routes.values()){
        const operation=`${kind}:${reference}:${route.sourceVariantId}`,payload=JSON.stringify({saleId:sale.id,...route});
        const prior=await tx.$queryRawUnsafe('SELECT payload FROM StockCostReturn WHERE id=?',operation);
        if(prior.length){if(prior[0].payload!==payload)throw new Error('Cost return reference was reused for different goods.');continue;}
        const rows=(await tx.$queryRawUnsafe('SELECT * FROM StockCostAllocation WHERE saleId=? AND variantId=? ORDER BY rowid',sale.id,route.sourceVariantId)).map(numberRow);
        if(rows.reduce((sum:number,row:any)=>sum+row.quantity-row.releasedQuantity,0)<route.quantity)throw new Error('Return quantity exceeds the remaining cost allocation.');
        let remaining=route.quantity;
        for(const row of rows){const quantity=Math.min(remaining,row.quantity-row.releasedQuantity);if(!quantity)continue;await release(tx,row,quantity,route.targetVariantId,kind,reference);remaining-=quantity;if(!remaining)break;}
        await tx.$executeRawUnsafe('INSERT INTO StockCostReturn VALUES (?, ?)',operation,payload);
    }
}
/** Permission-checked read. Does not create tables, guess historical costs, or reveal costs to cashiers. */
export async function getSaleCosts(db:any,input:any,user:any){
    if(!user?.isActive||!(user.role==='ADMIN'||(user.permViewSales&&user.permViewCostPrice)))throw new Error('Sales and cost-price permissions are required.');
    if(typeof input?.saleId!=='string'||!input.saleId||input.saleId.length>200)throw new Error('Choose a sale.');
    return db.$transaction(async(tx:any)=>{
        const present=await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='StockCostCoverage'");
        const empty={status:'NOT_CAPTURED',knownCostPaise:0,unknownQuantity:0,heldCostPaise:0,heldUnknownQuantity:0,allocations:[]};
        if(!present.length)return empty;
        const captured=await tx.$queryRawUnsafe('SELECT * FROM StockCostCoverage WHERE saleId=?',input.saleId);
        if(!captured.length)return empty;
        const rows=(await tx.$queryRawUnsafe('SELECT a.*,l.source,l.sourceId FROM StockCostAllocation a JOIN StockCostLot l ON l.id=a.lotId WHERE a.saleId=? ORDER BY a.rowid',input.saleId)).map(numberRow);
        const knownCostPaise=rows.reduce((sum:number,row:any)=>sum+(row.costPaise===null?0:row.costPaise-row.releasedCostPaise),0);
        const unknownQuantity=rows.reduce((sum:number,row:any)=>sum+(row.costPaise===null?row.quantity-row.releasedQuantity:0),0);
        const held=(await tx.$queryRawUnsafe('SELECT quantity,costPaise FROM StockCostRestoration WHERE sourceSaleId=? AND targetVariantId IS NULL',input.saleId)).map(numberRow);
        return {status:unknownQuantity>0||held.some((row:any)=>row.costPaise===null)||Number(captured[0].legacy)?'UNKNOWN_COST':'CAPTURED',knownCostPaise,unknownQuantity,
            heldCostPaise:held.reduce((sum:number,row:any)=>sum+(row.costPaise??0),0),heldUnknownQuantity:held.reduce((sum:number,row:any)=>sum+(row.costPaise===null?row.quantity:0),0),
            allocations:rows.map((row:any)=>({variantId:row.variantId,batch:row.sourceId,quantity:row.quantity-row.releasedQuantity,costPaise:row.costPaise===null?null:row.costPaise-row.releasedCostPaise}))};
    });
}
