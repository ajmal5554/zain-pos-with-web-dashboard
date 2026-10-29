import crypto from 'node:crypto';
import {purchaseTax,purchaseHsn} from './purchase-tax.service';
import {correctPurchaseCost,removePurchaseCost} from './stock-cost.service';
import {authorize,text,money,mode,today,ensurePurchaseSchema,readPurchaseState,replay,record,payment} from './purchases.service';
import type {PurchaseAdjustmentInput,PurchaseRefundInput} from '../src/types/purchases';

function count(value:unknown) {
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>1_000_000) throw new Error('Enter a non-negative whole quantity.');
    return value;
}
async function changeStock(tx:any,line:any,delta:number,reference:string,user:any,reason:string,now:string) {
    if(!delta) return;
    const variant=await tx.productVariant.findUnique({where:{id:line.variantId}});
    if(!variant || !Number.isSafeInteger(variant.stock+delta) || variant.stock+delta<0 || variant.stock+delta>1_000_000_000) throw new Error(`Not enough stock for ${line.name} (${line.barcode}). Refresh the invoice and check the physical goods.`);
    await tx.productVariant.update({where:{id:line.variantId},data:{stock:{increment:delta},isSynced:false}});
    await tx.inventoryMovement.create({data:{variantId:line.variantId,type:delta>0?'RECEIPT':'ADJUSTMENT',quantity:delta,reference,reason,createdBy:user.id,createdAt:new Date(now),isSynced:false}});
}
export async function adjustPurchase(db:any,input:PurchaseAdjustmentInput,user:any) {
    authorize(user);
    const operationId=text(input?.operationId,'Operation ID'),purchaseId=text(input.purchaseId,'Purchase'),reason=text(input.reason,'Reason',500);
    if(!['RETURN','CANCEL','CORRECTION'].includes(input.kind)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0) throw new Error('Reload the invoice before changing it.');
    if(input.lines && (!Array.isArray(input.lines)||input.lines.length>100||new Set(input.lines.map(row=>row.lineId)).size!==input.lines.length)) throw new Error('Choose distinct invoice lines.');
    const hash=crypto.createHash('sha256').update(JSON.stringify({action:'ADJUST',...input,reason})).digest('hex');
    await ensurePurchaseSchema(db);
    return db.$transaction(async(tx:any)=>{
        await tx.$executeRawUnsafe('UPDATE CatalogueWriteLock SET token=token WHERE id=1');
        const prior=await replay(tx,operationId,hash,user);if(prior)return prior;
        const state=await readPurchaseState(tx,purchaseId);
        if(state.revision!==input.expectedRevision)throw new Error('The invoice changed. Reload it before continuing.');
        if(state.status==='CANCELLED')throw new Error('This purchase is already cancelled.');
        const id=crypto.randomUUID(),now=new Date().toISOString();
        let credit=0,replacement:any=null;
        const deductions:Array<{lineId:string;quantity:number}>=[];
        if(input.kind==='CORRECTION') {
            if(state.tax&&input.tax===undefined)throw new Error('Include the GST breakdown when correcting this invoice. Reload it in the updated Purchases page.');
            if(state.adjustments.some((a:any)=>a.kind==='RETURN'))throw new Error('This invoice already has supplier returns. Cancel its remaining balance and enter a replacement invoice instead.');
            if(!input.lines || input.lines.length!==state.lines.length || input.lines.some(row=>!state.lines.some((line:any)=>line.id===row.lineId)))throw new Error('Include every current invoice line when correcting.');
            const supplier=text(input.supplier,'Supplier'),invoiceNumber=text(input.invoiceNumber,'Invoice number'),invoiceDate=text(input.invoiceDate,'Invoice date'),batchName=text(input.batchName,'Batch name');
            if(!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)||!Number.isFinite(Date.parse(invoiceDate))||new Date(invoiceDate).toISOString().slice(0,10)!==invoiceDate||invoiceDate>today())throw new Error('Choose a valid invoice date, no later than today.');
            if(supplier.toLowerCase()!==state.supplier.toLowerCase() && state.payments.length)throw new Error('A supplier with recorded payments cannot be reassigned. Cancel, settle any supplier refund and enter the corrected supplier invoice.');
            const duplicate=await tx.$queryRawUnsafe('SELECT id FROM PurchaseInvoice WHERE supplierKey=? AND invoiceKey=? AND id<>?',supplier.toLowerCase(),invoiceNumber.toLowerCase(),purchaseId);
            if(duplicate.length)throw new Error('This supplier invoice is already recorded.');
            const lines=state.lines.map((line:any)=>{
                const row=input.lines!.find(r=>r.lineId===line.id)!;
                const quantity=count(row.quantity),cost=money(row.unitCost);
                if(!cost)throw new Error('Unit cost must be positive.');
                return {...line,quantity,unitCostPaise:cost,returnedQuantity:0,hsn:purchaseHsn(row.hsn??line.hsn)};
            });
            const subtotal=lines.reduce((sum:number,line:any)=>sum+line.quantity*line.unitCostPaise,0),discount=money(input.discount),charges=money(input.charges);
            const tax=purchaseTax(input.tax,subtotal-discount+charges);
            const total=subtotal-discount+charges+(tax?tax.totalTaxPaise+tax.roundOffPaise:0);
            if(!Number.isSafeInteger(subtotal)||subtotal<=0||discount>subtotal||total<=0||total>10_000_000_000)throw new Error('Check corrected quantities, costs, discount and charges.');
            let accumulated=0,allocated=0;
            for(const line of lines) {
                accumulated+=line.quantity*line.unitCostPaise;
                const next=Math.round(accumulated/subtotal*(total-subtotal));
                line.landedTotalPaise=line.quantity*line.unitCostPaise+next-allocated;allocated=next;
                const previous=state.lines.find((old:any)=>old.id===line.id);
                await correctPurchaseCost(tx,previous,line.quantity,line.landedTotalPaise,id);
                await changeStock(tx,line,line.quantity-previous.quantity,id,user,`Purchase correction: ${reason}`,now);
            }
            credit=state.totalPaise-total;
            replacement={header:{supplier,invoiceNumber,invoiceDate,batchName,discountPaise:discount,chargesPaise:charges,...(tax?{tax}:{})},lines};
            // Only lookup keys change; the original supplier/invoice fields remain immutable.
            await tx.$executeRawUnsafe('UPDATE PurchaseInvoice SET supplierKey=?,invoiceKey=? WHERE id=?',supplier.toLowerCase(),invoiceNumber.toLowerCase(),purchaseId);
        } else {
            const selected=input.kind==='CANCEL'?state.lines.map((line:any)=>({lineId:line.id,quantity:line.quantity-line.returnedQuantity})):input.lines;
            if(!selected || !selected.length)throw new Error('Choose the quantities being returned.');
            for(const row of selected) {
                const line=state.lines.find((l:any)=>l.id===row.lineId),quantity=count(row.quantity);
                if(!line||quantity>line.quantity-line.returnedQuantity)throw new Error('Return quantity exceeds the unreturned invoice quantity.');
                if(quantity)deductions.push({lineId:line.id,quantity});
            }
            if(input.kind==='RETURN' && !deductions.length)throw new Error('Select at least one piece to return.');
            credit=input.kind==='CANCEL'?state.totalPaise:money(input.credit);
            if(credit>state.totalPaise)throw new Error('Supplier credit cannot exceed this invoice’s remaining value.');
            for(const row of deductions) {
                const line=state.lines.find((line:any)=>line.id===row.lineId);
                await removePurchaseCost(tx,line,row.quantity,id);
                await changeStock(tx,line,-row.quantity,id,user,`Supplier ${input.kind==='CANCEL'?'cancellation':'return'}: ${reason}`,now);
            }
            if(input.kind==='CANCEL')await tx.$executeRawUnsafe('UPDATE PurchaseInvoice SET invoiceKey=? WHERE id=?',`cancelled:${purchaseId}`,purchaseId);
        }
        await tx.$executeRawUnsafe('INSERT INTO PurchaseAdjustment VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',id,purchaseId,input.kind,reason,credit,replacement?JSON.stringify(replacement):null,replacement?.header.supplier??null,replacement?.header.invoiceNumber??null,replacement?.header.invoiceDate??null,replacement?.header.batchName??null,user.id,now);
        for(const row of deductions)await tx.$executeRawUnsafe('INSERT INTO PurchaseAdjustmentLine VALUES (?, ?, ?)',id,row.lineId,row.quantity);
        const result={id:purchaseId,adjustmentId:id};await record(tx,operationId,hash,user,result);return result;
    },{timeout:20000});
}
export async function refundPurchase(db:any,input:PurchaseRefundInput,user:any) {
    authorize(user);
    const operationId=text(input?.operationId,'Operation ID'),purchaseId=text(input.purchaseId,'Purchase'),amount=money(input.amount),method=mode(input.mode),reason=text(input.reason,'Refund reference / reason',500);
    if(!amount)throw new Error('Enter a positive refund amount.');
    const hash=crypto.createHash('sha256').update(JSON.stringify({action:'SUPPLIER_REFUND',purchaseId,amount,method,reason})).digest('hex');
    await ensurePurchaseSchema(db);
    return db.$transaction(async(tx:any)=>{
        await tx.$executeRawUnsafe('UPDATE CatalogueWriteLock SET token=token WHERE id=1');
        const prior=await replay(tx,operationId,hash,user);if(prior)return prior;
        const state=await readPurchaseState(tx,purchaseId);
        if(amount>state.creditDuePaise)throw new Error('Refund exceeds the amount this supplier owes on the invoice.');
        const now=new Date().toISOString();
        await payment(tx,purchaseId,amount,method,user,now,-1,reason);
        const result={id:purchaseId};await record(tx,operationId,hash,user,{...result,reason});return result;
    });
}
