import {PurchaseTaxFields} from './PurchaseTaxFields';
import React, {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Modal} from '../ui/Modal';
import {ConfirmDialog} from '../ui/ConfirmDialog';
import {showToast} from '../ui/Toast';
import {useAuthStore} from '../../store/authStore';
import {purchasesService,PurchaseRequestError} from '../../services/purchases.service';
import type {PurchaseDetail,PurchaseAdjustmentInput,PurchaseRefundInput,PurchasePaymentMode,PurchaseTaxInput} from '../../types/purchases';

type Kind='RETURN'|'CANCEL'|'CORRECTION'|'REFUND';
type ActionForm={tax?:PurchaseTaxInput;kind:Kind;invoice:PurchaseDetail;reason:string;credit:number;mode:PurchasePaymentMode;
    supplier:string;invoiceNumber:string;invoiceDate:string;batchName:string;discount:number;charges:number;
    lines:Array<{lineId:string;quantity:number;unitCost:number;hsn?:string}>;request:PurchaseAdjustmentInput|PurchaseRefundInput|null};
const labels:Record<Kind,string>={RETURN:'Return goods to supplier',CANCEL:'Cancel purchase',CORRECTION:'Correct invoice',REFUND:'Record supplier refund'};
const money=(paise:number)=>(paise/100).toLocaleString('en-IN',{style:'currency',currency:'INR'});
const control='w-full border rounded-lg px-3 py-2 bg-white dark:bg-gray-800 dark:border-gray-700';
const button='rounded-lg px-3 py-2 border dark:border-gray-700 disabled:opacity-40';
export const PurchaseActions:React.FC<{detail:PurchaseDetail|null;disabled?:boolean;onSaved:(id:string)=>Promise<void>;onBlockedChange:(blocked:boolean)=>void}>=({detail,disabled,onSaved,onBlockedChange})=>{
    const user=useAuthStore(s=>s.user),key=`purchase-action-v1:${user?.id}`;
    const [form,setForm]=useState<ActionForm|null>(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||'null');return saved?.request?.operationId&&saved?.invoice?.id?saved:null;}catch{return null;}});
    const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
    const inFlight=useRef(false);
    const frozen=!!form?.request;
    useEffect(()=>{onBlockedChange(!!form||busy);},[!!form,busy,onBlockedChange]);
    function start(kind:Kind){
        if(!detail||disabled||form)return;
        setForm({kind,invoice:detail,reason:'',credit:kind==='REFUND'?detail.creditDuePaise/100:0,mode:'UPI',
            supplier:detail.supplier,invoiceNumber:detail.invoiceNumber,invoiceDate:detail.invoiceDate,batchName:detail.batchName,
            discount:detail.discountPaise/100,charges:detail.chargesPaise/100,
            tax:detail.tax?{supplierGstin:detail.tax.supplierGstin,cgst:detail.tax.cgstPaise/100,sgst:detail.tax.sgstPaise/100,igst:detail.tax.igstPaise/100,roundOff:detail.tax.roundOffPaise/100,itcStatus:'PENDING'}:undefined,
            lines:detail.lines.map(line=>({lineId:line.id,quantity:kind==='CORRECTION'?line.quantity:0,unitCost:line.unitCostPaise/100,...(line.hsn?{hsn:line.hsn}:{})})),request:null});
    }
    function update(patch:Partial<ActionForm>){if(!busy&&!frozen)setForm(f=>f?{...f,...patch}:null);}
    function quantity(lineId:string,value:number){
        if(!form||frozen||busy)return;
        const lines=form.lines.map(line=>line.lineId===lineId?{...line,quantity:value}:line);
        if(form.kind==='RETURN'){
            const credit=lines.reduce((sum,line)=>{const original=form.invoice.lines.find(o=>o.id===line.lineId)!;
                if(!original.quantity)return sum;
                return sum+Math.round((original.returnedQuantity+line.quantity)/original.quantity*original.landedTotalPaise)-Math.round(original.returnedQuantity/original.quantity*original.landedTotalPaise);},0);
            update({lines,credit:Math.min(form.invoice.totalPaise,credit)/100});
        }else update({lines});
    }
    async function save(){
        if(!form||inFlight.current)return;
        inFlight.current=true;setBusy(true);
        const request=form.request||(form.kind==='REFUND'?{operationId:crypto.randomUUID(),purchaseId:form.invoice.id,amount:form.credit,mode:form.mode,reason:form.reason}:
            {operationId:crypto.randomUUID(),purchaseId:form.invoice.id,expectedRevision:form.invoice.revision,kind:form.kind,reason:form.reason,credit:form.credit,
                ...(form.kind==='CORRECTION'?{supplier:form.supplier,invoiceNumber:form.invoiceNumber,invoiceDate:form.invoiceDate,batchName:form.batchName,discount:form.discount,charges:form.charges,lines:form.lines,...(form.tax?{tax:form.tax}:{})}:{lines:form.lines.map(line=>({lineId:line.lineId,quantity:line.quantity}))})});
        const pending={...form,request};
        try{
            localStorage.setItem(key,JSON.stringify(pending));setForm(pending);
            const result=form.kind==='REFUND'?await purchasesService.refund(request as PurchaseRefundInput):await purchasesService.adjust(request as PurchaseAdjustmentInput);
            localStorage.removeItem(key);setForm(null);setConfirm(false);
            showToast('Purchase history, stock and supplier balance updated.','success');await onSaved(result.id);
        }catch(error){
            if(error instanceof PurchaseRequestError&&error.confirmedRejected){localStorage.removeItem(key);setForm(previous=>previous?{...previous,request:null}:null);}
            showToast((error as Error).message,'error');setConfirm(false);
        }finally{inFlight.current=false;setBusy(false);}
    }
    const revisedTotal=form?form.lines.reduce((sum,line)=>sum+Math.round(line.unitCost*100)*line.quantity,0)-Math.round(form.discount*100)+Math.round(form.charges*100)+(form.tax?Math.round(form.tax.cgst*100)+Math.round(form.tax.sgst*100)+Math.round(form.tax.igst*100)+Math.round(form.tax.roundOff*100):0):0;
    return <>
        {detail&&<div className="flex flex-wrap gap-2 border-t pt-4 dark:border-gray-700">
            {detail.status!=='CANCELLED'&&<>
                <button className={button} disabled={disabled||!!form||detail.adjustments?.some(a=>a.kind==='RETURN')} title={detail.adjustments?.some(a=>a.kind==='RETURN')?'This invoice has supplier returns. Cancel the remainder and enter a replacement invoice to correct it.':undefined} onClick={()=>start('CORRECTION')}>Correct invoice</button>
                <button className={button} disabled={disabled||!!form} onClick={()=>start('RETURN')}>Return goods</button>
                <button className={`${button} text-red-600`} disabled={disabled||!!form} onClick={()=>start('CANCEL')}>Cancel purchase</button>
            </>}
            {detail.adjustments?.some(a=>a.kind==='RETURN')&&<p className="w-full text-xs text-gray-500">This invoice has supplier returns. To correct its details, cancel the remainder and enter a replacement invoice.</p>}
            {detail.creditDuePaise>0&&<button className={button} disabled={disabled||!!form} onClick={()=>start('REFUND')}>Record refund received</button>}
        </div>}
        {createPortal(<>
        <Modal isOpen={!!form} onClose={()=>{if(!busy&&!frozen)setForm(null);}} title={form?labels[form.kind]:'Purchase action'} size="xl">{form&&<div className="space-y-4">
            <p><strong>{form.invoice.supplier} · {form.invoice.invoiceNumber}</strong></p>
            {frozen&&<p role="alert" className="text-amber-600">This request needs confirmation. Retry it unchanged; it may already have saved.</p>}
            <fieldset disabled={busy||frozen||confirm} className="space-y-4 disabled:opacity-60">
                {form.kind==='CORRECTION'&&<div className="grid md:grid-cols-2 gap-3">
                    {(['supplier','invoiceNumber','batchName','invoiceDate'] as const).map(field=><label className="block" key={field}>{({supplier:'Supplier',invoiceNumber:'Invoice number',batchName:'Batch name',invoiceDate:'Invoice date'})[field]}<input className={control} type={field==='invoiceDate'?'date':'text'} maxLength={200} disabled={field==='supplier' && form.invoice.payments.length>0} value={form[field]} onChange={e=>update({[field]:e.target.value})}/></label>)}
                </div>}
                {(form.kind==='RETURN'||form.kind==='CORRECTION')&&<div className="overflow-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Item / barcode</th><th className="p-2">Received / already returned</th><th className="p-2">Stock now</th><th className="p-2">{form.kind==='RETURN'?'Return quantity':'Correct quantity'}</th>{form.kind==='CORRECTION'&&<th className="p-2">Correct cost / piece (₹)</th>}</tr></thead><tbody>{form.lines.map(line=>{
                    const original=form.invoice.lines.find(o=>o.id===line.lineId)!;
                    return <tr key={line.lineId} className="border-t"><td className="p-2 min-w-48">{original.name} · {original.size}<p className="text-xs">{original.barcode}</p></td><td className="p-2">{original.quantity} / {original.returnedQuantity}</td><td className="p-2">{original.stock}{original.batchQuantityAvailable != null && <p className="text-xs text-gray-500">This batch: {original.batchQuantityAvailable}</p>}</td><td className="p-2"><input aria-label={`Action quantity ${original.barcode}`} className={`${control} min-w-24`} type="number" min="0" step="1" max={form.kind==='RETURN'?Math.max(0,Math.min(original.stock,original.quantity-original.returnedQuantity,original.batchQuantityAvailable ?? Infinity)):1000000} value={line.quantity} onWheel={e=>e.currentTarget.blur()} onChange={e=>quantity(line.lineId,Number(e.target.value))}/></td>{form.kind==='CORRECTION'&&<td className="p-2"><input aria-label={`Correct cost ${original.barcode}`} className={`${control} min-w-24`} type="number" min="0.01" step="0.01" value={line.unitCost} onWheel={e=>e.currentTarget.blur()} onChange={e=>update({lines:form.lines.map(row=>row.lineId===line.lineId?{...row,unitCost:Number(e.target.value)}:row)})}/></td>}</tr>;
                })}</tbody></table></div>}
                {form.kind==='CORRECTION'&&<><div className="grid md:grid-cols-2 gap-3">{(['discount','charges'] as const).map(field=><label className="block" key={field}>{field==='discount'?'Invoice discount (₹)':'Invoice charges (₹)'}<input className={control} type="number" min="0" step="0.01" value={form[field]} onWheel={e=>e.currentTarget.blur()} onChange={e=>update({[field]:Number(e.target.value)})}/></label>)}</div>{form.tax&&<PurchaseTaxFields value={form.tax} onChange={tax=>update({tax})}/>}<p>Corrected invoice total: <strong>{money(revisedTotal)}</strong>. Recorded payments stay in history.</p>{form.invoice.payments.length>0&&<p className="text-xs text-gray-500">Supplier changes are locked because payments are recorded. Cancel and settle any refund before entering a replacement invoice for another supplier.</p>}<p className="text-sm text-gray-500">Quantities replace the invoice quantities; stock changes by the difference. Prices and barcodes stay unchanged. To replace the item or correct an invoice that already has returns, cancel it and enter a new invoice.</p></>}
                {form.kind==='RETURN'&&<label className="block">Supplier credit agreed (₹)<input className={control} type="number" min="0" max={form.invoice.totalPaise/100} step="0.01" value={form.credit} onWheel={e=>e.currentTarget.blur()} onChange={e=>update({credit:Number(e.target.value)})}/><span className="block mt-1 text-xs text-gray-500">Suggested from invoice costs and quantities; change this to the amount agreed with the supplier. A credit note reduces the invoice balance; it does not record cash received.</span></label>}
                {form.kind==='CANCEL'&&<p className="p-3 bg-red-50 text-red-800 rounded-lg">This reverses all unreturned invoice quantities and reduces its remaining invoice value by {money(form.invoice.totalPaise)}. Enough stock must still be available. Payments remain recorded; any overpayment becomes a supplier refund due. The original invoice is preserved.</p>}
                {form.kind==='REFUND'&&<><p>Supplier owes you: <strong>{money(form.invoice.creditDuePaise)}</strong>. Record only money already received.</p><label className="block">Refund received (₹)<input className={control} type="number" min="0.01" step="0.01" max={form.invoice.creditDuePaise/100} value={form.credit} onWheel={e=>e.currentTarget.blur()} onChange={e=>update({credit:Number(e.target.value)})}/></label><label className="block">Received into<select className={control} value={form.mode} onChange={e=>update({mode:e.target.value as PurchasePaymentMode})}><option value="UPI">UPI</option><option value="BANK">Bank transfer</option><option value="CASH_DRAWER">Shop cash drawer</option><option value="PERSONAL_CASH">Personal cash (outside drawer)</option></select></label></>}
                <label className="block">Reason / credit-note reference<input className={control} maxLength={500} value={form.reason} onChange={e=>update({reason:e.target.value})}/></label>
            </fieldset>
            <div className="flex justify-end gap-3"><button className={button} disabled={busy||frozen} onClick={()=>setForm(null)}>Close</button><button className="bg-primary-600 text-white px-4 py-2 rounded-lg disabled:opacity-40" disabled={busy||!form.reason.trim()} onClick={()=>setConfirm(true)}>{frozen?'Retry unchanged request':'Review & confirm'}</button></div>
        </div>}</Modal>
        <ConfirmDialog isOpen={confirm} onClose={()=>!busy&&setConfirm(false)} onConfirm={save} title={form?labels[form.kind]:'Confirm'} message={form?.kind==='REFUND'?`Record ${money(form.credit*100)} already received from this supplier? Shop cash creates a cash-in entry.`:form?.kind==='RETURN'?`Return ${form.lines.reduce((sum,line)=>sum+line.quantity,0)} pieces and record supplier credit of ${money(form.credit*100)}? This does not record money received.`:form?.kind==='CORRECTION'?`Correct this invoice to ${money(revisedTotal)} and ${form.lines.reduce((sum,line)=>sum+line.quantity,0)} pieces? Stock changes by the quantity difference. Original details stay in history.`:`Cancel the remaining invoice value of ${money(form?.invoice.totalPaise || 0)} and reverse all unreturned quantities? Recorded payments stay in history.`} confirmText={frozen?'Retry safely':'Confirm'} variant={form?.kind==='CANCEL'?'danger':'primary'} loading={busy}/>
        </>,document.body)}
    </>;
};

