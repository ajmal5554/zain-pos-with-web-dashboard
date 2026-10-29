import React, { useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { stockAuditSetupService } from '../../services/stock-audit-setup.service';
import { defaultAuditCategory } from '../../types/stockAuditSetup';
import type { StockAuditSetup, SaveAuditSetupInput } from '../../types/stockAuditSetup';
const csv = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);

export const AuditSetupModal: React.FC<{ setup: StockAuditSetup; selected: string; onClose: () => void; onSaved: (setup: StockAuditSetup) => void }> = ({ setup, selected, onClose, onSaved }) => {
    const [categories, setCategories] = useState(() => structuredClone(setup.categories));
    const [index, setIndex] = useState(Math.max(0, setup.categories.findIndex(category => category.name === selected)));
    const [newCategory, setNewCategory] = useState('');
    const [newType, setNewType] = useState('');
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [dirty, setDirty] = useState(false);
    const [discard, setDiscard] = useState(false);
    const request = useRef<SaveAuditSetupInput | null>(null);
    const saving = useRef(false);
    const category = categories[index];
    const update = (next: typeof category) => { if (saving.current || pending) return; setDirty(true); request.current = null; setCategories(previous => previous.map((item, i) => i === index ? next : item)); };
    const close = () => { if (!saving.current && !pending) dirty ? setDiscard(true) : onClose(); };
    const save = async () => {
        if (saving.current) return;
        request.current ||= { operationId: crypto.randomUUID(), expectedRevision: setup.revision, categories };
        saving.current = true; setBusy(true); setError('');
        try { const result = await stockAuditSetupService.save(request.current); onSaved(result); }
        catch (failure) { const uncertain = (failure as any).confirmedRejected !== true; setPending(uncertain); if (!uncertain) request.current = null; setError((failure as Error).message); }
        finally { saving.current = false; setBusy(false); }
    };
    return <><Modal isOpen onClose={close} title="Customize stock audit" size="xl"><div className="space-y-5">
        <p className="text-sm text-gray-500">Configure categories, brands, attribute types, options and size scales. Removing an option here never deletes saved inventory.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <fieldset disabled={busy || pending} className="space-y-5">
            <div className="flex gap-2"><Input label="New category" value={newCategory} maxLength={100} onChange={event => setNewCategory(event.target.value)} /><Button variant="outline" className="self-end" disabled={!newCategory.trim()} onClick={() => { const name = newCategory.trim(); const existing = categories.findIndex(item => item.name.toLowerCase() === name.toLowerCase()); if (existing >= 0) { setIndex(existing); return; } setCategories([...categories, defaultAuditCategory(name)]); setIndex(categories.length); setNewCategory(''); setDirty(true); }}>Add category</Button></div>
            <div className="flex flex-wrap gap-2">{categories.map((item, i) => <button type="button" key={item.name} className={`rounded-lg border px-3 py-2 text-sm ${index === i ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 dark:border-gray-700'}`} onClick={() => setIndex(i)}>{item.name}</button>)}</div>
            <div><label className="label" htmlFor="audit-setup-brands">Brands for {category.name} (comma separated)</label><textarea id="audit-setup-brands" className="input" rows={2} value={category.brands.join(', ')} onChange={event => update({ ...category, brands: event.target.value.split(',') })} onBlur={() => update({ ...category, brands: category.brands.map(value => value.trim()).filter(Boolean) })} /></div>
            <h3 className="font-semibold">Attribute types and selectable options</h3>
            {category.groups.map((group, groupIndex) => <div key={group.key} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2"><div className="flex gap-3 items-end"><Input label="Attribute type" value={group.label} maxLength={100} onChange={event => update({ ...category, groups: category.groups.map((item, i) => i === groupIndex ? { ...item, label: event.target.value } : item) })} /><Button variant="ghost" onClick={() => update({ ...category, groups: category.groups.filter((_, i) => i !== groupIndex) })}>Remove type</Button></div><label className="label" htmlFor={`audit-options-${group.key}`}>Options (comma separated)</label><textarea id={`audit-options-${group.key}`} className="input" rows={2} value={group.options.join(',')} onChange={event => update({ ...category, groups: category.groups.map((item, i) => i === groupIndex ? { ...item, options: event.target.value.split(',') } : item) })} onBlur={() => update({ ...category, groups: category.groups.map((item, i) => i === groupIndex ? { ...item, options: csv(item.options.join(',')) } : item) })} /></div>)}
            <div className="flex gap-2"><Input label="New attribute type" placeholder="e.g. Wash or Stretch" value={newType} maxLength={70} onChange={event => setNewType(event.target.value)} /><Button variant="outline" className="self-end" disabled={!newType.trim()} onClick={() => { const key = `custom_${newType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 45) || 'attribute'}_${crypto.randomUUID().slice(0, 8)}`; update({ ...category, groups: [...category.groups, { key, label: newType.trim(), options: [] }] }); setNewType(''); }}>Add attribute type</Button></div>
            <h3 className="font-semibold">Size scales</h3>
            {category.scales.map((scale, scaleIndex) => <div key={scaleIndex} className="flex flex-wrap items-end gap-2"><Input label="Scale name" value={scale.name} onChange={event => update({ ...category, scales: category.scales.map((item, i) => i === scaleIndex ? { ...item, name: event.target.value } : item) })} /><div className="flex-1"><label className="label" htmlFor={`audit-scale-${scaleIndex}`}>Sizes (comma separated)</label><input id={`audit-scale-${scaleIndex}`} className="input" value={scale.sizes.join(',')} onChange={event => update({ ...category, scales: category.scales.map((item, i) => i === scaleIndex ? { ...item, sizes: event.target.value.split(',') } : item) })} onBlur={() => update({ ...category, scales: category.scales.map((item, i) => i === scaleIndex ? { ...item, sizes: csv(item.sizes.join(',')) } : item) })} /></div><Button variant="ghost" onClick={() => update({ ...category, scales: category.scales.filter((_, i) => i !== scaleIndex) })}>Remove scale</Button></div>)}
            <Button variant="outline" onClick={() => update({ ...category, scales: [...category.scales, { name: `Custom ${category.scales.length + 1}`, sizes: ['Free Size'] }] })}>Add size scale</Button>
        </fieldset>
        <div className="flex justify-end gap-2 border-t pt-4 dark:border-gray-700"><Button variant="secondary" disabled={busy || pending} onClick={close}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => { void save(); }}>{busy ? 'Saving…' : pending ? 'Retry same save' : 'Save setup'}</Button></div>
    </div></Modal><ConfirmDialog isOpen={discard} onClose={() => setDiscard(false)} onConfirm={onClose} title="Discard setup changes?" message="Your unsaved category and attribute changes will be discarded." confirmText="Discard changes" /></>;
};
