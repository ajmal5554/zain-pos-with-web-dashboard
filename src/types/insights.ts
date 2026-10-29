export interface SalesDay {date:string;netPaise:number;bills:number}
export interface SalesOutlook {
    status:'READY'|'EARLY'|'GAPS'|'UNRECONCILED'|'VOLATILE'|'NO_SALES';reason:string;
    method:'WEEKDAY'|'RECENT_MEAN'|null;nextWeekPaise:number|null;
    backtest:{days:number;maePaise:number;wapePercent:number|null;baselineMaePaise:number}|null;
    points:Array<{date:string;predictedPaise:number}>;historyDays:number;noBillDays:number;
}
export interface StockWatch {
    id:string;name:string;barcode:string;size:string|null;category:string;stock:number;netUnits28:number;
    daysCover:number|null;reviewUnits:number|null;status:'REVIEW'|'OBSERVING'|'NO_DEMAND'|'OK'|'CHECK_COUNT';
}
export interface BusinessInsights {
    monthly:MonthlyPlanning;
    categoryDemand:Array<{category:string;netUnits28:number}>;
    asOf:string;through:string;recentFrom:string;recentNetPaise:number|null;previousNetPaise:number|null;
    changePercent:number|null;bills28:number;unresolvedExchangeBills:number;excludedDemoBills:number;
    recentBilledPaise:number;exchangeIssues:Array<{billNo:string;date:string}>;
    outlook:SalesOutlook;history:SalesDay[];stock:StockWatch[];
    inventory:{tracked:number;legacy:number;observing:number;watchCount:number;invalidCounts:number};
}
export interface MonthlyObservation {month:string;amountPaise:number;bills:number}
export interface MonthProjection {month:string;predictedPaise:number|null;lowerPaise:number|null;upperPaise:number|null;lastYearPaise:number|null}
export interface PeriodComparison {label:string;currentLabel:string;previousLabel:string;currentPaise:number|null;previousPaise:number|null;changePercent:number|null}
export interface MonthlyPlanning {
    basis:'NET'|'BILLED';basisNote:string;history:MonthlyObservation[];projections:MonthProjection[];
    method:'AVERAGE'|'TREND'|'NAIVE'|'DAILY_RUN_RATE'|'NONE';seasonality:boolean;reason:string;
    backtest:{months:number;maePaise:number;wapePercent:number|null}|null;
    currentMonth:{month:string;actualPaise:number;elapsedDays:number;projectedPaise:number|null};
    comparisons:PeriodComparison[];
}
