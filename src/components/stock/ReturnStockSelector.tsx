import { useEffect, useRef, useState } from 'react';
import type { ReturnStockChoice, ReturnStockOptions } from '../../types/returnStock';
import { useAuthStore } from '../../store/authStore';

export function validReturnStockChoice(choice: ReturnStockChoice | undefined): boolean {
    return Boolean(choice?.confirmed && (choice.disposition === 'ORIGINAL'
        || choice.disposition === 'TRACKED' && choice.targetVariantId?.trim()
        || choice.disposition === 'HOLD' && choice.reason?.trim()));
}

/** A return's original price/item never changes when its physical destination is selected. */
export function ReturnStockSelector({ sourceVariantId, value, onChange, disabled = false }: {
    sourceVariantId: string;
    value?: ReturnStockChoice;
    onChange: (choice: ReturnStockChoice) => void;
    disabled?: boolean;
}) {
    const userId = useAuthStore(state => state.user?.id);
    const [options, setOptions] = useState<ReturnStockOptions | null>(null);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const request = useRef(0);
    const scope = useRef('');
    useEffect(() => {
        const current = ++request.current;
        const key = `${sourceVariantId}:${userId}`;
        if (scope.current !== key) {
            scope.current = key; setOptions(null);
            if (value) onChange({ disposition: value.disposition, confirmed: false });
        }
        setLoading(true); setError('');
        const timer = setTimeout(async () => {
            try {
                const api = window.electronAPI?.sales?.getReturnStockOptions;
                if (!api) throw new Error('Return stock selection needs the updated desktop app.');
                const result = await api({ sourceVariantId, search });
                if (current !== request.current) return;
                if (!result?.success) throw new Error(result?.error || 'Could not load returned stock options.');
                setOptions(result.data);
                if (!result.data.requiresChoice && value?.disposition !== 'HOLD') onChange({ disposition: 'ORIGINAL', confirmed: true });
            } catch (cause) {
                if (current === request.current) setError(cause instanceof Error ? cause.message : 'Could not load returned stock options.');
            } finally { if (current === request.current) setLoading(false); }
        }, search ? 200 : 0);
        return () => { clearTimeout(timer); request.current++; };
    }, [sourceVariantId, userId, search, reload]);

    const update = (patch: Partial<ReturnStockChoice>) => onChange({ disposition: value?.disposition || 'ORIGINAL', confirmed: false, ...value, ...patch });
    if (options && !options.requiresChoice && !options.sourceTracked && value?.disposition !== 'HOLD') return null;
    return <fieldset disabled={disabled} className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700 text-sm">
        <legend className="px-1 font-medium">Where will this returned garment go?</legend>
        {error ? <div role="alert" className="text-red-600">{error} <button type="button" className="underline" onClick={() => setReload(reload + 1)}>Retry</button></div> : <>
            {loading && <p role="status" className="text-gray-500">Checking stock options…</p>}
            <select aria-label="Returned garment stock destination" value={value?.disposition || ''} disabled={!options || loading}
                onChange={event => onChange({ disposition: event.target.value as ReturnStockChoice['disposition'], confirmed: false })}
                className="w-full rounded border p-2 bg-white dark:bg-gray-800">
                <option value="" disabled>Choose the physical stock destination</option>
                <option value="ORIGINAL">{options?.sourceTracked ? 'Restock its original tracked barcode' : 'Keep its old label — unverified stock'}</option>
                {options?.requiresChoice && <option value="TRACKED">Identify and label a matching tracked item</option>}
                <option value="HOLD">Hold separately — damaged or unidentified</option>
            </select>
            {value?.disposition === 'TRACKED' && <div className="space-y-2 mt-2">
                <input aria-label="Search matching returned stock" placeholder="Search new barcode, size, brand or fabric" value={search}
                    onChange={event => { setSearch(event.target.value); update({ targetVariantId: undefined, confirmed: false }); }}
                    className="w-full rounded border p-2 bg-white dark:bg-gray-800" />
                <select aria-label="Matching tracked item" value={value.targetVariantId || ''} disabled={loading}
                    onChange={event => update({ targetVariantId: event.target.value, confirmed: false })}
                    className="w-full rounded border p-2 bg-white dark:bg-gray-800">
                    <option value="">Choose the exact physical item</option>
                    {(options?.items || []).map(item => <option key={item.id} value={item.id}>{item.barcode} — {item.description}</option>)}
                </select>
                {!loading && !options?.items.length && <p className="text-amber-700">No matching tracked item found. Keep the old label or hold the garment for identification.</p>}
                <p className="text-xs text-gray-500">Check size, fabric and design. Apply the selected new barcode and cover the old label before placing it on the shelf.</p>
            </div>}
            {value?.disposition === 'HOLD' && <input aria-label="Reason for holding returned garment" value={value.reason || ''}
                placeholder="Reason: damaged, unidentified, needs inspection…" maxLength={500}
                onChange={event => update({ reason: event.target.value, confirmed: false })}
                className="mt-2 w-full rounded border p-2 bg-white dark:bg-gray-800" />}
            {value?.disposition && <label className="mt-2 flex items-start gap-2">
                <input type="checkbox" checked={value.confirmed} disabled={loading || !options}
                    onChange={event => update({ confirmed: event.target.checked })} />
                <span>{value.disposition === 'HOLD' ? 'I kept these pieces outside saleable stock.' : value.disposition === 'TRACKED'
                    ? 'I identified these pieces and applied the matching label.' : 'I checked that these pieces still carry their original barcode.'}</span>
            </label>}
        </>}
    </fieldset>;
}
