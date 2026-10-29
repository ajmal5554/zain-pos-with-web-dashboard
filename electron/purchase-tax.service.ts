import type {PurchaseTaxInput,PurchaseTaxSnapshot} from '../src/types/purchases';
function amount(value:unknown){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100_000_000||Math.abs(value*100-Math.round(value*100))>0.00001)throw new Error('Enter valid GST amounts with at most two decimal places.');
    return Math.round(value*100);
}
export function purchaseHsn(value:unknown){
    if(value===undefined||value==='')return '';
    if(typeof value!=='string'||! /^(?:\d{4}|\d{6}|\d{8})$/.test(value.trim()))throw new Error('HSN must contain 4, 6 or 8 digits, or be left blank.');
    return value.trim();
}
/** Capture invoice amounts only. Pending does not assert credit eligibility or change tax returns. */
export function purchaseTax(input:PurchaseTaxInput|undefined,taxablePaise:number):PurchaseTaxSnapshot|undefined{
    if(input===undefined)return undefined;
    if(!input||input.itcStatus!=='PENDING')throw new Error('Purchase ITC must remain pending accountant review.');
    if(typeof input.supplierGstin!=='string')throw new Error('Enter a valid supplier GSTIN or leave it blank.');
    const supplierGstin=input.supplierGstin.trim().toUpperCase();
    if(supplierGstin&&!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(supplierGstin))throw new Error('Enter a valid 15-character supplier GSTIN or leave it blank.');
    const cgstPaise=amount(input.cgst),sgstPaise=amount(input.sgst),igstPaise=amount(input.igst);
    if(igstPaise&&(cgstPaise||sgstPaise))throw new Error('Use CGST and SGST, or IGST, on this invoice; do not mix them.');
    if(typeof input.roundOff!=='number'||!Number.isFinite(input.roundOff)||Math.abs(input.roundOff)>1||Math.abs(input.roundOff*100-Math.round(input.roundOff*100))>0.00001)throw new Error('Round-off must be between -₹1 and ₹1 with at most two decimal places.');
    return {supplierGstin,cgstPaise,sgstPaise,igstPaise,roundOffPaise:Math.round(input.roundOff*100),taxablePaise,totalTaxPaise:cgstPaise+sgstPaise+igstPaise,itcStatus:'PENDING'};
}
