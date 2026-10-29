import {exchangeRevenue} from './exchange-revenue.service';
import {indiaDay,shiftDay,salesOutlook} from '../src/lib/salesOutlook';
import type {BusinessInsights,SalesDay,StockWatch} from '../src/types/insights';
import {monthlyForecast,shiftMonth} from '../src/lib/monthlyForecast';

const pennies=(value:number)=>{if(!Number.isFinite(value))throw new Error('A saved sales amount is invalid. Check Sales History.');return Math.round(value*100);};
const demo=(name:string)=>/^\s*(?:\[)?DEMO(?:\b|[-_])/i.test(name||'');
const effective=(s:any)=>indiaDay(new Date(s.actualSaleDate||s.createdAt));
const relations={items:true,payments:true,refunds:{include:{items:true}},exchanges:{include:{items:true,payments:true}}};
/** Read-only, cost-free aggregate endpoint. Never claims stock or purchases are complete. */
export async function getBusinessInsights(db:any,user:any,now=new Date()):Promise<BusinessInsights>{
    if(!user?.id||!user.isActive||!(user.role==='ADMIN'||user.permViewInsights))throw new Error('Business insights permission is required.');
    const today=indiaDay(now),through=shiftDay(today,-1),from=shiftMonth(today.slice(0,7),-24)+'-01',recentFrom=shiftDay(today,-28),previousFrom=shiftDay(today,-56);
    const begin=new Date(from+'T00:00:00+05:30'),end=new Date(today+'T00:00:00+05:30');
    return db.$transaction(async(tx:any)=>{
        const filter={status:'COMPLETED',isHistorical:false};
        const [records,refunds,exchanges,products]=await Promise.all([
            tx.sale.findMany({where:{...filter,OR:[{actualSaleDate:{gte:begin,lt:end}},{actualSaleDate:null,createdAt:{gte:begin,lt:end}}]},include:relations}),
            tx.refund.findMany({where:{refundDate:{gte:begin,lt:end},invoice:filter},include:{items:true,invoice:{include:relations}}}),
            tx.exchange.findMany({where:{exchangeDate:{gte:begin,lt:end},invoice:filter},include:{items:true,invoice:{include:relations}}}),
            tx.product.findMany({where:{isActive:true},select:{id:true,name:true,category:{select:{name:true}},variants:{where:{isActive:true},select:{id:true,barcode:true,size:true,stock:true}}}}),
        ]);
        const variants=new Map<string,any>();for(const p of products)for(const v of p.variants)variants.set(v.id,{...v,name:p.name,category:p.category.name,isDemo:demo(p.name)||demo(p.category.name)});
        const eligible=(s:any)=>!demo(s.billNo)&&!s.items.some((i:any)=>demo(i.productName)||variants.get(i.variantId)?.isDemo);
        const all=new Map<string,any>();for(const s of [...records,...refunds.map((r:any)=>r.invoice),...exchanges.map((r:any)=>r.invoice)])if(eligible(s))all.set(s.id,s);
        const reconciliation=await exchangeRevenue(tx,[...all.values()]);
        const daily=new Map<string,SalesDay>(),billedDays=new Map<string,SalesDay>(),units=new Map<string,number>();
        const add=(date:string,paise:number,bills=0)=>{if(date<from||date>=today)return;const row=daily.get(date)||{date,netPaise:0,bills:0};row.netPaise+=paise;row.bills+=bills;daily.set(date,row);};
        const unit=(date:string,id:string,q:number)=>{if(date>=recentFrom&&date<today)units.set(id,(units.get(id)||0)+q);};
        const sales=records.filter(eligible);
        for(const s of sales){const date=effective(s);add(date,pennies(s.grandTotal),1);const billed=billedDays.get(date)||{date,netPaise:0,bills:0};billed.netPaise+=pennies(s.grandTotal);billed.bills++;billedDays.set(date,billed);for(const item of s.items)unit(date,item.variantId,item.quantity);}
        for(const r of refunds)if(eligible(r.invoice)){const date=indiaDay(new Date(r.refundDate));add(date,-pennies(r.totalRefundAmount));for(const i of r.items)unit(date,i.variantId,-i.quantity);}
        for(const ex of exchanges)if(eligible(ex.invoice)){const date=indiaDay(new Date(ex.exchangeDate));for(const i of ex.items)if(i.returnedItemId)unit(date,i.returnedItemId,-i.returnedQty);}
        for(const entry of reconciliation.entries)add(indiaDay(new Date(entry.date)),-entry.returnedCreditPaise);
        const earliest=[...all.values()].map(effective).filter(date=>date<today).sort()[0];
        const first=earliest?(earliest<from?from:earliest):undefined;const history:SalesDay[]=[];
        if(first)for(let date=first;date<today;date=shiftDay(date,1))history.push(daily.get(date)||{date,netPaise:0,bills:0});
        const sum=(a:string,b:string)=>[...daily.values()].filter(d=>d.date>=a&&d.date<b).reduce((n,d)=>n+d.netPaise,0);
        const unresolved=reconciliation.unresolvedBills>0,recent=unresolved?null:sum(recentFrom,today),previous=unresolved||!first||first>previousFrom?null:sum(previousFrom,recentFrom);
        const table=await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='StockVariantTracking'");
        const columns=table.length?await tx.$queryRawUnsafe('PRAGMA table_info(ProductVariant)'):[];
        const tracked=table.length?await tx.$queryRawUnsafe(`SELECT st.variantId,st.activatedAt,${columns.some((c:any)=>c.name==='isPrepared')?'v.isPrepared':'0'} AS prepared FROM StockVariantTracking st JOIN ProductVariant v ON v.id=st.variantId`):[];
        const tracking=new Map<string,any>(tracked.map((t:any)=>[t.variantId,t]));const stock:StockWatch[]=[];let legacy=0,observing=0,invalidCounts=0;
        for(const v of variants.values()){
            if(v.isDemo)continue;const t=tracking.get(v.id);if(!t){legacy++;continue;}if(Number(t.prepared))continue;
            const activated=new Date(t.activatedAt),oldEnough=Number.isFinite(activated.getTime())&&indiaDay(activated)<=recentFrom;
            const valid=Number.isSafeInteger(v.stock)&&v.stock>=0,net=units.get(v.id)||0;
            let status:StockWatch['status']='OK',cover:number|null=null,review:number|null=null;
            if(!valid){status='CHECK_COUNT';invalidCounts++;}
            else if(!oldEnough||!first||first>recentFrom){status='OBSERVING';observing++;}
            else if(net<=0)status='NO_DEMAND';
            else if(net<3){status='OBSERVING';observing++;}
            else{cover=Math.floor(v.stock/(net/28));if(net>=3&&cover<14){status='REVIEW';review=Math.max(0,net-v.stock);}}
            stock.push({id:v.id,name:v.name,barcode:v.barcode,size:v.size,category:v.category,stock:v.stock,netUnits28:net,daysCover:cover,reviewUnits:review,status});
        }
        const priority={CHECK_COUNT:0,REVIEW:1,OBSERVING:2,NO_DEMAND:3,OK:4};stock.sort((a,b)=>priority[a.status]-priority[b.status]||b.netUnits28-a.netUnits28||a.name.localeCompare(b.name));
        const watchCount=stock.filter(v=>v.status==='REVIEW').length;
        const billedHistory=history.map(d=>billedDays.get(d.date)||{date:d.date,netPaise:0,bills:0});
        const categoryTotals=new Map<string,number>();for(const [id,quantity] of units){const name=variants.get(id)?.category||'Earlier catalogue items';if(!variants.get(id)?.isDemo)categoryTotals.set(name,(categoryTotals.get(name)||0)+quantity);}
        return {monthly:monthlyForecast(unresolved?billedHistory:history,today,unresolved?'BILLED':'NET'),categoryDemand:[...categoryTotals].map(([category,netUnits28])=>({category,netUnits28})).sort((a,b)=>b.netUnits28-a.netUnits28),asOf:now.toISOString(),through,recentFrom,recentNetPaise:recent,previousNetPaise:previous,changePercent:recent!==null&&previous!==null&&previous>0?Math.round((recent-previous)/previous*1000)/10:null,bills28:sales.filter((s:any)=>effective(s)>=recentFrom).length,recentBilledPaise:sales.filter((s:any)=>effective(s)>=recentFrom).reduce((n:number,s:any)=>n+pennies(s.grandTotal),0),exchangeIssues:reconciliation.unresolvedSaleIds.map(id=>all.get(id)).filter(Boolean).map(s=>({billNo:s.billNo,date:effective(s)})),unresolvedExchangeBills:reconciliation.unresolvedBills,excludedDemoBills:records.length-sales.length,outlook:salesOutlook(history,today,unresolved),history:unresolved?[]:history.slice(-28),stock,inventory:{tracked:stock.length,legacy,observing,watchCount,invalidCounts}};
    },{timeout:60000});
}
