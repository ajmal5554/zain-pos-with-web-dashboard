import {getSaleCosts} from './stock-cost.service';
import {exchangeRevenue} from './exchange-revenue.service';

const paise=(value:number)=>{if(!Number.isFinite(value))throw new Error('Invalid financial amount in saved records.');return Math.round(value*100);};
export interface ProfitReport {
    from:string;to:string;bills:number;billedPaise:number;discountPaise:number;refundPaise:number;netSalesPaise:number|null;
    knownCostPaise:number;missingBills:number;unknownPieces:number;heldCostPaise:number;heldUnknown:number;exchangeBills:number;laterReturns:number;
    expensePaise:number;reviewAmountPaise:number;reviewCount:number;grossProfitPaise:number|null;operatingProfitPaise:number|null;marginPercent:number|null;
    products:Array<{name:string;quantity:number;billedPaise:number}>;
    exchangeReversalPaise:number;surplusCreditIssuedPaise:number;unresolvedExchangeBills:number;
}
function day(value:unknown):string{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new Error('Choose a valid date range.');
    return value;
}
/** Read-only invoice-cohort analysis. Never guesses costs or exchange revenue. */
export async function getProfitReport(db:any,input:any,user:any):Promise<ProfitReport>{
    if(!user?.isActive||user.role!=='ADMIN')throw new Error('Only the owner can view business profit.');
    const from=day(input?.from),to=day(input?.to);
    if(from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw new Error('Choose a date range of up to one year.');
    const start=new Date(`${from}T00:00:00+05:30`),end=new Date(Date.parse(`${to}T00:00:00+05:30`)+86400000);
    return db.$transaction(async(tx:any)=>{
        const sales=await tx.sale.findMany({where:{status:'COMPLETED',isHistorical:false,OR:[{actualSaleDate:{gte:start,lt:end}},{actualSaleDate:null,createdAt:{gte:start,lt:end}}]},include:{items:true,refunds:true,exchanges:{include:{items:true,payments:true}},payments:true}});
        let billed=0,discount=0,refunds=0,knownCost=0,missingBills=0,unknownPieces=0,heldCost=0,heldUnknown=0,exchangeBills=0,laterReturns=0;
        const products=new Map<string,{name:string;quantity:number;billedPaise:number}>();
        for(const sale of sales){
            billed+=paise(sale.grandTotal);discount+=paise(sale.discount);
            refunds+=sale.refunds.reduce((n:number,r:any)=>n+paise(r.totalRefundAmount),0);
            if(sale.exchanges.length||sale.payments.some((p:any)=>p.paymentMode==='EXCHANGE_CREDIT')||sale.paymentMethod==='EXCHANGE'||sale.remarks?.startsWith('Replacement sale for Invoice #'))exchangeBills++;
            if(sale.refunds.some((r:any)=>new Date(r.refundDate)>=end)||sale.exchanges.some((r:any)=>new Date(r.exchangeDate)>=end))laterReturns++;
            const costs=await getSaleCosts({...tx,$transaction:(work:any)=>work(tx)},{saleId:sale.id},user);
            knownCost+=costs.knownCostPaise;unknownPieces+=costs.unknownQuantity;heldCost+=costs.heldCostPaise;heldUnknown+=costs.heldUnknownQuantity;
            if(costs.status!=='CAPTURED')missingBills++;
            for(const item of sale.items){const row=products.get(item.productName)||{name:item.productName,quantity:0,billedPaise:0};row.quantity+=item.quantity;row.billedPaise+=paise(item.total);products.set(item.productName,row);}
        }
        const tables=new Set((await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table'")).map((r:any)=>r.name));
        let expenses=0,reviewAmount=0,reviewCount=0;
        if(tables.has('ShopExpense')){
            const rows=await tx.$queryRawUnsafe("SELECT status,amountPaise FROM ShopExpense WHERE expenseDate>=? AND expenseDate<=?",from,to);
            for(const row of rows)if(row.status==='ACTIVE')expenses+=Number(row.amountPaise);
        }
        if(tables.has('CashRegister')&&tables.has('CashDrawerTx')){
            const rows=await tx.$queryRawUnsafe(`SELECT ct.amount FROM CashDrawerTx ct JOIN CashRegister cr ON cr.id=ct.registerId WHERE cr.date>=? AND cr.date<=? AND ct.type='CASH_OUT' AND ct.category IN ('EXPENSE','FREIGHT','MUNICIPALITY') ${tables.has('ShopExpense')?'AND NOT EXISTS(SELECT 1 FROM ShopExpense e WHERE e.drawerTxId=ct.id)':''} ${tables.has('PurchasePayment')?'AND NOT EXISTS(SELECT 1 FROM PurchasePayment p WHERE p.drawerTxId=ct.id)':''}`,from,to);
            reviewCount=rows.length;reviewAmount=rows.reduce((n:number,r:any)=>n+paise(r.amount),0);
        }
        const exchange=await exchangeRevenue(tx,sales);
        const netSales=exchange.unresolvedBills?null:billed-refunds-exchange.reversalPaise;
        const grossProfit=netSales===null||missingBills||heldUnknown?null:netSales-knownCost-heldCost;
        const operatingProfit=grossProfit===null||reviewCount||laterReturns?null:grossProfit-expenses;
        return {from,to,bills:sales.length,billedPaise:billed,discountPaise:discount,refundPaise:refunds,netSalesPaise:netSales,knownCostPaise:knownCost,missingBills,unknownPieces,heldCostPaise:heldCost,heldUnknown,exchangeBills,laterReturns,expensePaise:expenses,reviewAmountPaise:reviewAmount,reviewCount,grossProfitPaise:grossProfit,operatingProfitPaise:operatingProfit,exchangeReversalPaise:exchange.reversalPaise,surplusCreditIssuedPaise:exchange.surplusIssuedPaise,unresolvedExchangeBills:exchange.unresolvedBills,marginPercent:grossProfit!==null&&netSales!==null&&netSales>0?grossProfit/netSales*100:null,products:[...products.values()].sort((a,b)=>b.billedPaise-a.billedPaise).slice(0,20)};
    },{timeout:60000});
}
