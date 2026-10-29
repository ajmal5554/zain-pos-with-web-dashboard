import {shiftMonth} from './monthlyForecast';
export interface SeasonReminder {id:string;name:string;date:string}
export interface SeasonAlert {id:string;name:string;start:string;end:string;detail:string;custom:boolean}
export function seasonAlerts(today:string,horizon:number,custom:SeasonReminder[]=[]):SeasonAlert[]{
    const until=shiftMonth(today.slice(0,7),horizon+1)+'-01',year=Number(today.slice(0,4)),result:SeasonAlert[]=[];
    for(let y=year;y<=Number(until.slice(0,4));y++){
        for(const [key,name,start,end,detail] of [
            ['christmas','Christmas range review',`${y}-12-25`,`${y}-12-25`,'Review popular shirt, trouser and kidswear sizes 4–6 weeks beforehand; confirm local demand.'],
            ['newyear','New Year selling period',`${y}-01-01`,`${y}-01-01`,'Review recent fast sellers and supplier delivery dates before the year-end period.'],
            ['summer','Summer assortment planning',`${y}-03-01`,`${y}-05-31`,'Planning window: review lighter fabrics and recent size demand. No weather-related sales increase is assumed.'],
            ['vishu','Vishu preparation window',`${y}-04-01`,`${y}-04-30`,'Planning window, not the festival date. Confirm the local date and review traditional wear and sizes before buying.'],
            ['onam','Onam preparation window',`${y}-08-01`,`${y}-09-30`,'Planning window, not the festival date. Confirm the official dates and review mundu, shirts and size availability 4–6 weeks ahead.'],
        ])if(end>=today&&start<until)result.push({id:`${key}-${y}`,name,start,end,detail,custom:false});
    }
    for(const reminder of custom)if(reminder.date>=today&&reminder.date<until)result.push({id:reminder.id,name:reminder.name,start:reminder.date,end:reminder.date,detail:'Your confirmed planning date. Check supplier lead times, current stock and last season’s sales before committing to an order.',custom:true});
    return result.sort((a,b)=>a.start.localeCompare(b.start));
}
