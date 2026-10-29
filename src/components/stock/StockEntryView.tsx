import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { showToast } from '../ui/Toast';
import { excelAuditService } from '../../services/excel-audit.service';
import { stockConversionService } from '../../services/stock-conversion.service';
import { useAuthStore } from '../../store/authStore';
import type { StockEntryInput, StockEntryRow } from '../../types/stockEntry';

type Entry = Omit<StockEntryRow, 'mrp' | 'quantity'> & { key: string; mrp: string; quantity: string };
const blank = (): Entry => ({ key: crypto.randomUUID(), name: '', category: '', brand: '', size: '', mrp: '', quantity: '', attributes: {} });
const label = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
function attributeFields(category: string, attributes: Entry['attributes']) {
    const common = ['fabric', 'pattern', 'quality', 'color'];
    const shirt = /shirt/i.test(category) && !/t[ -]?shirt/i.test(category);
    const top = /shirt|polo|kids|baba/i.test(category);
    const extra = shirt ? ['collar', 'pocket', 'sleeve', 'fit'] : /mundu|dhoti/i.test(category) ? ['border', 'subtype'] : top ? ['sleeve', 'fit', 'subtype'] : ['fit', 'subtype'];
    // Preserve every imported attribute, including category-specific details.
    return [...new Set([...common, ...extra, ...Object.keys(attributes)])];
}

