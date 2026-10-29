import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { showToast } from '../ui/Toast';
import { db } from '../../lib/db';
import { useAuthStore } from '../../store/authStore';
import { stockConversionService } from '../../services/stock-conversion.service';
import type { ExcelAuditSelection } from './ExcelAuditView';
import type { PrepareAuditSelection } from '../../types/stockConversion';

export const PrepareAuditStyleModal: React.FC<{ selection: ExcelAuditSelection; onClose: () => void; onPrepared: (draftId: string) => void }> = ({ selection, onClose, onPrepared }) => {
    const { user } = useAuthStore();
    const actor = useRef(user?.id);
    const mounted = useRef(true);
    const categoryRequest = useRef(0);
    const inFlight = useRef(false);
    const attempt = useRef<{ key: string; input: PrepareAuditSelection; uncertain?: boolean } | null>(null);
    const touched = useRef(false);
    const categoryTouched = useRef(false);
    const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
    const [categoryError, setCategoryError] = useState('');
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState(() => {
        const row = selection.rows[0];
        return [row?.brand || row?.category || '', row?.attributes.pattern || ''].filter(Boolean).join(' ');
    });
    const [categoryId, setCategoryId] = useState('');
    const [categoryName, setCategoryName] = useState('');
    const [tax, setTax] = useState('5');
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const [discard, setDiscard] = useState(false);
    const isCurrent = () => { const active = useAuthStore.getState().user; return Boolean(mounted.current && active && active.id === actor.current && active.isActive !== false && (active.role === 'ADMIN' || (active.permManageInventory && active.permManageProducts))); };
    const loadCategories = async () => {
        if (!isCurrent()) return;
        const request = ++categoryRequest.current;
        setLoading(true); setCategoryError('');
        try {
            const next = await db.categories.findMany({ orderBy: { name: 'asc' } });
            if (!isCurrent() || request !== categoryRequest.current) return;
            if (!Array.isArray(next)) throw new Error('Could not load product categories.');
            setCategories(next);
            if (!categoryTouched.current) {
                const sourceName = selection.rows[0]?.category?.trim() || '';
                const match = next.find(category => category.name.trim().toLowerCase() === sourceName.toLowerCase());
                if (match) setCategoryId(match.id);
                else if (sourceName) { setCategoryId('__NEW__'); setCategoryName(sourceName); }
            }
        } catch (failure) { if (isCurrent() && request === categoryRequest.current) setCategoryError((failure as Error).message || 'Could not load categories.'); }
        finally { if (isCurrent() && request === categoryRequest.current) setLoading(false); }
    };
    useEffect(() => { mounted.current = true; void loadCategories(); return () => { mounted.current = false; categoryRequest.current += 1; }; }, []);
    const changed = () => { if (inFlight.current || attempt.current?.uncertain) return false; touched.current = true; attempt.current = null; setError(''); return true; };
    const requestClose = () => {
        if (inFlight.current || attempt.current?.uncertain || discard) return;
        if (touched.current) setDiscard(true); else onClose();
    };
    const valid = Boolean(name.trim() && (categoryId === '__NEW__' ? categoryName.trim() : categories.some(category => category.id === categoryId)) && confirmed && tax.trim() && Number.isFinite(Number(tax)) && Number(tax) >= 0 && Number(tax) <= 100 && selection.rows.length && selection.rows.every(row => row.countedQuantity !== 0));
    const prepare = async () => {
        if (!isCurrent() || inFlight.current || loading || categoryError || !valid) return;
        const payload = { fileHash: selection.fileHash, rowIds: selection.rows.map(row => row.id), productName: name.trim(), categoryId: categoryId === '__NEW__' ? '' : categoryId,
            ...(categoryId === '__NEW__' ? { categoryName: categoryName.trim() } : {}), taxRate: Number(tax), styleConfirmed: true };
        const key = JSON.stringify(payload);
        if (attempt.current?.key !== key) attempt.current = { key, input: { ...payload, operationId: crypto.randomUUID() } };
        const request = attempt.current;
        inFlight.current = true; setSaving(true); setError('');
        try {
            const result = await stockConversionService.prepare(request.input);
            if (!isCurrent()) return;
            showToast('New barcodes created. Check the counts and print labels to finish.', 'success');
            onPrepared(result.draftId);
        } catch (failure) {
            if ((failure as any).confirmedRejected !== true) request.uncertain = true;
            if (isCurrent()) {
                setPending(Boolean(request.uncertain));
                setError(`${(failure as Error).message || 'Could not prepare this style.'}${request.uncertain ? ' Keep this window open and retry to check the same saved request.' : ''}`);
            }
        }
        finally { if (isCurrent()) { inFlight.current = false; setSaving(false); } }
    };
    return <><Modal isOpen={Boolean(user)} onClose={requestClose} title="Add audited items" size="lg"><div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">Select sizes of the same brand, fabric and design. Each size receives its own short barcode.</p>
        <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">{selection.rows.map(row => <div key={row.id} className="p-3 text-sm"><p className="font-medium">{row.name} · {row.size || 'Standard'} · ₹{row.mrp ?? '—'} · {row.countedQuantity === null ? 'Not counted' : `${row.countedQuantity} pieces`}</p><p className="text-xs text-gray-500">{Object.entries(row.attributes).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p></div>)}</div>
        {categoryError && <div role="alert" className="text-sm text-red-700 dark:text-red-300">{categoryError}<Button size="sm" variant="outline" className="mt-2" onClick={() => { void loadCategories(); }}>Retry categories</Button></div>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <fieldset disabled={saving || loading || pending} className="space-y-4">
            <Input label="Readable product name" placeholder="e.g. Crazy Heart Checks" value={name} maxLength={150} onChange={event => { if (changed()) setName(event.target.value); }} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div>
                <label htmlFor="prepare-category" className="label">Category</label>
                <select id="prepare-category" className="input" value={categoryId} onChange={event => { if (changed()) { categoryTouched.current = true; setCategoryId(event.target.value); } }}>
                    <option value="">{loading ? 'Loading categories…' : 'Choose the category'}</option>
                    {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                    <option value="__NEW__">Add a new category…</option>
                </select>
                {categoryId === '__NEW__' && <Input label="New category name" value={categoryName} maxLength={150} onChange={event => { if (changed()) setCategoryName(event.target.value); }} />}
            </div><Input label="Tax rate (%)" type="number" min="0" max="100" step="0.01" value={tax} onWheel={event => event.currentTarget.blur()} onChange={event => { if (changed()) setTax(event.target.value); }} /></div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => { if (changed()) setConfirmed(event.target.checked); }} className="mt-1" /><span>I checked the physical pieces. All selected rows belong to this one style; differences are sizes, not different fabric, quality or design.</span></label>
        </fieldset>
        <p className="text-xs text-gray-500">Each size gets a new barcode. Check the quantities and attach the labels before making these items ready for billing.</p>
        <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-700 pt-4"><Button variant="secondary" onClick={requestClose} disabled={saving || pending}>Cancel</Button><Button variant="primary" onClick={() => { void prepare(); }} disabled={!valid || loading || Boolean(categoryError) || saving}>{saving ? 'Saving…' : error ? 'Retry' : 'Create new barcodes'}</Button></div>
    </div></Modal><ConfirmDialog isOpen={discard} onClose={() => setDiscard(false)} onConfirm={() => { if (!inFlight.current && !attempt.current?.uncertain) onClose(); }} title="Discard these item details?" message="The name and category changes have not been saved. Return to Excel upload without them?" confirmText="Discard changes" cancelText="Keep editing" variant="warning" /></>;
};
