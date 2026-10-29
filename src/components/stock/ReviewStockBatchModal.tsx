import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StickerPrintModal } from '../ui/StickerPrintModal';
import { showToast } from '../ui/Toast';
import { useAuthStore } from '../../store/authStore';
import { stockDraftService } from '../../services/stock-draft.service';
import { stockConversionService } from '../../services/stock-conversion.service';
import type { StockDraftDetail } from '../../services/stock-draft.service';
import type { PostStockBatchInput } from '../../types/stockConversion';

export const ReviewStockBatchModal: React.FC<{ draftId: string; onClose: () => void; onPosted: () => void }> = ({ draftId, onClose, onPosted }) => {
    const { user } = useAuthStore();
    const actor = useRef(user?.id);
    const mounted = useRef(true);
    const loadRequest = useRef(0);
    const printRequest = useRef(0);
    const posting = useRef(false);
    const confirmationOpen = useRef(false);
    const loadedDraft = useRef<StockDraftDetail | null>(null);
    const attempt = useRef<{ key: string; input: PostStockBatchInput; uncertain?: boolean } | null>(null);
    const [draft, setDraft] = useState<StockDraftDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [pending, setPending] = useState(false);
    const [checked, setChecked] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [printLoading, setPrintLoading] = useState(false);
    const [sticker, setSticker] = useState<any>(null);
    const isCurrent = () => { const active = useAuthStore.getState().user; return Boolean(mounted.current && active && active.id === actor.current && active.isActive !== false && (active.role === 'ADMIN' || active.permManageInventory)); };
    const canPrint = Boolean(user && (user.role === 'ADMIN' || user.permPrintSticker));
    const load = async () => {
        if (!isCurrent() || posting.current || attempt.current?.uncertain) return;
        const request = ++loadRequest.current;
        setLoading(true); setError(''); setDraft(null); loadedDraft.current = null; confirmationOpen.current = false;
        setChecked(false); setConfirm(false); attempt.current = null;
        try {
            const next = await stockDraftService.getDraft(draftId);
            if (!isCurrent() || request !== loadRequest.current) return;
            if (next.id !== draftId) throw new Error('The wrong stock entry was returned. Reload this entry.');
            setDraft(next); loadedDraft.current = next;
        } catch (failure) { if (isCurrent() && request === loadRequest.current) setError((failure as Error).message || 'Could not load these items.'); }
        finally { if (isCurrent() && request === loadRequest.current) setLoading(false); }
    };
    useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; loadRequest.current += 1; printRequest.current += 1; }; }, [draftId]);
    const validCounts = Boolean(draft?.lines.length && draft.lines.every(line => Number.isSafeInteger(line.countedQuantity) && Number(line.countedQuantity) > 0));
    const currentCatalogue = Boolean(draft?.lines.every(line => line.catalogueStatus === 'OK' && line.currentLiveDetails && (line.currentLiveDetails.isPrepared || line.currentLiveDetails.isTracked)));
    const ready = Boolean(!loading && draft?.status === 'DRAFT' && validCounts && currentCatalogue && checked);
    const close = () => { if (!posting.current && !attempt.current?.uncertain && !confirmationOpen.current && !sticker && !printLoading) onClose(); };
    const printLine = async (variantId: string) => {
        const active = useAuthStore.getState().user;
        if (!isCurrent() || !active || (active.role !== 'ADMIN' && !active.permPrintSticker) || loading || posting.current) return;
        const line = draft?.lines.find(item => item.variantId === variantId);
        if (!line || line.catalogueStatus !== 'OK') return;
        const request = ++printRequest.current;
        setPrintLoading(true);
        try {
            if (!window.electronAPI?.catalogue?.listVariants) throw new Error('Label details are unavailable. Reopen the desktop app and retry.');
            const response = await window.electronAPI.catalogue.listVariants({ where: { id: variantId }, take: 1 });
            if (!response.success) throw new Error(response.error || 'Could not load this label.');
            const variant = response.data?.[0];
            const currentActor = useAuthStore.getState().user;
            if (!isCurrent() || request !== printRequest.current || !currentActor || (currentActor.role !== 'ADMIN' && !currentActor.permPrintSticker)) return;
            if (!variant?.product || variant.id !== variantId || variant.barcode !== line.snapshot.barcode) throw new Error('The barcode or product changed. Reload these items before printing.');
            setSticker(variant);
        } catch (failure) { if (isCurrent() && request === printRequest.current) showToast((failure as Error).message || 'Could not load the label.', 'error'); }
        finally { if (isCurrent() && request === printRequest.current) setPrintLoading(false); }
    };
    const post = async () => {
        if (!isCurrent() || posting.current || !ready || !draft || !confirmationOpen.current || loadedDraft.current !== draft) return;
        const payload = { draftId: draft.id, expectedRevision: draft.revision, held: true, labelsApplied: true, countsChecked: true };
        const key = JSON.stringify(payload);
        if (attempt.current?.key !== key) attempt.current = { key, input: { ...payload, operationId: crypto.randomUUID() } };
        const request = attempt.current;
        posting.current = true; setSaving(true); setError('');
        try {
            await stockConversionService.postBatch(request.input);
            if (!isCurrent()) return;
            showToast('Stock added. These new barcodes are ready for billing.', 'success');
            confirmationOpen.current = false; setConfirm(false); onPosted();
        } catch (failure) {
            if ((failure as any).confirmedRejected !== true) request.uncertain = true;
            if (isCurrent()) {
                setPending(Boolean(request.uncertain));
                setError(`${(failure as Error).message || 'Could not confirm the stock entry.'}${request.uncertain ? ' Keep this window open and retry this same request so stock is added only once.' : ''}`);
            }
        } finally { posting.current = false; if (isCurrent()) setSaving(false); }
    };
    return <><Modal isOpen={Boolean(user)} onClose={close} title="Add stock to inventory" size="xl"><div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">Check the sizes and quantities below. Print any labels you need, then add these pieces to inventory.</p>
        {loading ? <p role="status" className="text-sm text-gray-500">Loading saved items…</p> : draft && <>
            <div className="flex flex-wrap justify-between gap-2 text-sm"><p className="font-semibold">{draft.batchDescription}</p><span>{draft.status === 'DRAFT' ? 'Not yet in inventory' : draft.status === 'POSTED' ? 'Added to inventory' : 'Cancelled'}</span></div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 dark:bg-gray-900"><tr><th className="p-3">Item</th><th className="p-3">New barcode</th><th className="p-3 text-right">Quantity</th>{canPrint && <th className="p-3">Labels</th>}</tr></thead><tbody>{draft.lines.map(line => <tr key={line.id} className="border-t border-gray-100 dark:border-gray-800"><td className="p-3"><p>{line.snapshot.productName} · {line.snapshot.size || 'Standard'}</p><p className="text-xs text-gray-500">{line.snapshot.description}</p>{line.catalogueStatus !== 'OK' && <p className="text-xs text-red-600">{line.statusMessage || 'Product details changed. Review the saved count first.'}</p>}</td><td className="p-3 font-mono">{line.snapshot.barcode}</td><td className="p-3 text-right font-semibold">{line.countedQuantity === null ? 'Not counted' : line.countedQuantity}</td>{canPrint && <td className="p-3"><Button variant="outline" size="sm" disabled={saving || printLoading || line.catalogueStatus !== 'OK'} onClick={() => { void printLine(line.variantId); }}>Print labels</Button></td>}</tr>)}</tbody></table></div>
            {draft.status !== 'DRAFT' ? <p className="rounded-lg bg-gray-100 dark:bg-gray-800 p-3 text-sm">These items are {draft.status === 'POSTED' ? 'already in inventory' : 'cancelled'}. This stock entry cannot be added again.</p> : <>
                {!validCounts && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">Go back and enter a positive whole-piece quantity for each size.</p>}
                {!currentCatalogue && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">Item details changed. Create a fresh stock entry with the correct details.</p>}
                <fieldset disabled={saving || pending || !validCounts || !currentCatalogue} className="rounded-lg border border-indigo-200 dark:border-indigo-900 p-4 text-sm"><label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={checked} onChange={event => { if (posting.current || attempt.current?.uncertain) return; attempt.current = null; confirmationOpen.current = false; setConfirm(false); setChecked(event.target.checked); setError(''); }} /><span>I checked these quantities, kept these pieces aside, and attached their new labels with the old codes covered.</span></label></fieldset>
            </>}
        </>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex flex-wrap justify-between gap-2 border-t border-gray-200 dark:border-gray-700 pt-4"><Button variant="outline" onClick={() => { void load(); }} disabled={saving || pending || loading}>Reload items</Button><div className="flex gap-2"><Button variant="secondary" onClick={close} disabled={saving || pending}>Back</Button>{draft?.status === 'DRAFT' && <Button variant="primary" disabled={!ready || saving} onClick={() => { if (isCurrent() && ready) { confirmationOpen.current = true; setConfirm(true); } }}>Add to inventory</Button>}</div></div>
    </div></Modal><ConfirmDialog isOpen={confirm} onClose={() => { if (!posting.current) { confirmationOpen.current = false; setConfirm(false); } }} onConfirm={post} title="Add these pieces to inventory?" message={`These checked quantities will be added once and their new barcodes will be available in POS.${error ? `\n\n${error}` : ''}`} confirmText={error ? 'Retry' : 'Add to inventory'} variant="primary" loading={saving} />{sticker && <StickerPrintModal isOpen={true} onClose={() => setSticker(null)} product={sticker.product} variant={sticker} />}</>;
};
