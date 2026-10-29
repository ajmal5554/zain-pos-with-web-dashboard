import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, FileSpreadsheet, RefreshCw, Search, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { showToast } from '../ui/Toast';
import { useAuthStore } from '../../store/authStore';
import { excelAuditService } from '../../services/excel-audit.service';
import type { ExcelAuditListResult, ExcelAuditPreview, ExcelAuditRow, ExcelAuditStatus } from '../../types/excelAudit';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_STYLE_ROWS = 100;
const displayTime = (value: string | null) => value
    ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not uploaded';
const errorMessage = (error: unknown, fallback: string) => error instanceof Error && error.message
    ? error.message.slice(0, 500) : fallback;
const sessionKey = () => {
    const user = useAuthStore.getState().user;
    return user && user.isActive !== false && (user.role === 'ADMIN' || user.permManageInventory)
        ? `${user.id}:${user.role}:${Boolean(user.permManageInventory)}` : '';
};
const fileProblem = (file: File) => {
    if (!/\.(xlsx|xls)$/i.test(file.name)) return 'Choose an Excel workbook ending in .xlsx or .xls.';
    if (file.size === 0) return 'This file is empty. Choose a workbook containing your stock audit.';
    if (file.size > MAX_FILE_BYTES) return 'The workbook is larger than 10 MB. Choose a smaller audit file.';
    return null;
};

export interface ExcelAuditSelection { fileHash: string; rows: ExcelAuditRow[]; }
export interface ExcelAuditViewProps {
    onPrepareSelection?: (selection: ExcelAuditSelection) => void;
    onOpenSavedItems?: (draftId: string, variantId?: string, status?: ExcelAuditRow['stockStatus']) => void;
}
export const ExcelAuditView: React.FC<ExcelAuditViewProps> = ({ onPrepareSelection, onOpenSavedItems } = {}) => {
    const { user } = useAuthStore();
    const allowed = Boolean(user && user.isActive !== false && (user.role === 'ADMIN' || user.permManageInventory));
    if (!allowed) return <p className="text-sm text-gray-600 dark:text-gray-400">You need inventory access to view or upload stock audits.</p>;
    if (!window.electronAPI?.excelAudit) {
        return (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card p-6 text-sm text-gray-600 dark:text-gray-400">
                <FileSpreadsheet className="w-7 h-7 text-indigo-500 mb-3" />
                <p className="font-semibold text-gray-900 dark:text-white mb-1">Excel Audit is available in the desktop POS app.</p>
                <p>Open the installed app to upload your workbook and review its audit counts.</p>
            </div>
        );
    }
    return <ExcelAuditData key={`${user?.id}:${user?.role}:${Boolean(user?.permManageInventory)}:${Boolean(user?.permManageProducts)}`} onPrepareSelection={onPrepareSelection} onOpenSavedItems={onOpenSavedItems} />;
};

type LoadedAudit = ExcelAuditListResult & { search: string };

