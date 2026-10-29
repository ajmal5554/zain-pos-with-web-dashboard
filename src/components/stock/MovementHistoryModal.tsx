import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { stockService } from '../../services/stock.service';
import type { StockMovementsResponse } from '../../services/stock.service';
import { useAuthStore } from '../../store/authStore';

const shopDate = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`;
};
const movementLabel = (type: string) => (({ IN: 'Stock In', OUT: 'Stock Out', SALE: 'Sale', REFUND: 'Customer Refund', EXCHANGE_RETURN: 'Exchange Return', EXCHANGE_OUT: 'Exchange Out', ADJUSTMENT: 'Adjustment', VOID: 'Voided Sale', OPENING_COUNT: 'Opening Count', RECEIPT: 'Stock Received', DAMAGE: 'Damaged / Removed', RECOUNT: 'Physical Recount' } as Record<string, string>)[type] || type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase()));

export const MovementHistoryModal: React.FC<{ variantId: string; onClose: () => void }> = ({ variantId, onClose }) => {
    const { user } = useAuthStore();
    const actor = useRef(user?.id);
    const mounted = useRef(true);
    const requestId = useRef(0);
    const [data, setData] = useState<StockMovementsResponse | null>(null);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const limit = 50;
    const isCurrent = () => { const active = useAuthStore.getState().user; return Boolean(mounted.current && active && active.id === actor.current && active.isActive !== false && (active.role === 'ADMIN' || active.permManageInventory)); };
    const load = async () => {
        if (!isCurrent()) return;
        const request = ++requestId.current;
        if (from && to && from > to) {
            setLoading(false);
            setError('From date must be on or before the to date. Correct the dates to view movements.');
            return;
        }
        setLoading(true); setError('');
        try {
            const next = await stockService.getMovements({ variantId, fromDate: from || undefined, toDate: to || undefined, limit, offset });
            if (!isCurrent() || request !== requestId.current) return;
            if (next.variant.id !== variantId) throw new Error('The wrong item history was returned. Retry this item.');
            setData(next);
        } catch (failure) { if (isCurrent() && request === requestId.current) setError((failure as Error).message || 'Could not load movement history.'); }
        finally { if (isCurrent() && request === requestId.current) setLoading(false); }
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestId.current += 1; }; }, []);
    useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [variantId, from, to, offset]);
    const range = (days: number | 'today' | 'all') => {
        const today = new Date();
        const nextTo = days === 'all' ? '' : shopDate(today);
        const nextFrom = days === 'all' ? '' : shopDate(new Date(today.getTime() - (days === 'today' ? 0 : days - 1) * 86400000));
        if (from === nextFrom && to === nextTo && offset === 0) { void load(); return; }
        requestId.current += 1; setOffset(0); setTo(nextTo); setFrom(nextFrom);
    };
    const allowed = Boolean(user && user.isActive !== false && (user.role === 'ADMIN' || user.permManageInventory));
    return <Modal isOpen={allowed} onClose={onClose} title="Inventory movement history" size="xl"><div className="space-y-4">
        {data && <div className="text-sm"><p className="font-semibold">{data.variant.product.name} · {data.variant.size || 'Standard'}</p><p className="text-xs font-mono text-gray-500">{data.variant.barcode || data.variant.sku}</p></div>}
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><input type="date" aria-label="Movement from date" title="From date" className="input text-xs" value={from} onChange={event => { requestId.current += 1; setFrom(event.target.value); setOffset(0); }} /><span className="text-xs text-gray-500">to</span><input type="date" aria-label="Movement to date" title="To date" className="input text-xs" value={to} onChange={event => { requestId.current += 1; setTo(event.target.value); setOffset(0); }} /></div><div className="flex gap-1 flex-wrap">{[['All Time', 'all'], ['Today', 'today'], ['7 Days', 7], ['30 Days', 30]].map(([label, days]) => <Button key={label} variant="outline" size="sm" onClick={() => range(days as number | 'today' | 'all')}>{label}</Button>)}</div></div>
        {loading ? <p role="status" className="py-10 text-center text-gray-500">Loading movements…</p> : error ? <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/20 p-4 text-sm text-red-700 dark:text-red-300"><p>{error}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => { void load(); }}>Retry</Button></div> : !data?.movements.length ? <p className="py-10 text-center text-sm text-gray-500">No recorded movements{from || to ? ' in the selected date range.' : '.'}</p> : <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700"><table className="w-full text-left text-xs"><thead className="bg-gray-50 dark:bg-gray-900"><tr><th className="p-3">Timestamp</th><th className="p-3">Type</th><th className="p-3 text-right">Quantity</th><th className="p-3">Reason</th><th className="p-3">Reference</th><th className="p-3">Operator</th></tr></thead><tbody>{data.movements.map(movement => <tr key={movement.id} className="border-t border-gray-100 dark:border-gray-800"><td className="p-3 whitespace-nowrap">{new Date(movement.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td className="p-3">{movementLabel(movement.type)}</td><td className={`p-3 text-right font-semibold ${movement.quantity < 0 ? 'text-red-600' : movement.quantity > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>{movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}</td><td className="p-3 break-words">{movement.reason || '—'}</td><td className="p-3 font-mono break-all">{movement.reference || '—'}</td><td className="p-3">{movement.operatorName || movement.createdBy || 'System'}</td></tr>)}</tbody></table></div>}
        {!loading && !error && data && data.totalMovements > limit && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500"><span>Showing {offset + 1} to {Math.min(offset + limit, data.totalMovements)} of {data.totalMovements}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={offset <= 0} onClick={() => { requestId.current += 1; setOffset(value => Math.max(0, value - limit)); }}>Prev</Button><Button variant="outline" size="sm" disabled={offset + limit >= data.totalMovements} onClick={() => { requestId.current += 1; setOffset(value => value + limit); }}>Next</Button></div></div>}
        <div className="flex justify-end border-t border-gray-200 dark:border-gray-700 pt-3"><Button variant="secondary" onClick={onClose}>Close</Button></div>
    </div></Modal>;
};