export const StockEntryView: React.FC<{ mode: 'MANUAL' | 'EXCEL'; onSaved: () => void; onBlockedChange: (blocked: boolean) => void }> = ({ mode, onSaved, onBlockedChange }) => {
    const [rows, setRows] = useState<Entry[]>(mode === 'MANUAL' ? [blank()] : []);
    const [batchName, setBatchName] = useState('');
    const [fileHash, setFileHash] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [confirm, setConfirm] = useState(false);
    const [pending, setPending] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [skipped, setSkipped] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [discard, setDiscard] = useState(false);
    const request = useRef<StockEntryInput | null>(null);
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const owner = useRef(useAuthStore.getState().user?.id);
    const current = () => { const user = useAuthStore.getState().user; return mounted.current && user?.id === owner.current && user?.isActive !== false && (user?.role === 'ADMIN' || user?.permManageInventory); };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { onBlockedChange(busy || pending || dirty); }, [busy, pending, dirty, onBlockedChange]);
    const change = (key: string, update: Partial<Entry>) => { if (inFlight.current || pending) return; setDirty(true); request.current = null; setRows(previous => previous.map(row => row.key === key ? { ...row, ...update } : row)); };

    const loadWorkbook = async (file?: File) => {
        if (!file || inFlight.current || pending || !current()) return;
        if (!/\.(xlsx|xls)$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024) { setError('Choose an .xlsx or .xls workbook up to 10 MB.'); return; }
        inFlight.current = true; setBusy(true); setError('');
        try {
            const preview = await excelAuditService.preview({ fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
            // This saves only the workbook snapshot; inventory changes only on Save stock.
            const status = await excelAuditService.commit(preview.token);
            const loaded = [];
            let result = await excelAuditService.list({ page: 1, pageSize: 200 });
            loaded.push(...result.items);
            for (let index = 2; index <= result.totalPages; index++) {
                result = await excelAuditService.list({ page: index, pageSize: 200 });
                if (result.status.fileHash !== status.fileHash) throw new Error('The saved workbook changed. Upload it again.');
                loaded.push(...result.items);
            }
            if (!current()) return;
            if (loaded.length > 1000) throw new Error('This workbook has more than 1,000 rows. Split it into smaller files before importing stock.');
            const fresh = loaded.filter(row => row.stockStatus !== 'POSTED');
            setSkipped(loaded.length - fresh.length);
            setRows(fresh.map(row => ({ key: row.id, sourceRowId: row.id, name: row.name && row.name !== row.category ? row.name : '', category: row.category || '', brand: row.brand || '',
                size: row.size || '', mrp: row.mrp === null ? '' : String(row.mrp), quantity: row.countedQuantity === null ? '' : String(row.countedQuantity), attributes: { ...row.attributes } })));
            setFileHash(status.fileHash || undefined); setBatchName(file.name.replace(/\.[^.]+$/, '')); setDirty(fresh.length > 0); setPage(1); request.current = null;
            if (!fresh.length) setError('All workbook rows have already been saved. Edit their quantities in Inventory.');
        } catch (failure) { if (current()) setError((failure as Error).message || 'Could not read the workbook.'); }
        finally { inFlight.current = false; if (current()) setBusy(false); }
    };
    const payload = (): StockEntryInput => ({ operationId: crypto.randomUUID(), batchName: batchName.trim() || `Stock ${new Date().toLocaleDateString('en-IN')}`,
        ...(fileHash ? { fileHash } : {}), rows: rows.map(row => ({ sourceRowId: row.sourceRowId, name: row.name.trim() || [row.brand, row.attributes.pattern, row.size].filter(Boolean).join(' - ') || row.category,
            category: row.category.trim(), brand: row.brand.trim(), size: row.size.trim(), mrp: Number(row.mrp), quantity: Number(row.quantity), attributes: row.attributes })) });
    const valid = rows.length > 0 && rows.every(row => row.category.trim() && row.mrp.trim() && Number.isFinite(Number(row.mrp)) && Number(row.mrp) > 0 && row.quantity.trim() && Number.isSafeInteger(Number(row.quantity)) && Number(row.quantity) >= 0);
    const save = async () => {
        if (!current() || inFlight.current || !valid) return;
        request.current ||= payload();
        inFlight.current = true; setBusy(true); setError('');
        try {
            const result = await stockConversionService.saveEntry(request.current);
            if (!current()) return;
            setDirty(false); setPending(false); setConfirm(false); request.current = null;
            showToast(`${result.totalPieces} pieces saved in batch “${result.batchName}”.`, 'success');
            onSaved();
        } catch (failure) {
            if (current()) {
                const uncertain = (failure as any).confirmedRejected !== true;
                setPending(uncertain); setConfirm(false);
                if (!uncertain) request.current = null;
                setError(`${(failure as Error).message}${uncertain ? ' Retry the same save to confirm its result.' : ''}`);
            }
        } finally { inFlight.current = false; if (current()) setBusy(false); }
    };
    const reset = () => { if (inFlight.current || pending) return; setRows(mode === 'MANUAL' ? [blank()] : []); setFileHash(undefined); setDirty(false); setDiscard(false); setError(''); setBatchName(''); setPage(1); setSkipped(0); request.current = null; };
    const pageCount = Math.max(1, Math.ceil(rows.length / 25));
    return <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card p-5 space-y-4">
            <h2 className="text-lg font-semibold">{mode === 'MANUAL' ? 'Add stock manually' : 'Import stock from Excel'}</h2>
            <p className="text-sm text-gray-500">Enter the actual pieces being added. Review names, attributes and counts, then save directly to inventory. Each row receives a separate short barcode. Names may repeat.</p>
            {mode === 'EXCEL' && <><label className="label" htmlFor="stock-workbook">Stock audit workbook</label><input id="stock-workbook" type="file" accept=".xlsx,.xls" disabled={busy || pending || dirty} onChange={event => { void loadWorkbook(event.target.files?.[0]); event.target.value = ''; }} /><p className="text-xs text-gray-500">Use your audit app export: Category, Brand, Size, Quantity, MRP, and garment attributes. Existing saved rows are skipped. Discard this preview before choosing another file.</p></>}
            <Input label="Batch name (optional)" placeholder="e.g. October shirt audit — rack 1" value={batchName} maxLength={200} disabled={busy || pending} onChange={event => { setBatchName(event.target.value); setDirty(true); request.current = null; }} />
            {skipped > 0 && <p className="text-sm text-amber-700">{skipped} previously saved rows skipped. Change those counts in Inventory.</p>}
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
        {rows.length > 0 && <><div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card"><table className="w-full text-sm text-left"><thead className="bg-gray-50 dark:bg-gray-800"><tr>{['Item name', 'Category', 'Brand', 'Size', 'MRP ₹', 'Count', 'Details'].map(title => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>
            {rows.slice((Math.min(page, pageCount) - 1) * 25, Math.min(page, pageCount) * 25).map(row => <React.Fragment key={row.key}><tr className="border-t border-gray-100 dark:border-gray-800">
                {(['name', 'category', 'brand', 'size', 'mrp', 'quantity'] as const).map(field => <td key={field} className="p-2"><input aria-label={`${label(field)} ${row.key}`} className={`input text-sm ${field === 'name' ? 'min-w-[210px]' : 'min-w-[90px]'}`} disabled={busy || pending} type={field === 'mrp' || field === 'quantity' ? 'number' : 'text'} min="0" step={field === 'quantity' ? '1' : 'any'} maxLength={200} value={row[field]} placeholder={field === 'name' ? [row.brand, row.attributes.pattern, row.size].filter(Boolean).join(' - ') || 'Readable name' : field === 'size' ? 'No size' : ''} onWheel={event => { if (field === 'mrp' || field === 'quantity') event.currentTarget.blur(); }} onChange={event => change(row.key, { [field]: event.target.value })} /></td>)}
                <td className="p-2 whitespace-nowrap"><Button variant="outline" size="sm" disabled={busy || pending} onClick={() => setExpanded(expanded === row.key ? null : row.key)}>Attributes</Button></td>
            </tr>{expanded === row.key && <tr><td colSpan={7} className="p-4 bg-gray-50 dark:bg-gray-900/30"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{attributeFields(row.category, row.attributes).map(key => <Input key={key} label={label(key)} value={row.attributes[key] || ''} disabled={busy || pending} maxLength={200} onChange={event => change(row.key, { attributes: { ...row.attributes, [key]: event.target.value || null } })} />)}</div><p className="text-xs text-gray-500 mt-3">Leave attributes that do not apply blank. Different fabrics, collars, pockets or other details remain separate items even when the name is the same.</p></td></tr>}</React.Fragment>)}
        </tbody></table></div><div className="flex justify-between items-center text-sm"><span>{rows.length} items · {rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)} pieces</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || busy || pending} onClick={() => setPage(page - 1)}>Previous</Button><span className="p-2">{Math.min(page, pageCount)} / {pageCount}</span><Button variant="outline" disabled={page >= pageCount || busy || pending} onClick={() => setPage(page + 1)}>Next</Button></div></div></>}
        <div className="flex flex-wrap justify-between gap-3">
            <div className="flex gap-2">{mode === 'MANUAL' && <Button variant="outline" disabled={busy || pending || rows.length >= 1000} onClick={() => { const row = blank(); setRows([...rows, row]); setExpanded(row.key); setPage(Math.ceil((rows.length + 1) / 25)); setDirty(true); }}>Add another item / size</Button>}<Button variant="secondary" disabled={busy || pending} onClick={() => dirty ? setDiscard(true) : reset()}>Discard entry</Button></div>
            <Button variant="primary" disabled={busy || !valid} onClick={() => pending ? void save() : setConfirm(true)}>{busy ? 'Saving…' : pending ? 'Retry same save' : 'Save stock to inventory'}</Button>
        </div>
        <ConfirmDialog isOpen={confirm} onClose={() => { if (!inFlight.current) setConfirm(false); }} onConfirm={save} title="Save this stock?" message={`${rows.length} items will be created with individual barcodes and the counts entered here. They will be available for billing immediately. Only bill the new stock with its new barcode; old generic sales cannot identify these items automatically.`} confirmText="Save stock" variant="primary" loading={busy} />
        <ConfirmDialog isOpen={discard} onClose={() => setDiscard(false)} onConfirm={reset} title="Discard this entry?" message="The unsaved stock names and counts will be discarded. Saved inventory is unchanged." confirmText="Discard entry" />
    </div>;
};
