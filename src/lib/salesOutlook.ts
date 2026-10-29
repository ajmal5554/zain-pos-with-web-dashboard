import type {SalesDay,SalesOutlook} from '../types/insights';
export const shiftDay=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const indiaDay=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const mean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;
function predict(values:number[],method:'WEEKDAY'|'RECENT_MEAN'){
    const observations=method==='WEEKDAY'?[7,14,21,28].filter(lag=>lag<=values.length).map(lag=>values[values.length-lag]):values.slice(-7);
    return Math.max(0,Math.round(mean(observations)));
}
/** Completed calendar days only. Rolling origins never use a future observation. */
export function salesOutlook(days:SalesDay[],today:string,unresolved=false):SalesOutlook{
    const clean=days.filter(d=>d.date<today),n=clean.length;
    const base:SalesOutlook={status:'EARLY',reason:'At least 28 completed calendar days of recorded sales are needed.',method:null,nextWeekPaise:null,backtest:null,points:[],historyDays:n,noBillDays:clean.filter(d=>!d.bills).length};
    if(unresolved)return {...base,status:'UNRECONCILED',reason:'Exchange records need reconciliation before a sales outlook can be calculated.'};
    if(clean.some((d,i)=>!Number.isSafeInteger(d.netPaise)||(i>0&&d.date!==shiftDay(clean[i-1].date,1))))return {...base,status:'GAPS',reason:'Calendar records are incomplete or invalid. Check the sales data before forecasting.'};
    if(!n||!clean.some(d=>d.netPaise>0))return {...base,status:'NO_SALES',reason:'There is not enough positive recorded sales activity for an outlook.'};
    if(n<28)return base;
    let gap=0,maxGap=0;for(const d of clean.slice(-56)){gap=d.bills?0:gap+1;maxGap=Math.max(gap,maxGap);}
    if(maxGap>=7)return {...base,status:'GAPS',reason:'There are seven or more consecutive days without bills. Check closures or missing records before forecasting.'};
    const values=clean.map(d=>d.netPaise),start=Math.max(14,n-28),errors={WEEKDAY:0,RECENT_MEAN:0};let magnitude=0;
    for(let i=start;i<n;i++){const training=values.slice(0,i);for(const method of ['WEEKDAY','RECENT_MEAN'] as const)errors[method]+=Math.abs(predict(training,method)-values[i]);magnitude+=Math.abs(values[i]);}
    const method=errors.WEEKDAY<=errors.RECENT_MEAN?'WEEKDAY':'RECENT_MEAN',count=n-start;
    const wape=magnitude?errors[method]/magnitude*100:null;
    const backtest={days:count,maePaise:Math.round(errors[method]/count),wapePercent:wape===null?null:Math.round(wape*10)/10,baselineMaePaise:Math.round(errors.RECENT_MEAN/count)};
    if(wape===null||wape>50)return {...base,status:'VOLATILE',backtest,reason:'Recent test error is too large for a useful sales estimate. Review actual sales instead.'};
    const points=[];const rolling=[...values];for(let i=0;i<7;i++){const predictedPaise=predict(rolling,method);points.push({date:shiftDay(today,i),predictedPaise});rolling.push(predictedPaise);}
    return {...base,status:'READY',reason:`${n<56?'Limited history: treat this estimate cautiously. ':''}A seven-day statistical estimate, not a sales target or profit guarantee.`,method,backtest,points,nextWeekPaise:points.reduce((n,p)=>n+p.predictedPaise,0)};
}