const AuditRows: React.FC<{ items: ExcelAuditRow[]; selected?: Set<string>; onSelect?: (row: ExcelAuditRow, checked: boolean) => void; selectionDisabled?: boolean; onOpenSaved?: (row: ExcelAuditRow) => void }> = ({ items, selected, onSelect, selectionDisabled, onOpenSaved }) => (
    <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 dark:bg-gray-900/30 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>{onSelect && <th className="px-3 py-3">Select</th>}<th className="px-4 py-3">Product / Barcode</th><th className="px-4 py-3">Category / Brand</th><th className="px-4 py-3">Size & details</th><th className="px-4 py-3 text-right">Price / MRP</th><th className="px-4 py-3 text-right">Audit count</th><th className="px-4 py-3">Source updated</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((row) => (
                    <tr key={row.id}>
                        {onSelect && <td className="px-3 py-3"><input type="checkbox" aria-label={`Select audit row ${row.sourceRow}: ${row.name} ${row.size || 'Standard'}`} checked={selected?.has(row.id) || false} disabled={selectionDisabled || Boolean(row.stockStatus) || row.countedQuantity === 0} onChange={event => onSelect(row, event.target.checked)} /></td>}
                        <td className="px-4 py-3"><p className="font-medium text-gray-900 dark:text-white">{row.name}</p><p className="text-xs text-gray-500 font-mono mt-1">{row.barcode || 'No barcode'}</p><p className="text-[11px] text-gray-400 mt-1">Workbook row {row.sourceRow}</p>{row.stockStatus && <div className="mt-2 text-xs"><p className={row.stockStatus === 'POSTED' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>{row.stockStatus === 'POSTED' ? 'Added to inventory' : row.stockStatus === 'CANCELLED' ? 'Setup cancelled — item already saved' : 'Item saved — finish adding stock'}</p>{row.stockDraftId && onOpenSaved && <Button variant="ghost" size="sm" className="mt-1" disabled={selectionDisabled} onClick={() => onOpenSaved(row)}>{row.stockStatus === 'PREPARED' ? 'Continue setup' : 'View saved item'}</Button>}</div>}</td>
                        <td className="px-4 py-3"><p>{row.category || '—'}</p><p className="text-xs text-gray-500 mt-1">{row.brand || 'No brand'}</p></td>
                        <td className="px-4 py-3 min-w-[160px]"><p>{row.size || 'No size'}</p><div className="text-xs text-gray-500 mt-1 space-y-0.5">{Object.entries(row.attributes || {}).filter(([, value]) => value !== null && value !== '').map(([key, value]) => <p key={key}><span className="capitalize">{key}:</span> {value}</p>)}</div></td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{row.mrp === null ? '—' : `₹${row.mrp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-semibold">{row.countedQuantity === null ? <span className="font-normal text-gray-500">Not counted</span> : row.countedQuantity.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{row.lastUpdated || '—'}</td>
                    </tr>
                ))}
                {!items.length && <tr><td colSpan={onSelect ? 7 : 6} className="p-10 text-center text-gray-500">No matching audit rows.</td></tr>}
            </tbody>
        </table>
    </div>
);

const AuditSummary: React.FC<{ status: ExcelAuditStatus }> = ({ status }) => (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {[
            ['Audit rows', status.rowCount], ['Counted rows', status.countedRows],
            ['Not counted', status.uncountedRows], ['Counted pieces', status.totalQuantity],
        ].map(([label, value]) => <div key={label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card px-3 py-2"><dt className="text-xs text-gray-500">{label}</dt><dd className="font-semibold text-lg text-gray-900 dark:text-white">{Number(value).toLocaleString('en-IN')}</dd></div>)}
    </dl>
);

const ExcelAuditData: React.FC<ExcelAuditViewProps> = ({ onPrepareSelection, onOpenSavedItems }) => {
    const { user } = useAuthStore();
    const canPrepare = Boolean(onPrepareSelection && user && (user.role === 'ADMIN' || user.permManageProducts));
    const [status, setStatus] = useState<ExcelAuditStatus | null>(null);
    const [loaded, setLoaded] = useState<LoadedAudit | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [preview, setPreview] = useState<ExcelAuditPreview | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [confirmImport, setConfirmImport] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [commitError, setCommitError] = useState<string | null>(null);
    const [selection, setSelectionState] = useState<Record<string, ExcelAuditRow>>({});
    const selectionRef = useRef<Record<string, ExcelAuditRow>>({});
    const selectionHash = useRef<string | null>(null);
    const actionsReady = useRef(false);
    const loadedRef = useRef<LoadedAudit | null>(null);
    const mounted = useRef(true);
    const actorKey = useRef(sessionKey());
    const listRequest = useRef(0);
    const previewRequest = useRef(0);
    const fileEpoch = useRef(0);
    const fileRef = useRef<File | null>(null);
    const previewRef = useRef<ExcelAuditPreview | null>(null);
    const commitInFlight = useRef(false);
    const confirmationOpen = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const currentQuery = useRef({ page, search, debouncedSearch });
    currentQuery.current = { page, search, debouncedSearch };
    const isCurrent = () => mounted.current && Boolean(actorKey.current) && actorKey.current === sessionKey();
    const setSelection = (next: Record<string, ExcelAuditRow>) => {
        selectionRef.current = next;
        setSelectionState(next);
    };

    const loadList = async () => {
        if (!isCurrent()) return;
        const query = currentQuery.current;
        if (query.search !== query.debouncedSearch) return;
        const request = ++listRequest.current;
        actionsReady.current = false;
        setLoading(true);
        try {
            const data = await excelAuditService.list({ page: query.page, pageSize: 50, search: query.debouncedSearch });
            if (!isCurrent() || request !== listRequest.current) return;
            if (selectionHash.current !== data.status.fileHash) { selectionHash.current = data.status.fileHash; setSelection({}); }
            else {
                const savedIds = new Set(data.items.filter(row => row.stockStatus).map(row => row.id));
                if (Object.keys(selectionRef.current).some(id => savedIds.has(id))) setSelection(Object.fromEntries(Object.entries(selectionRef.current).filter(([id]) => !savedIds.has(id))));
            }
            setStatus(data.status);
            const next = { ...data, search: query.debouncedSearch };
            loadedRef.current = next;
            setLoaded(next);
            if (data.page !== query.page) setPage(data.page);
            setListError(null);
            actionsReady.current = true;
        } catch (error) {
            if (isCurrent() && request === listRequest.current) {
                setListError(errorMessage(error, 'Could not load the saved Excel audit. Please retry.'));
            }
        } finally {
            if (isCurrent() && request === listRequest.current) setLoading(false);
        }
    };

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            listRequest.current += 1;
            previewRequest.current += 1;
            actionsReady.current = false;
        };
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        if (search === debouncedSearch) void loadList();
        return () => { listRequest.current += 1; actionsReady.current = false; };
    }, [page, search, debouncedSearch]);

    const changeFile = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!isCurrent() || commitInFlight.current) return;
        const file = event.target.files?.[0] || null;
        fileEpoch.current += 1;
        previewRequest.current += 1;
        fileRef.current = file;
        previewRef.current = null;
        confirmationOpen.current = false;
        setSelectedFile(file);
        setPreview(null);
        setPreviewLoading(false);
        setConfirmImport(false);
        setCommitError(null);
        setUploadError(file ? fileProblem(file) : null);
    };

    const reviewFile = async () => {
        if (!isCurrent() || commitInFlight.current) return;
        const file = fileRef.current;
        if (!file) return;
        const problem = fileProblem(file);
        if (problem) { setUploadError(problem); return; }
        const request = ++previewRequest.current;
        const epoch = fileEpoch.current;
        const stillCurrent = () => isCurrent() && request === previewRequest.current && epoch === fileEpoch.current;
        setPreviewLoading(true);
        setUploadError(null);
        setCommitError(null);
        try {
            const buffer = await file.arrayBuffer();
            if (!stillCurrent()) return;
            if (!buffer.byteLength || buffer.byteLength > MAX_FILE_BYTES) throw new Error('Choose a non-empty Excel workbook no larger than 10 MB.');
            const result = await excelAuditService.preview({ fileName: file.name, bytes: new Uint8Array(buffer) });
            if (!stillCurrent()) return;
            previewRef.current = result;
            setPreview(result);
        } catch (error) {
            if (stillCurrent()) setUploadError(errorMessage(error, 'Could not read this audit workbook. Check the file and retry.'));
        } finally {
            if (stillCurrent()) setPreviewLoading(false);
        }
    };

    const closePreview = () => {
        if (!isCurrent() || commitInFlight.current) return;
        previewRequest.current += 1;
        previewRef.current = null;
        confirmationOpen.current = false;
        setPreview(null);
        setConfirmImport(false);
        setCommitError(null);
    };

    const askToImport = () => {
        if (!isCurrent() || commitInFlight.current || !preview || previewRef.current !== preview || preview.alreadyImported) return;
        confirmationOpen.current = true;
        setConfirmImport(true);
    };

    const importPreview = async () => {
        if (!isCurrent() || commitInFlight.current || !confirmationOpen.current || !preview || previewRef.current !== preview || preview.alreadyImported) return;
        const attempt = preview;
        commitInFlight.current = true;
        actionsReady.current = false;
        setCommitting(true);
        setCommitError(null);
        try {
            const next = await excelAuditService.commit(attempt.token);
            if (!isCurrent() || previewRef.current !== attempt) return;
            setStatus(next);
            setSelection({});
            selectionHash.current = next.fileHash;
            setLoaded(null);
            loadedRef.current = null;
            previewRef.current = null;
            fileRef.current = null;
            confirmationOpen.current = false;
            fileEpoch.current += 1;
            previewRequest.current += 1;
            listRequest.current += 1;
            setPreview(null);
            setSelectedFile(null);
            setConfirmImport(false);
            setUploadError(null);
            if (inputRef.current) inputRef.current.value = '';
            currentQuery.current = { page: 1, search: '', debouncedSearch: '' };
            setSearch('');
            setDebouncedSearch('');
            setPage(1);
            showToast('Excel audit saved for review. Shop stock has not been changed.', 'success');
            void loadList();
        } catch (error) {
            if (isCurrent() && previewRef.current === attempt) {
                setCommitError(`${errorMessage(error, 'Could not confirm the audit import.')} Retry this preview or reload the saved audit to check the result.`);
            }
        } finally {
            if (isCurrent()) {
                commitInFlight.current = false;
                setCommitting(false);
            }
        }
    };

    const changeSearch = (value: string) => {
        listRequest.current += 1;
        actionsReady.current = false;
        setSearch(value);
        setPage(1);
        setLoading(true);
        setListError(null);
    };
    const stale = Boolean(loaded && (listError || loading || loaded.search !== debouncedSearch || loaded.page !== page));
    const firstRow = loaded && loaded.totalMatching ? (loaded.page - 1) * loaded.pageSize + 1 : 0;
    const lastRow = loaded ? Math.min(loaded.page * loaded.pageSize, loaded.totalMatching) : 0;
    const selectRow = (row: ExcelAuditRow, checked: boolean) => {
        const active = useAuthStore.getState().user;
        if (!isCurrent() || !actionsReady.current || commitInFlight.current || !canPrepare || !active || (active.role !== 'ADMIN' && !active.permManageProducts) || row.countedQuantity === 0 || row.stockStatus
            || !loadedRef.current?.items.some(item => item.id === row.id)) return;
        const next = { ...selectionRef.current };
        if (checked) {
            if (!next[row.id] && Object.keys(next).length >= MAX_STYLE_ROWS) {
                showToast('Select up to 100 rows for one style. Prepare the remaining rows separately.', 'warning');
                return;
            }
            next[row.id] = row;
        } else delete next[row.id];
        setSelection(next);
    };
    const prepareSelection = () => {
        const active = useAuthStore.getState().user;
        const saved = loadedRef.current;
        const rows = Object.values(selectionRef.current);
        if (!isCurrent() || !actionsReady.current || commitInFlight.current || !active || (active.role !== 'ADMIN' && !active.permManageProducts)
            || !saved?.status.fileHash || saved.status.fileHash !== selectionHash.current || !rows.length || rows.length > MAX_STYLE_ROWS) return;
        onPrepareSelection?.({ fileHash: saved.status.fileHash, rows: rows.sort((a, b) => a.sourceRow - b.sourceRow) });
    };
    const openSavedItem = (row: ExcelAuditRow) => {
        const saved = loadedRef.current?.items.find(item => item.id === row.id);
        if (!isCurrent() || !actionsReady.current || commitInFlight.current || !saved?.stockDraftId || !saved.stockStatus) return;
        onOpenSavedItems?.(saved.stockDraftId, saved.stockVariantId, saved.stockStatus);
    };

    return (
        <div className="space-y-5">
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50 dark:bg-indigo-950/20 p-4 text-sm text-indigo-900 dark:text-indigo-200">
                <p className="font-semibold">Audit observations — shop stock has not been changed</p>
                <p className="mt-1">Upload your Excel stock audit to review product details and physical counts. This does not change shop products, stock, bills or count drafts. POS sales do not reduce these observations.</p>
            </div>

            <section className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h2 className="font-semibold text-lg text-gray-900 dark:text-white flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-indigo-600" />Excel stock audit</h2><p className="text-sm text-gray-500 mt-1">Choose a workbook, check its preview, then import it.</p></div>
                    <Button variant="outline" onClick={() => { void loadList(); }} disabled={loading || committing}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Reload saved audit</Button>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    <div className="flex-1"><label className="label" htmlFor="excel-audit-file">Stock audit workbook (.xlsx or .xls, up to 10 MB)</label><input ref={inputRef} id="excel-audit-file" aria-label="Stock audit workbook" type="file" accept=".xlsx,.xls" className="input file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-indigo-700" onChange={changeFile} disabled={committing} /></div>
                    <Button variant="primary" onClick={() => { void reviewFile(); }} disabled={!selectedFile || Boolean(selectedFile && fileProblem(selectedFile)) || previewLoading || committing}><Upload className="w-4 h-4" />{previewLoading ? 'Reading workbook…' : 'Review Excel file'}</Button>
                </div>
                <p className="text-xs text-gray-500">Each import replaces the whole previously uploaded audit. Counts are not added together. This is a saved copy of your workbook; upload a new file when your audit changes.</p>
                {uploadError && <p role="alert" className="text-sm text-red-700 dark:text-red-300 flex items-start gap-2"><AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{uploadError} Your saved audit has not been replaced by this preview.</p>}
            </section>

            {listError && <div role="alert" className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-900 dark:text-amber-200"><p className="font-semibold">Saved audit could not be refreshed</p><p className="mt-1">{listError}</p>{loaded && <p className="mt-1">The last loaded results are still shown below.</p>}<Button variant="outline" size="sm" className="mt-2" onClick={() => { void loadList(); }}>Retry loading audit</Button></div>}

            {status?.imported && (
                <div className="space-y-3">
                    <div className="text-sm text-gray-600 dark:text-gray-400 break-words"><p className="font-medium text-gray-900 dark:text-white">{status.fileName}</p><p>Sheet: {status.sheetName} · Uploaded to this POS: {displayTime(status.importedAt)}</p><p className="text-xs mt-1">Source updated is the text from the workbook, separate from the upload time above.</p></div>
                    <AuditSummary status={status} />
                </div>
            )}

            {status?.imported || loaded?.items.length ? (
                <div className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card overflow-hidden">
                    <div className="p-4 border-b border-gray-200 dark:border-dark-border flex flex-col sm:flex-row sm:items-center gap-3"><div className="relative flex-1 max-w-lg"><Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" /><Input aria-label="Search Excel audit" className="pl-9" placeholder="Search name, barcode, size or attributes…" value={search} onChange={(event) => changeSearch(event.target.value)} /></div><p role="status" className="text-sm text-gray-500">{loading ? 'Loading results…' : `${(loaded?.totalMatching || 0).toLocaleString('en-IN')} matching rows`}</p></div>
                    {stale && <p className="px-4 py-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20">Showing the last loaded results{loaded?.search ? ` for “${loaded.search}”` : ''}{loading ? ' while the new results load.' : '.'}</p>}
                    {canPrepare && <div className="px-4 py-3 bg-indigo-50/60 dark:bg-indigo-950/20 text-sm border-b border-indigo-100 dark:border-indigo-900/40 flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Select rows for one actual garment style</p><p className="text-xs text-gray-500 mt-1">Check fabric, quality, design and size against the physical pieces. Matching names or prices do not prove they are the same style. Select up to 100 sizes per style. Zero-count rows cannot form a batch.</p></div><div className="flex items-center gap-2"><span className="text-xs text-gray-500">{Object.keys(selection).length} selected</span>{Object.keys(selection).length > 0 && <Button variant="ghost" size="sm" onClick={() => setSelection({})}>Clear selection</Button>}<Button variant="primary" size="sm" disabled={loading || committing || Boolean(listError) || !status?.fileHash || !Object.keys(selection).length} onClick={prepareSelection}>Add stock items</Button></div></div>}
                    <AuditRows items={loaded?.items || []} selected={new Set(Object.keys(selection))} onSelect={canPrepare ? selectRow : undefined} selectionDisabled={loading || committing || Boolean(listError)} onOpenSaved={onOpenSavedItems ? openSavedItem : undefined} />
                    <div className="px-4 py-3 border-t border-gray-200 dark:border-dark-border flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500"><span>{firstRow}–{lastRow} of {(loaded?.totalMatching || 0).toLocaleString('en-IN')}</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" aria-label="Previous Excel audit page" disabled={loading || committing || Boolean(listError) || !loaded || loaded.page <= 1} onClick={() => { listRequest.current += 1; actionsReady.current = false; setLoading(true); setPage((value) => value - 1); }}><ChevronLeft className="w-4 h-4" /></Button><span>Page {loaded?.page || 1} of {loaded?.totalPages || 1}</span><Button variant="outline" size="sm" aria-label="Next Excel audit page" disabled={loading || committing || Boolean(listError) || !loaded || loaded.page >= loaded.totalPages} onClick={() => { listRequest.current += 1; actionsReady.current = false; setLoading(true); setPage((value) => value + 1); }}><ChevronRight className="w-4 h-4" /></Button></div></div>
                </div>
            ) : loading ? <p role="status" className="text-sm text-gray-500">Loading saved audit…</p> : !listError && <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">No Excel audit has been uploaded on this computer yet. Choose your workbook above to begin.</div>}

            <Modal isOpen={Boolean(preview)} onClose={closePreview} title="Review Excel stock audit" size="xl">
                {preview && <div className="space-y-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400 break-words"><p className="font-semibold text-gray-900 dark:text-white">{preview.status.fileName}</p><p>Sheet: {preview.status.sheetName}</p><p className="mt-1">Check the names, sizes, price and counts before importing. Source dates below are copied from the workbook.</p></div>
                    <AuditSummary status={preview.status} />
                    <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-200">{preview.replacesExisting ? 'This replaces the whole currently saved Excel audit. It does not merge rows or add their counts.' : 'This saves a separate audit for review.'} Shop stock, products and count drafts stay unchanged.</div>
                    {preview.warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-800 dark:text-amber-300 space-y-1">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
                    {preview.alreadyImported && <p role="status" className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm text-emerald-800 dark:text-emerald-300">This exact workbook is already uploaded. No replacement is needed.</p>}
                    {commitError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{commitError}</p>}
                    <p className="text-xs font-medium text-gray-500">{preview.status.rowCount > preview.items.length ? `Preview sample: first ${preview.items.length} of ${preview.status.rowCount.toLocaleString('en-IN')} rows. The full workbook will be imported.` : `Preview: ${preview.items.length.toLocaleString('en-IN')} audit rows.`}</p>
                    <AuditRows items={preview.items} />
                    <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 dark:border-gray-700 pt-4"><Button variant="secondary" onClick={closePreview} disabled={committing}>{preview.alreadyImported ? 'Close preview' : 'Cancel preview'}</Button><Button variant="primary" onClick={askToImport} disabled={committing || preview.alreadyImported}><Upload className="w-4 h-4" />{preview.replacesExisting ? 'Replace saved audit' : 'Import audit'}</Button></div>
                </div>}
            </Modal>
            <ConfirmDialog
                isOpen={confirmImport && Boolean(preview)}
                onClose={() => { if (!commitInFlight.current) { confirmationOpen.current = false; setConfirmImport(false); } }}
                onConfirm={importPreview}
                title={preview?.replacesExisting ? 'Replace the saved Excel audit?' : 'Import this Excel audit?'}
                message={`${preview?.replacesExisting ? 'The whole previous uploaded audit will be replaced; counts will not be added together.' : 'Save this workbook as audit observations for review.'}\nShop stock, products, bills and count drafts will not change.${commitError ? `\n\n${commitError}` : ''}`}
                confirmText={commitError ? 'Retry import' : preview?.replacesExisting ? 'Replace audit' : 'Import audit'}
                variant="primary"
                loading={committing}
            />
        </div>
    );
};
