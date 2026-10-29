import React, { useRef, useState } from 'react';
import { stockConversionService } from '../../services/stock-conversion.service';
import type { InventoryVariant } from '../../types/inventoryWorkspace';
import type { AdjustTrackedStockInput } from '../../types/stockConversion';

export const QuickStockCount: React.FC<{ variant: InventoryVariant; disabled: boolean; onChanged: () => void }> = ({ variant, disabled, onChanged }) => {
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const request = useRef<AdjustTrackedStockInput | null>(null), saving = useRef(false);
    const save = async (delta: number) => {
        if (saving.current || disabled || variant.stock + delta < 0) return;
        request.current ||= { operationId: crypto.randomUUID(), variantId: variant.id, kind: 'RECOUNT', expectedStock: variant.stock,
            quantity: variant.stock + delta, reason: 'Quick physical count correction from Stock inventory' };
        saving.current = true; setBusy(true); setError('');
        try { await stockConversionService.adjust(request.current); request.current = null; setPending(false); onChanged(); }
        catch (failure) { const uncertain = (failure as any).confirmedRejected !== true; setPending(uncertain); if (!uncertain) request.current = null; setError((failure as Error).message); }
        finally { saving.current = false; setBusy(false); }
    };
    return <div className="inline-flex flex-col items-end"><div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"><button type="button" aria-label={`Decrease stock ${variant.barcode}`} disabled={disabled || busy || pending || variant.stock <= 0} className="px-3 py-2 disabled:opacity-30" onClick={() => { void save(-1); }}>−</button><span className="min-w-[35px] text-center font-semibold">{variant.stock}</span><button type="button" aria-label={`Increase stock ${variant.barcode}`} disabled={disabled || busy || pending} className="px-3 py-2 disabled:opacity-30" onClick={() => { void save(1); }}>+</button></div>{error && <p role="alert" className="max-w-[220px] text-xs text-red-600 mt-1">{error}</p>}{pending && <button type="button" disabled={busy || disabled} className="text-xs text-indigo-600 mt-1" onClick={() => { void save(0); }}>Retry same count correction</button>}</div>;
};
