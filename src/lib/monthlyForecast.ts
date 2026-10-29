import type {SalesDay,MonthlyPlanning,MonthlyObservation,PeriodComparison} from '../types/insights';
import {shiftDay} from './salesOutlook';
export const shiftMonth=(month:string,n:number)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1+n,1)).toISOString().slice(0,7);
const monthDays=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
type Method='AVERAGE'|'TREND'|'NAIVE';
function rate(months:MonthlyObservation[],method:Method,horizon:number,target:string){
    const factors=new Map<string,number>();
    if(months.length>=24&&months.slice(-24).every(m=>m.bills>0)){
        const last=months.slice(-24),overall=mean(last.map(m=>m.amountPaise/monthDays(m.month)));
        if(overall>0)for(let month=1;month<=12;month++){const key=String(month).padStart(2,'0'),same=last.filter(m=>m.month.slice(5)===key);if(same.length>=2)factors.set(key,Math.max(.7,Math.min(1.3,mean(same.map(m=>m.amountPaise/monthDays(m.month)))/overall)));}
    }
    // Remove measured seasonality from the baseline before applying the target season.
    const rates=months.map(m=>m.amountPaise/monthDays(m.month)/(factors.get(m.month.slice(5))||1)),recent=rates.slice(-6),base=mean(rates.slice(-3));
    let result=method==='NAIVE'?rates[rates.length-1]:base;
    if(method==='TREND'&&recent.length>=3){const x=(recent.length-1)/2,y=mean(recent);let numerator=0,denominator=0;recent.forEach((r,i)=>{numerator+=(i-x)*(r-y);denominator+=(i-x)**2;});const bound=Math.abs(base)*.10,slope=Math.max(-bound,Math.min(bound,numerator/(denominator||1)));result=base+slope*horizon*Math.pow(.85,horizon);}
    // Only repeated annual observations can influence calendar-month seasonality.
    result*=factors.get(target.slice(5))||1;
    return Math.max(0,result);
}
/** Complete calendar months train the model; partial-month pace stays separate. */
export function monthlyForecast(days:SalesDay[],today:string,basis:'NET'|'BILLED'):MonthlyPlanning{
    const current=today.slice(0,7),clean=days.filter(d=>d.date<today).sort((a,b)=>a.date.localeCompare(b.date));
    const first=clean[0]?.date,byMonth=new Map<string,MonthlyObservation>();
    for(const day of clean){const key=day.date.slice(0,7),row=byMonth.get(key)||{month:key,amountPaise:0,bills:0};row.amountPaise+=day.netPaise;row.bills+=day.bills;byMonth.set(key,row);}
    const history:MonthlyObservation[]=[];
    if(first){for(let key=first.slice(8)==='01'?first.slice(0,7):shiftMonth(first.slice(0,7),1);key<current;key=shiftMonth(key,1))history.push(byMonth.get(key)||{month:key,amountPaise:0,bills:0});}
    const n=history.length,elapsedDays=Number(today.slice(8))-1,actual=byMonth.get(current)?.amountPaise||0;
    const recent=clean.slice(-28),dailyRate=recent.length>=14?Math.max(0,mean(recent.map(d=>d.netPaise))):null;
    const methods:Method[]=['AVERAGE','TREND','NAIVE'];let method:MonthlyPlanning['method']=n>=2?'AVERAGE':dailyRate!==null?'DAILY_RUN_RATE':'NONE',backtest:MonthlyPlanning['backtest']=null;
    if(n>=6){const errors={AVERAGE:0,TREND:0,NAIVE:0};let magnitude=0,count=0;
        for(let i=Math.max(3,n-6);i<n;i++){const train=history.slice(0,i),target=history[i];for(const m of methods)errors[m]+=Math.abs(Math.round(rate(train,m,1,target.month)*monthDays(target.month))-target.amountPaise);magnitude+=Math.abs(target.amountPaise);count++;}
        method=methods.reduce((best,m)=>errors[m]<errors[best]?m:best,'AVERAGE');backtest={months:count,maePaise:Math.round(errors[method]/count),wapePercent:magnitude?Math.round(errors[method]/magnitude*1000)/10:null};
    }
    const hasPositive=clean.some(d=>d.netPaise>0);if(!hasPositive)method='NONE';
    const rates=history.slice(-6).map(m=>m.amountPaise/monthDays(m.month)),average=mean(rates),deviation=Math.sqrt(mean(rates.map(r=>(r-average)**2)));
    const projections=Array.from({length:6},(_,i)=>{const month=shiftMonth(current,i+1),last=history.find(m=>m.month===shiftMonth(month,-12));
        const lastMonth=history[n-1]?.month,monthsFromOrigin=lastMonth?(Number(month.slice(0,4))-Number(lastMonth.slice(0,4)))*12+Number(month.slice(5))-Number(lastMonth.slice(5)):i+1;
        const estimate=method==='NONE'?null:Math.round((method==='DAILY_RUN_RATE'?dailyRate!:rate(history,method as Method,monthsFromOrigin,month))*monthDays(month));
        // Planning scenarios, not a claimed confidence interval; widen at longer horizons.
        const spread=estimate===null?0:Math.round(Math.max(estimate*(method==='DAILY_RUN_RATE'?0.50:backtest?0.15:0.30),deviation*monthDays(month),backtest?.maePaise||0)*Math.sqrt(i+1));
        return {month,predictedPaise:estimate,lowerPaise:estimate===null?null:Math.max(0,estimate-spread),upperPaise:estimate===null?null:estimate+spread,lastYearPaise:last?.amountPaise??null};});
    const total=(start:string,count:number)=>!first||first>start?null:clean.filter(d=>d.date>=start&&d.date<shiftDay(start,count)).reduce((v,d)=>v+d.netPaise,0);
    const comparisons:PeriodComparison[]=[];
    for(const offset of [-1,-12]){const prior=shiftMonth(current,offset),matched=Math.min(elapsedDays,monthDays(prior));const a=matched?total(current+'-01',matched):null,b=matched?total(prior+'-01',matched):null;comparisons.push({label:offset===-1?'Month-to-date vs last month':'Month-to-date vs last year',currentLabel:`${current} · first ${matched} days`,previousLabel:`${prior} · first ${matched} days`,currentPaise:a,previousPaise:b,changePercent:a!==null&&b!==null&&b>0?Math.round((a-b)/b*1000)/10:null});}
    const previous=history[n-2],latest=history[n-1];comparisons.push({label:'Last two completed months',currentLabel:latest?.month||'No completed month',previousLabel:previous?.month||'No previous month',currentPaise:latest?.amountPaise??null,previousPaise:previous?.amountPaise??null,changePercent:latest&&previous&&previous.amountPaise>0?Math.round((latest.amountPaise-previous.amountPaise)/previous.amountPaise*1000)/10:null});
    const reason=method==='NONE'?'More recorded sales are needed to estimate these months.':method==='DAILY_RUN_RATE'?'Early projection from recent completed-day pace; there are not yet two full months.':backtest?`Model selected using ${backtest.months} past-only monthly tests. Longer-range scenarios remain uncertain.`:'Limited monthly history: a recent daily-rate average is used; monthly backtesting needs at least six complete months.';
    return {basis,basisNote:basis==='NET'?'Recorded sales after dated refunds and reconciled exchange credit.':'Billed sales before returns and exchange-credit reversals; includes replacement bill value. This is not net revenue or profit.',history,projections,method,seasonality:n>=24&&history.slice(-24).every(m=>m.bills>0),reason,backtest,currentMonth:{month:current,actualPaise:actual,elapsedDays,projectedPaise:elapsedDays>=7&&first&&first<=current+'-01'?Math.round(actual/elapsedDays*monthDays(current)):null},comparisons};
}
