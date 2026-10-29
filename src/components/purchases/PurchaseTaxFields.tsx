import React from 'react';
import type {PurchaseTaxInput,PurchaseTaxSnapshot} from '../../types/purchases';
const control='w-full border rounded-lg px-3 py-2 bg-white dark:bg-gray-800 dark:border-gray-700';
const money=(n:number)=>(n/100).toLocaleString('en-IN',{style:'currency',currency:'INR'});
export const PurchaseTaxFields:React.FC<{value:PurchaseTaxInput;onChange:(value:PurchaseTaxInput)=>void}>=({value,onChange})=><div className="border rounded-xl p-4 space-y-3 dark:border-gray-700">
    <h3 className="font-semibold">GST as printed on the invoice</h3>
    <label className="block">Supplier GSTIN (optional)<input className={control} maxLength={15} value={value.supplierGstin} onChange={e=>onChange({...value,supplierGstin:e.target.value.toUpperCase()})}/></label>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{(['cgst','sgst','igst','roundOff'] as const).map(field=><label key={field}>{({cgst:'CGST amount (₹)',sgst:'SGST amount (₹)',igst:'IGST amount (₹)',roundOff:'Round-off, +/− (₹)'})[field]}<input aria-label={field} className={control} type="number" min={field==='roundOff'?-1:0} max={field==='roundOff'?1:undefined} step="0.01" value={value[field]} onWheel={e=>e.currentTarget.blur()} onChange={e=>onChange({...value,[field]:Number(e.target.value)})}/></label>)}</div>
    <p className="text-sm text-gray-500">Use CGST + SGST, or IGST. Copy the invoice amounts; do not add GST again to tax-inclusive item rates. Charges above are before GST. Round-off is limited to ±₹1.</p>
    <p className="text-sm text-amber-700 dark:text-amber-400">ITC: Pending accountant review. No GST credit is claimed by this entry. Stock cost provisionally includes tax; profit remains provisional.</p>
</div>;
export const PurchaseTaxSummary:React.FC<{tax?:PurchaseTaxSnapshot;adjusted?:boolean}>=({tax,adjusted})=>tax?<div className="border rounded-lg p-3 text-sm space-y-1 dark:border-gray-700">
    <h3 className="font-semibold">{adjusted?'Invoice GST breakdown before supplier credits':'Invoice GST breakdown'}</h3>
    <p>Supplier GSTIN: {tax.supplierGstin||'Not recorded'}</p><p>Taxable value: {money(tax.taxablePaise)} · CGST: {money(tax.cgstPaise)} · SGST: {money(tax.sgstPaise)} · IGST: {money(tax.igstPaise)} · Round-off: {money(tax.roundOffPaise)}</p>
    <p className="text-amber-700 dark:text-amber-400">ITC pending accountant review. Stock costs include tax provisionally.</p>
    {adjusted&&<p>Supplier credits affect the balance below. Credit-note tax reconciliation is still pending; these tax amounts are not a net GST claim.</p>}
</div>:<p className="text-sm text-gray-500">Earlier purchase: GST was not recorded separately. Saved costs and balances are preserved.</p>;
