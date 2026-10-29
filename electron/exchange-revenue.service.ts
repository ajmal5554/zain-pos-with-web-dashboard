const money=(value:any)=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*100):NaN;
const integer=(value:any)=>(typeof value==='number'||typeof value==='bigint')&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
const amounts=(payments:any[],credit:boolean)=>payments.filter(p=>(p.paymentMode==='EXCHANGE_CREDIT')===credit).reduce((n,p)=>n+money(p.amount),0);
function quantities(items:any[],id:string,quantity:string){
    const result=new Map<string,number>();
    for(const item of items){if(!item[id])continue;const q=item[quantity];if(!Number.isSafeInteger(q)||q<0)return null;if(q)result.set(item[id],(result.get(item[id])||0)+q);}
    return result;
}
function same(a:Map<string,number>|null,b:Map<string,number>|null){return !!a&&!!b&&a.size===b.size&&[...a].every(([id,q])=>b.get(id)===q);}

/** Reconcile exact saved exchange links and amounts; no report read creates or repairs data. */
export async function exchangeRevenue(tx:any,sales:any[]){
    const snapshots=new Map<string,any>(),byReplacement=new Map<string,any>();
    const present=await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='ExchangeRevenue'");
    if(present.length){
        const ids=sales.map(s=>s.id);
        for(let offset=0;offset<ids.length;offset+=200){const part=ids.slice(offset,offset+200),marks=part.map(()=>'?').join(',');
            const rows=await tx.$queryRawUnsafe(`SELECT * FROM ExchangeRevenue WHERE originalSaleId IN (${marks}) OR replacementSaleId IN (${marks})`,...part,...part);
            for(const row of rows){snapshots.set(row.exchangeId,row);byReplacement.set(row.replacementSaleId,row);}
        }
    }
    const relevant=sales.some(s=>s.exchanges.length||byReplacement.has(s.id)||s.payments.some((p:any)=>p.paymentMode==='EXCHANGE_CREDIT')||s.paymentMethod==='EXCHANGE'||s.remarks?.startsWith('Replacement sale for Invoice #'));
    const entries:Array<{exchangeId:string;date:string;returnedCreditPaise:number}>=[];
    if(!relevant)return {reversalPaise:0,surplusIssuedPaise:0,unresolvedBills:0,unresolvedSaleIds:[] as string[],entries};
    const audits:any[]=[];
    for(const row of await tx.auditLog.findMany({where:{action:'EXCHANGE'},select:{details:true}})){
        try{const value=JSON.parse(row.details);if(value.version===2&&value.type==='EXCHANGE')audits.push(value);}catch{/* Unusable older records remain unresolved. */}
    }
    const cache=new Map<string,Promise<any>>(),selected=new Map(sales.map(s=>[s.id,s]));
    const sale=async(id:string)=>selected.get(id)||tx.sale.findUnique({where:{id},include:{items:true,payments:true}});
    function reconcile(ex:any,original:any){
        if(cache.has(ex.id))return cache.get(ex.id)!;
        const work=(async()=>{
            let saved=snapshots.get(ex.id),replacement:any;
            if(!saved){
                const candidates=[];
                for(const audit of audits.filter(a=>a.originalInvoiceId===original.id&&typeof a.replacementSaleId==='string')){
                    const found=await sale(audit.replacementSaleId);
                    if(found?.remarks?.includes(`Exchange Ref: ${ex.id}.`))candidates.push({audit,found});
                }
                if(candidates.length!==1)return null;
                const {audit,found}=candidates[0];replacement=found;
                saved={originalSaleId:original.id,replacementSaleId:found.id,returnedCreditPaise:money(audit.returnedTotal),replacementValuePaise:money(found.grandTotal),appliedCreditPaise:money(audit.exchangeCreditApplied),surplusCreditPaise:money(audit.storeCreditBalance),freshPaymentPaise:money(audit.netPayable)};
            }else replacement=await sale(saved.replacementSaleId);
            const fields=['returnedCreditPaise','replacementValuePaise','appliedCreditPaise','surplusCreditPaise','freshPaymentPaise'];
            if(fields.some(f=>!integer(saved[f])))return null;
            const values=Object.fromEntries(fields.map(f=>[f,Number(saved[f])]));
            if(saved.originalSaleId!==original.id||!replacement||replacement.status!=='COMPLETED'||replacement.isHistorical||original.status!=='COMPLETED'||original.isHistorical)return null;
            if(!replacement.remarks?.includes(`Exchange Ref: ${ex.id}.`))return null;
            const returned=quantities(ex.items,'returnedItemId','returnedQty'),issued=quantities(ex.items,'newItemId','newQty');
            if(!returned?.size||!issued?.size||!same(issued,quantities(replacement.items,'variantId','quantity')))return null;
            let returnedValue=0;
            for(const [id,q] of returned){const rows=original.items.filter((i:any)=>i.variantId===id);if(rows.length!==1||q>rows[0].quantity)return null;returnedValue+=money(rows[0].sellingPrice)*q;}
            if(returnedValue!==values.returnedCreditPaise||money(replacement.grandTotal)!==values.replacementValuePaise)return null;
            if(values.appliedCreditPaise!==Math.min(values.returnedCreditPaise,values.replacementValuePaise)||values.surplusCreditPaise!==Math.max(0,values.returnedCreditPaise-values.replacementValuePaise)||values.freshPaymentPaise!==Math.max(0,values.replacementValuePaise-values.returnedCreditPaise))return null;
            if(money(ex.differenceAmount)!==values.replacementValuePaise-values.returnedCreditPaise||amounts(replacement.payments,true)!==values.appliedCreditPaise||amounts(replacement.payments,false)!==values.freshPaymentPaise||amounts(ex.payments,false)!==values.freshPaymentPaise||amounts(ex.payments,true)!==0)return null;
            return {...values,replacementSaleId:replacement.id,originalSaleId:original.id};
        })();cache.set(ex.id,work);return work;
    }
    let reversalPaise=0,surplusIssuedPaise=0;const unresolved=new Set<string>();
    for(const current of sales){
        for(const ex of current.exchanges){const result=await reconcile(ex,current);if(!result)unresolved.add(current.id);else{reversalPaise+=result.returnedCreditPaise;surplusIssuedPaise+=result.surplusCreditPaise;entries.push({exchangeId:ex.id,date:new Date(ex.exchangeDate).toISOString(),returnedCreditPaise:result.returnedCreditPaise});}}
        if(byReplacement.has(current.id)||current.payments.some((p:any)=>p.paymentMode==='EXCHANGE_CREDIT')||current.paymentMethod==='EXCHANGE'||current.remarks?.startsWith('Replacement sale for Invoice #')){
            const linked=byReplacement.get(current.id),refs=[...String(current.remarks||'').matchAll(/Exchange Ref: ([^.\s]+)\./g)];
            const id=linked?.exchangeId||(refs.length===1?refs[0][1]:null);
            const ex=id?await tx.exchange.findUnique({where:{id},include:{items:true,payments:true,invoice:{include:{items:true}}}}):null;
            if(!ex||!(await reconcile(ex,ex.invoice)))unresolved.add(current.id);
        }
    }
    return {reversalPaise,surplusIssuedPaise,unresolvedBills:unresolved.size,unresolvedSaleIds:[...unresolved],entries};
}
