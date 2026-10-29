import React, { useEffect, useRef, useState } from 'react';
import { Plus, Settings, Shirt, Tag } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { showToast } from '../ui/Toast';
import { AuditSetupModal } from './AuditSetupModal';
import { stockAuditSetupService } from '../../services/stock-audit-setup.service';
import { stockConversionService } from '../../services/stock-conversion.service';
import { useAuthStore } from '../../store/authStore';
import type { StockAuditSetup } from '../../types/stockAuditSetup';
import type { StockEntryInput } from '../../types/stockEntry';

type Form = { category: string; brand: string; name: string; mrp: string; batch: string; attributes: Record<string, string | null>; quantities: Record<string, string>; scale: number; keep: boolean; catalogueOnly?: boolean };
const empty = (): Form => ({ category: '', brand: '', name: '', mrp: '', batch: '', attributes: {}, quantities: {}, scale: 0, keep: true });
const chip = (selected: boolean) => `rounded-lg border px-3 py-2 text-sm transition-colors ${selected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-400'}`;
export const RackAuditView: React.FC<{ onInventoryChanged: () => void; onBlockedChange: (blocked: boolean) => void }> = ({ onInventoryChanged, onBlockedChange }) => {
    const owner = useRef(useAuthStore.getState().user?.id);
    const draftKey = `zain-pos-rack-audit:${owner.current}`;
    const initial = useRef<{ form: Form; request: StockEntryInput | null } | null>(null);
    if (!initial.current) {
        try { const value = JSON.parse(localStorage.getItem(draftKey) || 'null'); initial.current = value?.form && typeof value.form.category === 'string' ? value : { form: empty(), request: null }; }
        catch { initial.current = { form: empty(), request: null }; }
    }
    const [form, setForm] = useState<Form>(initial.current!.form);
    const [setup, setSetup] = useState<StockAuditSetup | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [pending, setPending] = useState(Boolean(initial.current!.request));
    const [error, setError] = useState('');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [discard, setDiscard] = useState(false);
    const [add, setAdd] = useState<{ kind: 'brand' | 'option' | 'size'; key?: string; label: string } | null>(null);
    const [text, setText] = useState('');
    const [setupPending, setSetupPending] = useState(false);
    const setupAttempt = useRef<any>(null);
    const attempt = useRef<StockEntryInput | null>(initial.current!.request);
    const inFlight = useRef(false), mounted = useRef(true);
    const current = () => { const user = useAuthStore.getState().user; return mounted.current && user?.id === owner.current && user?.isActive !== false && (user?.role === 'ADMIN' || user?.permManageInventory); };
    const persist = (next: Form, request = attempt.current) => { try { localStorage.setItem(draftKey, JSON.stringify({ form: next, request })); } catch { /* Form stays available in this window. */ } };
    const update = (next: Partial<Form>) => { if (inFlight.current || pending || setupPending) return; setForm(previous => { const value = { ...previous, ...next }; persist(value, null); return value; }); setDirty(true); attempt.current = null; };
    const load = async () => {
        setLoading(true); setError('');
        try { const value = await stockAuditSetupService.get(); if (current()) setSetup(value); }
        catch (failure) { if (current()) setError((failure as Error).message); }
        finally { if (current()) setLoading(false); }
    };
    useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
    useEffect(() => { onBlockedChange(busy || pending || dirty || settingsOpen || Boolean(add)); }, [busy, pending, dirty, settingsOpen, add, onBlockedChange]);
    const category = setup?.categories.find(item => item.name === form.category);
    const scale = category?.scales[form.scale] || category?.scales[0];
    const sizes = [...new Set([...(scale?.sizes || []), ...Object.entries(form.quantities).filter(([, amount]) => form.catalogueOnly || Number(amount) !== 0).map(([size]) => size)])];
    const total = Object.values(form.quantities).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const valid = Boolean(category && form.mrp.trim() && Number(form.mrp) > 0 && Number.isFinite(Number(form.mrp)) && (form.catalogueOnly ? Object.keys(form.quantities).length > 0 : total > 0)
        && Object.values(form.quantities).every(value => value === '' || Number.isSafeInteger(Number(value)) && Number(value) >= 0));
    const chooseCategory = (name: string) => {
        if (name === form.category) return;
        if (total > 0) { setError('Save this counted rack or clear its counts before changing category.'); return; }
        update({ category: name, attributes: {}, quantities: {}, scale: 0 }); setError('');
    };
    const count = (size: string, value: string) => update({ quantities: { ...form.quantities, [size]: value } });
    const save = async () => {
        if (!current() || inFlight.current || (!pending && !valid)) return;
        attempt.current ||= { operationId: crypto.randomUUID(), batchName: form.batch.trim() || `Rack audit ${new Date().toLocaleDateString('en-IN')}`, mergeMatching: true,
            rows: Object.entries(form.quantities).filter(([, amount]) => form.catalogueOnly || Number(amount) > 0).map(([size, amount]) => ({ name: form.name.trim() || [form.brand || form.category, form.attributes.pattern].filter(Boolean).join(' '),
                category: form.category, brand: form.brand, size, mrp: Number(form.mrp), quantity: form.catalogueOnly ? 0 : Number(amount), attributes: { ...form.attributes }, attributeLabels: Object.fromEntries((category?.groups || []).map(group => [group.key, group.label])) })) };
        persist(form); inFlight.current = true; setBusy(true); setError('');
        try {
            const result = await stockConversionService.saveEntry(attempt.current);
            if (!current()) return;
            attempt.current = null; setPending(false); setConfirm(false); setDirty(false);
            const next = form.keep ? { ...form, quantities: {} } : { ...empty(), category: form.category, batch: form.batch };
            setForm(next); persist(next, null); onInventoryChanged();
            showToast(form.catalogueOnly ? 'Item codes created with zero stock. Receive the delivery in Purchases.' : `${result.totalPieces} pieces saved. Ready for the next rack.`, 'success');
        } catch (failure) {
            if (current()) { const uncertain = (failure as any).confirmedRejected !== true; setPending(uncertain); if (!uncertain) attempt.current = null; persist(form); setConfirm(false); setError((failure as Error).message); }
        } finally { inFlight.current = false; if (current()) setBusy(false); }
    };
    const openAdd = (value: NonNullable<typeof add>) => { setText(''); setAdd(value); setError(''); };
    const saveOption = async () => {
        if (!setup || !category || !add || inFlight.current || !text.trim()) return;
        const value = text.trim();
        const next = structuredClone(setup.categories), selected = next.find(item => item.name === category.name)!;
        const push = (items: string[]) => { if (!items.some(item => item.toLowerCase() === value.toLowerCase())) items.push(value); };
        if (add.kind === 'brand') push(selected.brands);
        else if (add.kind === 'option') push(selected.groups.find(group => group.key === add.key)!.options);
        else {
            if (!selected.scales.length) selected.scales.push({ name: 'Custom', sizes: [] });
            push((selected.scales[form.scale] || selected.scales[0]).sizes);
        }
        setupAttempt.current ||= { operationId: crypto.randomUUID(), expectedRevision: setup.revision, categories: next };
        inFlight.current = true; setBusy(true); setError('');
        try {
            const result = await stockAuditSetupService.save(setupAttempt.current);
            if (!current()) return;
            setSetup(result); setupAttempt.current = null; setSetupPending(false);
            const nextForm = add.kind === 'brand' ? { ...form, brand: value } : add.kind === 'option' ? { ...form, attributes: { ...form.attributes, [add.key!]: value } } : { ...form, quantities: { ...form.quantities, [value]: form.quantities[value] || '0' } };
            setForm(nextForm); persist(nextForm); setDirty(true); setAdd(null);
        } catch (failure) { if (current()) { const uncertain = (failure as any).confirmedRejected !== true; setSetupPending(uncertain); if (!uncertain) setupAttempt.current = null; setError((failure as Error).message); } }
        finally { inFlight.current = false; if (current()) setBusy(false); }
    };
    if (loading) return <p className="p-6 text-gray-500">Loading rack audit setup…</p>;
    if (!setup) return <div role="alert" className="p-6 space-y-3"><p>{error || 'Audit setup is unavailable.'}</p><Button onClick={() => { void load(); }}>Retry loading</Button></div>;
    return <div className="space-y-5">
        <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold flex gap-2 items-center"><Shirt className="text-indigo-500" />Rack audit</h2><p className="text-sm text-gray-500">Select the garment details, count by size and save this rack.</p></div><Button variant="outline" disabled={busy || pending} onClick={() => setSettingsOpen(true)}><Settings size={16} />Customize categories & attributes</Button></div>
        {error && <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-600">{error}</p>}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)] gap-6 items-start">
            <fieldset disabled={busy || pending || settingsOpen || Boolean(add)} className="space-y-5 min-w-0">
                <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card p-5"><div className="flex justify-between mb-4"><h3 className="label uppercase">Category</h3><button type="button" className="text-sm text-indigo-600" onClick={() => setSettingsOpen(true)}>+ New</button></div><div className="flex flex-wrap gap-2">{setup.categories.map(item => <button type="button" key={item.name} aria-pressed={form.category === item.name} className={chip(form.category === item.name)} onClick={() => chooseCategory(item.name)}>{item.name}</button>)}</div></section>
                <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card p-5 space-y-3"><div className="flex justify-between"><h3 className="label uppercase flex items-center gap-2"><Tag size={15} />Brand / Company</h3><button type="button" disabled={!category} className="text-sm text-indigo-600" onClick={() => openAdd({ kind: 'brand', label: 'Add brand' })}>+ Add brand</button></div><Input aria-label="Search or enter brand" placeholder="Search or enter brand…" value={form.brand} maxLength={100} onChange={event => update({ brand: event.target.value })} /><div className="flex flex-wrap gap-2">{(category?.brands || []).filter(brand => !form.brand || brand.toLowerCase().includes(form.brand.toLowerCase()) || category?.brands.some(item => item.toLowerCase() === form.brand.toLowerCase())).map(brand => <button type="button" key={brand} className={chip(form.brand === brand)} onClick={() => update({ brand })}>{brand}</button>)}</div></section>
                <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card p-5 space-y-5"><div className="flex justify-between"><div><h3 className="label uppercase">Attributes</h3><p className="text-xs text-gray-500">{category ? `Options for ${category.name}` : 'Select a category first'}</p></div><button type="button" disabled={!category} className="text-sm text-indigo-600" onClick={() => setSettingsOpen(true)}>+ Add attribute type</button></div>
                    {category?.groups.map(group => <div key={group.key}><h4 className="label uppercase text-xs mb-2">{group.label}</h4><div className="flex flex-wrap gap-2">{group.options.map(option => <button type="button" key={option} aria-pressed={form.attributes[group.key] === option} className={chip(form.attributes[group.key] === option)} onClick={() => update({ attributes: { ...form.attributes, [group.key]: form.attributes[group.key] === option ? null : option } })}>{option}</button>)}<button type="button" className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-500" onClick={() => openAdd({ kind: 'option', key: group.key, label: `Add ${group.label} option` })}>+ Add</button></div></div>)}
                </section>
                <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card p-5 space-y-4">{Boolean(category?.popularPrices?.length) && <div><p className="label text-xs">Most used prices in stock</p><div className="flex flex-wrap gap-2">{category?.popularPrices?.map(item => <button key={item.price} type="button" className={chip(Number(form.mrp) === item.price)} onClick={() => update({ mrp: String(item.price) })}>₹{item.price} <span className="text-xs opacity-70">{item.pieces} pcs</span></button>)}</div></div>}<div className="flex gap-2 items-end"><Input label="MRP price (₹)" type="number" min="0.01" step="0.01" value={form.mrp} onWheel={event => event.currentTarget.blur()} onChange={event => update({ mrp: event.target.value })} /><Button variant="outline" onClick={() => update({ mrp: String((Number(form.mrp) || 0) + 100) })}>+100</Button><Button variant="outline" onClick={() => update({ mrp: String((Number(form.mrp) || 0) + 500) })}>+500</Button></div><Input label="Readable item name (optional)" placeholder={[form.brand || form.category, form.attributes.pattern].filter(Boolean).join(' ')} value={form.name} maxLength={200} onChange={event => update({ name: event.target.value })} /><Input label="Batch / rack name (optional)" placeholder="e.g. Rack A3 — October audit" value={form.batch} maxLength={200} onChange={event => update({ batch: event.target.value })} /></section>
            </fieldset>
            <div className="lg:sticky lg:top-4 space-y-4"><section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card p-5 space-y-4"><div className="flex justify-between"><h3 className="label uppercase">Size × Quantity</h3><button type="button" disabled={!category || busy || pending} className="text-indigo-600 text-sm" onClick={() => openAdd({ kind: 'size', label: 'Add custom size' })}>+ Custom</button></div><div className="flex flex-wrap gap-2">{category?.scales.map((item, index) => <button key={item.name} type="button" disabled={busy || pending} className={chip((category.scales[form.scale] ? form.scale : 0) === index)} onClick={() => update({ scale: index })}>{item.name}</button>)}</div>
                {!category && <p className="text-sm text-gray-400">Choose a category to show its sizes.</p>}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Create item codes only" checked={!!form.catalogueOnly} disabled={busy || pending || total > 0} onChange={event => update({ catalogueOnly: event.target.checked, quantities: {} })} />Create item codes only (receive in Purchases later)</label>
                {form.catalogueOnly && <p className="text-xs text-gray-500">Select the sizes to create. Their opening quantity will be zero.</p>}
                {form.catalogueOnly ? <div className="flex flex-wrap gap-2">{sizes.map(size => <button type="button" key={size} disabled={busy || pending} aria-label={`Create size ${size}`} aria-pressed={Object.prototype.hasOwnProperty.call(form.quantities, size)} className={chip(Object.prototype.hasOwnProperty.call(form.quantities, size))} onClick={() => { const next = { ...form.quantities }; if (Object.prototype.hasOwnProperty.call(next, size)) delete next[size]; else next[size] = '0'; update({ quantities: next }); }}>{size}</button>)}</div> : sizes.map(size => <div key={size} className="flex items-center justify-between gap-3"><span className="font-semibold text-sm">{size}</span><div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"><button type="button" aria-label={`Decrease ${size}`} disabled={busy || pending || Number(form.quantities[size] || 0) <= 0} className="px-3 py-2 disabled:opacity-30" onClick={() => count(size, String(Math.max(0, Number(form.quantities[size] || 0) - 1)))}>−</button><input aria-label={`Count ${size}`} type="number" min="0" step="1" className="w-20 text-center py-2 bg-transparent font-semibold" value={form.quantities[size] || ''} placeholder="0" disabled={busy || pending} onWheel={event => event.currentTarget.blur()} onChange={event => count(size, event.target.value)} /><button type="button" aria-label={`Increase ${size}`} disabled={busy || pending} className="px-3 py-2" onClick={() => count(size, String(Number(form.quantities[size] || 0) + 1))}>+</button></div></div>)}
                <div className="border-t dark:border-gray-700 pt-3 flex justify-between font-semibold"><span>Total pieces</span><span>{total.toLocaleString('en-IN')}</span></div>
            </section><Button variant="primary" className="w-full py-4" disabled={busy || (!pending && !valid)} onClick={() => pending ? void save() : setConfirm(true)}><Plus size={18} />{busy ? 'Saving…' : pending ? 'Retry same stock save' : form.catalogueOnly ? 'Create item codes with zero stock' : `Save ${total} pieces to inventory`}</Button><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.keep} disabled={busy || pending} onChange={event => update({ keep: event.target.checked })} />Keep style & price for next rack</label><p className="text-xs text-gray-500">Saving adds these pieces. A fully matching garment and size reuses its barcode; different attributes stay separate. Use Inventory to correct an existing total.</p><Button variant="ghost" disabled={busy || pending} onClick={() => setDiscard(true)}>Clear counts / start another style</Button></div>
        </div>
        {settingsOpen && <AuditSetupModal setup={setup} selected={form.category} onClose={() => setSettingsOpen(false)} onSaved={value => { setSetup(value); setSettingsOpen(false); showToast('Audit setup saved.', 'success'); }} />}
        <Modal isOpen={Boolean(add)} onClose={() => { if (!inFlight.current && !setupPending) setAdd(null); }} title={add?.label || 'Add option'} size="sm"><div className="space-y-4"><Input label="Name" value={text} maxLength={100} disabled={busy || setupPending} onChange={event => setText(event.target.value)} />{error && <p role="alert" className="text-red-600 text-sm">{error}</p>}<div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy || setupPending} onClick={() => setAdd(null)}>Cancel</Button><Button variant="primary" disabled={busy || !text.trim()} onClick={() => { void saveOption(); }}>{setupPending ? 'Retry same save' : 'Add'}</Button></div></div></Modal>
        <ConfirmDialog isOpen={confirm} onClose={() => { if (!inFlight.current) setConfirm(false); }} onConfirm={save} title={form.catalogueOnly ? "Create item codes?" : "Save counted stock?"} message={form.catalogueOnly ? "Create the selected sizes with zero stock? Record the delivery quantity and cost in Purchases afterwards." : `Add ${total} counted pieces to inventory? Use the assigned new barcodes when billing these garments. Old generic barcode sales cannot identify their detailed stock automatically.`} confirmText="Save stock" variant="primary" loading={busy} />
        <ConfirmDialog isOpen={discard} onClose={() => setDiscard(false)} onConfirm={() => { const next = { ...empty(), category: form.category, batch: form.batch }; setForm(next); persist(next, null); setDirty(false); setDiscard(false); }} title="Clear this rack entry?" message="The unsaved counts and selected style will be cleared. Saved inventory stays unchanged." confirmText="Clear entry" />
    </div>;
};
