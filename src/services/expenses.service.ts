import type {ExpenseInput,ExpenseAction,ExpenseQuery,ExpenseList,ExpenseDetail} from '../types/expenses';
export class ExpenseRequestError extends Error {constructor(message:string,public readonly confirmedRejected:boolean){super(message);}}
function api(){const bridge=window.electronAPI?.expenses;if(!bridge)throw new ExpenseRequestError('Expenses are available in the updated desktop POS.',true);return bridge;}
async function result<T>(request:Promise<any>):Promise<T>{
    let response;try{response=await request;}catch{throw new ExpenseRequestError('The result could not be confirmed. Retry this same request.',false);}
    if(!response?.success)throw new ExpenseRequestError(response?.error||'Expense request failed.',response?.outcomeUncertain!==true);
    if(!response.data)throw new ExpenseRequestError('The saved result is uncertain. Retry this same request.',false);
    return response.data;
}
export const expensesService={
    list:(query:ExpenseQuery)=>result<ExpenseList>(api().list(query)),
    detail:(id:string)=>result<ExpenseDetail>(api().detail(id)),
    create:(input:ExpenseInput)=>result<{id:string}>(api().create(input)),
    act:(input:ExpenseAction)=>result<{id:string}>(api().act(input)),
    export:(query:ExpenseQuery)=>result<{csv:string;rowCount:number}>(api().export(query)),
};
