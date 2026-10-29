import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { showToast } from '../ui/Toast';
import { useAuthStore } from '../../store/authStore';
import { inventoryWorkspaceService } from '../../services/inventory-workspace.service';
import { stockConversionService } from '../../services/stock-conversion.service';
import type { InventoryVariant } from '../../types/inventoryWorkspace';
import type { AdjustTrackedStockInput, StockAdjustmentKind } from '../../types/stockConversion';

export const TrackedStockAdjustmentModal: React.FC<{ variant: InventoryVariant; initialKind?: StockAdjustmentKind; onClose: () => void; onAdjusted: () => void }> = ({ variant, initialKind = 'RECEIPT', onClose, onAdjusted }) => {
    const { user } = useAuthStore();
    const actor = useRef(user?.id);
    const mounted = useRef(true);
    const requestId = useRef(0);
    const busy = useRef(false);
    const confirmed = useRef(false);
    const formVersion = useRef(0);
    const attempt = useRef<{ key: string; input: AdjustTrackedStockInput; uncertain?: boolean } | null>(null);
    const [current, setCurrent] = useState<InventoryVariant | null>(null);
    const [kind, setKind] = useState<StockAdjustmentKind>(initialKind);
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [confirm, setConfirm] = useState(false);
    const renderedVersion = formVersion.current;
    const isCurrent = () => { const active = useAuthStore.getState().user; return Boolean(mounted.current && active && active.id === actor.current && active.isActive !== false && (active.role === 'ADMIN' || active.permManageInventory)); };
    const load = async () => {
        if (!isCurrent() || busy.current || attempt.current?.uncertain) return;
        const request = ++requestId.current;
        setLoading(true); setCurrent(null); setQuantity(''); setError(''); setConfirm(false); confirmed.current = false; attempt.current = null; formVersion.current += 1;
        try {
            const data = await inventoryWorkspaceService.getInventory({ scope: 'TRACKED', groupBy: 'SIZE', search: variant.barcode || variant.sku, page: 1, pageSize: 50 });
            if (!isCurrent() || request !== requestId.current) return;
            const found = data.items.flatMap(group => group.variants).find(item => item.id === variant.id && item.scope === 'TRACKED');
            if (!found) throw new Error('This barcode is no longer in tracked inventory. Refresh inventory before adjusting it.');
            setCurrent(found);
        } catch (failure) { if (isCurrent() && request === requestId.current) setError((failure as Error).message || 'Could not load this stock balance.'); }
        finally { if (isCurrent() && request === requestId.current) setLoading(false); }
    };
    useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; requestId.current += 1; }; }, [variant.id]);
    const changed = () => { if (busy.current || attempt.current?.uncertain) return false; formVersion.current += 1; attempt.current = null; confirmed.current = false; setConfirm(false); setError(''); return true; };
    const close = () => { if (!busy.current && !attempt.current?.uncertain && !confirmed.current) onClose(); };
    const amount = Number(quantity);
    const valid = Boolean(current && quantity.trim() && Number.isInteger(amount) && (kind === 'RECOUNT' ? amount >= 0 : amount > 0) && reason.trim() && (kind !== 'DAMAGE' || amount <= current.stock));
    const adjust = async () => {
        if (!isCurrent() || busy.current || !confirmed.current || !current || !valid || renderedVersion !== formVersion.current) return;
        const payload = { variantId: current.id, kind, quantity: amount, ...(kind === 'RECOUNT' ? { expectedStock: current.stock } : {}), reason: reason.trim() };
        const key = JSON.stringify(payload);
        if (attempt.current?.key !== key) attempt.current = { key, input: { ...payload, operationId: crypto.randomUUID() } };
        const request = attempt.current;
        busy.current = true; setSaving(true); setError('');
        try {
            await stockConversionService.adjust(request.input);
            if (!isCurrent()) return;
            showToast('Stock adjustment recorded with its reason.', 'success');
            confirmed.current = false; setConfirm(false); onAdjusted();
        } catch (failure) {
            if ((failure as any).confirmedRejected !== true) request.uncertain = true;
            if (isCurrent()) { setPending(Boolean(request.uncertain)); setError(`${(failure as Error).message || 'Could not confirm the stock adjustment.'} Retry the same request before making another change.`); }
        }
        finally { if (isCurrent()) { busy.current = false; setSaving(false); } }
    };
    return <><Modal isOpen={Boolean(user)} onClose={close} title="Record a stock adjustment" size="md"><div className="space-y-4"><div className="text-sm"><p className="font-semibold">{variant.name} · {variant.size || 'Standard'}</p><p className="font-mono text-xs text-gray-500">{variant.barcode}</p><p className="mt-2">Current tracked balance: {loading ? 'Loading…' : current?.stock ?? 'Unavailable'}</p></div><p className="text-xs text-gray-500">Use a receipt for new pieces, damage for pieces removed, or a recount to correct the physically counted total. Every change is recorded in movement history.</p>{error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}<fieldset disabled={loading || saving || pending || !current} className="space-y-4"><div><label className="label" htmlFor="stock-adjustment-kind">Adjustment</label><select id="stock-adjustment-kind" className="input" value={kind} onChange={event => { if (changed()) setKind(event.target.value as StockAdjustmentKind); }}><option value="RECEIPT">Stock received</option><option value="DAMAGE">Damaged / removed</option><option value="RECOUNT">Physical recount</option></select></div><Input label={kind === 'RECOUNT' ? 'Actual total pieces counted' : 'Number of pieces'} type="number" min={kind === 'RECOUNT' ? 0 : 1} step="1" value={quantity} onWheel={event => event.currentTarget.blur()} onChange={event => { if (changed()) setQuantity(event.target.value); }} /><Input label="Reason" placeholder="e.g. Newly received pieces or damaged garment" value={reason} maxLength={500} onChange={event => { if (changed()) setReason(event.target.value); }} /></fieldset>{kind === 'RECOUNT' && <p className="text-xs text-amber-700 dark:text-amber-300">If sales change this balance before saving, the recount will be rejected. Reload stock and physically check the total again.</p>}<div className="flex flex-wrap justify-between gap-2 border-t border-gray-200 dark:border-gray-700 pt-4"><Button variant="outline" disabled={loading || saving || pending} onClick={() => { void load(); }}>Reload stock</Button><div className="flex gap-2"><Button variant="secondary" onClick={close} disabled={saving || pending}>Cancel</Button><Button variant="primary" disabled={!valid || loading || saving} onClick={() => { if (isCurrent() && valid) { confirmed.current = true; setConfirm(true); } }}>Review adjustment</Button></div></div></div></Modal><ConfirmDialog isOpen={confirm} onClose={() => { if (!busy.current) { confirmed.current = false; setConfirm(false); } }} onConfirm={adjust} title="Save this stock adjustment?" message={`${kind === 'RECOUNT' ? `Set the stock total to ${amount} pieces from the checked balance of ${current?.stock}?` : `${kind === 'DAMAGE' ? 'Remove' : 'Add'} ${amount} pieces ${kind === 'DAMAGE' ? 'from' : 'to'} tracked stock?`}\nReason: ${reason.trim()}${error ? `\n\n${error}` : ''}`} confirmText={error ? 'Retry adjustment' : 'Save adjustment'} variant="primary" loading={saving} /></>;
};
