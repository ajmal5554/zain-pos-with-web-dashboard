import React,{useEffect,useState} from 'react';
import {useAuthStore} from '../../store/authStore';
type Summary={status:'CAPTURED'|'UNKNOWN_COST'|'NOT_CAPTURED';knownCostPaise:number;unknownQuantity:number;heldCostPaise:number;heldUnknownQuantity:number};
const money=(value:number)=>(value/100).toLocaleString('en-IN',{style:'currency',currency:'INR'});
export const SaleCostSummary:React.FC<{saleId:string;version?:string|Date}>=({saleId,version})=>{
    const user=useAuthStore(s=>s.user);
    const allowed=!!user&&user.isActive!==false&&(user.role==='ADMIN'||(user.permViewSales&&user.permViewCostPrice));
    const [data,setData]=useState<Summary|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
    useEffect(()=>{
        let current=true;setData(null);setError('');
        if(!allowed)return;
        (async()=>{
            try{
                const api=window.electronAPI?.saleCosts;
                if(!api)throw new Error('Batch costs are available in the updated desktop POS.');
                const result=await api.get(saleId);
                if(!result.success||!result.data)throw new Error(result.error||'Could not read saved batch costs.');
                if(current)setData(result.data);
            }catch(failure){if(current)setError((failure as Error).message);}
        })();
        return()=>{current=false;};
    },[saleId,version,allowed,user?.id,retry]);
    if(!allowed)return null;
    return <div className="border rounded-lg p-3 text-sm dark:border-gray-700 space-y-1">
        <h4 className="font-semibold">Recorded batch costs</h4>
        {error?<p className="text-amber-600">{error} <button className="underline" onClick={()=>setRetry(n=>n+1)}>Retry</button></p>:!data?<p className="text-gray-500">Loading recorded costs…</p>:<>
            {data.status==='CAPTURED'?<p>Cost of remaining sold items: <strong>{money(data.knownCostPaise)}</strong></p>:<p className="text-amber-600">{data.status==='NOT_CAPTURED'?'Costs were not captured for this earlier sale.':`${data.unknownQuantity || 'Some'} pieces have no reliable cost.`} Profit unavailable.</p>}
            {data.status==='UNKNOWN_COST'&&data.knownCostPaise>0&&<p>Known portion only: {money(data.knownCostPaise)}.</p>}
            {(data.heldCostPaise>0||data.heldUnknownQuantity>0)&&<p className="text-amber-600">Held returns are outside saleable stock: {data.heldCostPaise>0?money(data.heldCostPaise):'unknown cost'}{data.heldUnknownQuantity>0?` plus ${data.heldUnknownQuantity} pieces with unknown cost`:''}. Their loss needs separate accounting.</p>}
            <p className="text-xs text-gray-500">Saved from receipt batches at sale time. Later purchases do not change these costs. This is a cost record, not a profit report.</p>
        </>}
    </div>;
};
