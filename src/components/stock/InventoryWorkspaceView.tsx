import React, { useEffect, useRef, useState } from 'react';
import { QuickStockCount } from './QuickStockCount';
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight, Filter, History, Layers, List, Package, Pencil, RefreshCw, Search, Shapes, SlidersHorizontal, Tag, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useAuthStore } from '../../store/authStore';
import { inventoryWorkspaceService } from '../../services/inventory-workspace.service';
import type { InventoryGroup, InventoryGroupBy, InventoryQuery, InventoryScope, InventoryVariant, InventoryWorkspaceResponse } from '../../types/inventoryWorkspace';

export interface InventoryWorkspaceViewProps {
    scope: InventoryScope;
    onOpenAudit?: () => void;
    onViewMovements?: (variantId: string) => void;
    onEditProduct?: (productId: string) => void;
    onAdjustStock?: (variant: InventoryVariant) => void;
}

type Filters = {
    categoryId: string; brand: string; size: string; fabric: string; pattern: string; quality: string;
    balanceFilter: NonNullable<InventoryQuery['balanceFilter']>;
    attributes: Record<string, string>;
};
const initialFilters: Filters = { categoryId: '', brand: '', size: '', fabric: '', pattern: '', quality: '', balanceFilter: 'ALL', attributes: {} };
const titleFor = { TRACKED: 'Live inventory', LEGACY: 'Old items', PREPARED: 'Prepared catalogue' };
const quantityFor = { TRACKED: 'Pieces in stock', LEGACY: 'Recorded balance', PREPARED: 'Prepared balance' };
const prettyLabel = (value: string) => value.replace(/^custom_/, '').replace(/_[a-f0-9]{8}$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^\w/, char => char.toUpperCase());
const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const updatedTime = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const sessionKey = () => {
    const user = useAuthStore.getState().user;
    return user && user.isActive !== false && (user.role === 'ADMIN' || user.permManageInventory)
        ? `${user.id}:${user.role}:${Boolean(user.permManageInventory)}:${Boolean(user.permManageProducts)}` : '';
};
const visibleAttributes = (variant: InventoryVariant) => Object.entries(variant.attributes || {}).filter(([, value]) => value !== null && value !== '');
const sharedAttributes = (group: InventoryGroup) => group.variants.length ? visibleAttributes(group.variants[0]).filter(([key, value]) => group.variants.every(variant => variant.attributes?.[key] === value)) : [];

export const InventoryWorkspaceView: React.FC<InventoryWorkspaceViewProps> = (props) => {
    const { user } = useAuthStore();
    const canRead = Boolean(user && user.isActive !== false && (user.role === 'ADMIN' || user.permManageInventory));
    if (!canRead) return <p className="text-sm text-gray-600 dark:text-gray-400">You need inventory access to view stock.</p>;
    if (!window.electronAPI?.stock?.getInventory) return <p className="rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-600 dark:text-gray-400">Inventory is unavailable in this environment. Open the updated desktop POS app to view your stock.</p>;
    return <InventoryWorkspaceData key={`${sessionKey()}:${props.scope}`} {...props} />;
};

const FilterSelect: React.FC<{ label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }> = ({ label, value, options, onChange }) => {
    if (!options.length && !value) return null;
    const available = value && !options.some(option => option.value === value) ? [...options, { value, label: value }] : options;
    const plural = label === 'Category' ? 'categories' : label === 'Quality' ? 'qualities' : `${label.toLowerCase()}s`;
    return <div className="min-w-[145px] flex-1"><label className="label text-xs" htmlFor={`inventory-filter-${label.toLowerCase()}`}>{label}</label><select id={`inventory-filter-${label.toLowerCase()}`} aria-label={`Filter by ${label.toLowerCase()}`} className="input text-sm" value={value} onChange={event => onChange(event.target.value)}><option value="">All {plural}</option>{available.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
};

const InventoryWorkspaceData: React.FC<InventoryWorkspaceViewProps> = ({ scope, onOpenAudit, onViewMovements, onEditProduct, onAdjustStock }) => {
    const { user } = useAuthStore();
    const canEditProducts = Boolean(user && (user.role === 'ADMIN' || user.permManageProducts));
    const [groupBy, setGroupBy] = useState<InventoryGroupBy>('STYLE');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [filters, setFilters] = useState<Filters>({ ...initialFilters });
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [data, setData] = useState<InventoryWorkspaceResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const mounted = useRef(true);
    const actorKey = useRef(sessionKey());
    const requestId = useRef(0);
    const loadedQuery = useRef('');
    const dataRef = useRef<InventoryWorkspaceResponse | null>(null);
    const actionsReady = useRef(false);
    const current = useRef({ groupBy, search, debouncedSearch, filters, page });
    current.current = { groupBy, search, debouncedSearch, filters, page };
    const isCurrent = () => mounted.current && Boolean(actorKey.current) && actorKey.current === sessionKey();
    const queryKey = JSON.stringify({ scope, groupBy, search: debouncedSearch, filters, page });

    const fetchInventory = async () => {
        if (!isCurrent()) return;
        const view = current.current;
        if (view.search !== view.debouncedSearch) return;
        const request = ++requestId.current;
        const key = JSON.stringify({ scope, groupBy: view.groupBy, search: view.debouncedSearch, filters: view.filters, page: view.page });
        actionsReady.current = false;
        setLoading(true);
        const query: InventoryQuery = { scope, groupBy: view.groupBy, page: view.page, pageSize: 30 };
        if (view.debouncedSearch.trim()) query.search = view.debouncedSearch.trim();
        for (const key of ['categoryId', 'brand', 'size', 'fabric', 'pattern', 'quality'] as const) {
            if (view.filters[key]) query[key] = view.filters[key];
        }
        if (view.filters.balanceFilter !== 'ALL') query.balanceFilter = view.filters.balanceFilter;
        if (Object.values(view.filters.attributes).some(Boolean)) query.attributes = view.filters.attributes;
        try {
            const next = await inventoryWorkspaceService.getInventory(query);
            if (!isCurrent() || request !== requestId.current) return;
            dataRef.current = next;
            setData(next);
            loadedQuery.current = key;
            setError(null);
            actionsReady.current = true;
            if (next.page !== view.page) setPage(next.page);
        } catch (failure) {
            if (isCurrent() && request === requestId.current) setError(failure instanceof Error ? failure.message : 'Could not load inventory.');
        } finally {
            if (isCurrent() && request === requestId.current) setLoading(false);
        }
    };

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; requestId.current += 1; actionsReady.current = false; };
    }, []);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);
    useEffect(() => {
        if (search === debouncedSearch) void fetchInventory();
        return () => { requestId.current += 1; actionsReady.current = false; };
    }, [scope, groupBy, search, debouncedSearch, filters, page]);

    const startChange = () => { requestId.current += 1; actionsReady.current = false; setLoading(true); setError(null); setPage(1); };
    const changeFilter = (key: keyof Filters, value: string) => { startChange(); setFilters(previous => ({ ...previous, [key]: value })); };
    const clearFilters = () => { startChange(); setSearch(''); setFilters({ ...initialFilters }); };
    const changeGrouping = (value: InventoryGroupBy) => { if (groupBy !== value) { startChange(); setGroupBy(value); } };
    const viewMovements = (variantId: string) => {
        if (isCurrent() && actionsReady.current && dataRef.current?.items.some(group => group.variants.some(variant => variant.id === variantId))) onViewMovements?.(variantId);
    };
    const editProduct = (productId: string) => {
        const active = useAuthStore.getState().user;
        if (isCurrent() && actionsReady.current && active && (active.role === 'ADMIN' || active.permManageProducts) && dataRef.current?.items.some(group => group.variants.some(variant => variant.productId === productId))) onEditProduct?.(productId);
    };
    const facets = data?.facets;
    const options = (values?: string[]) => (values || []).map(value => ({ value, label: value }));
    const filterActive = ([key, value]: [string, any]) => key === 'attributes' ? Object.values(value).some(Boolean) : key === 'balanceFilter' ? value !== 'ALL' : Boolean(value);
    const filtered = Boolean(search.trim() || Object.entries(filters).some(filterActive));
    const activeCount = Object.entries(filters).filter(filterActive).length;
    const hasAdvanced = Boolean(facets?.fabrics.length || facets?.patterns.length || facets?.qualities.length || facets?.attributes?.length || filters.fabric || filters.pattern || filters.quality);
    const stale = Boolean(data && (loading || error || loadedQuery.current !== queryKey));
    const stat = (value: number | null | undefined, currency = false) => error ? 'Unavailable' : loading ? '…' : value == null ? '—' : currency ? money(value) : value.toLocaleString('en-IN');
    const emptyTracked = Boolean(scope === 'TRACKED' && !loading && !error && data?.totalMatching === 0 && !filtered);
    const first = data && data.totalMatching ? (data.page - 1) * data.pageSize + 1 : 0;
    const last = data ? Math.min(data.page * data.pageSize, data.totalMatching) : 0;
    const showActions = Boolean(onViewMovements || (canEditProducts && onEditProduct) || (scope === 'TRACKED' && onAdjustStock));
    const tableColumns = showActions ? 6 : 5;

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-xl font-bold text-gray-900 dark:text-white">{titleFor[scope]}</h2><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{scope === 'TRACKED' ? 'Brand, design, size and stock — with a separate barcode for each item.' : scope === 'LEGACY' ? 'Your old catalogue remains separate while stock is counted and relabelled.' : 'Styles and sizes prepared for your next relabelling batch.'}</p></div>
                <Button variant="outline" onClick={() => { void fetchInventory(); }} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
            </div>
            {scope === 'TRACKED' && <p className="rounded-lg border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-950/20 px-4 py-3 text-sm text-indigo-900 dark:text-indigo-200">Only audited items with their new labels are included in these stock totals.</p>}
            {scope !== 'TRACKED' && <div className={`rounded-xl border p-4 text-sm ${scope === 'LEGACY' ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200' : 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-200'}`}><p className="font-semibold">{scope === 'LEGACY' ? 'Recorded balance is unverified' : 'Prepared items are not live stock'}</p><p className="mt-1">{scope === 'LEGACY' ? 'These balances are not a physical stock count. They are excluded from tracked pieces and tracked stock value.' : 'Prepared items are not available at checkout. Finish the count and relabelling process before activating them.'}</p></div>}

            <div className={`grid grid-cols-2 ${scope === 'TRACKED' ? 'xl:grid-cols-5' : 'lg:grid-cols-4'} gap-3`}>
                {[
                    { label: 'Styles', value: stat(data?.stats.styleCount), icon: Layers, tone: 'text-indigo-600 dark:text-indigo-400', note: 'Separate product styles' },
                    { label: 'Size entries', value: stat(data?.stats.variantCount), icon: List, tone: 'text-blue-600 dark:text-blue-400', note: 'Individual barcodes' },
                    { label: quantityFor[scope], value: stat(data?.stats.quantity), icon: Package, tone: 'text-emerald-600 dark:text-emerald-400', note: scope === 'TRACKED' ? 'Available system quantity' : scope === 'LEGACY' ? 'Unverified starting stock' : 'Not available for sale' },
                    ...(scope === 'TRACKED' ? [{ label: 'Stock value (MRP)', value: stat(data?.stats.mrpValue, true), icon: Tag, tone: 'text-purple-600 dark:text-purple-400', note: 'Retail value, not profit' }] : []),
                    { label: 'Categories', value: stat(data?.stats.categoryCount), icon: Shapes, tone: 'text-amber-600 dark:text-amber-400', note: 'Across these results' },
                ].map(card => <div key={card.label} className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card p-4 shadow-sm"><div className="flex items-center justify-between gap-2 text-xs font-medium text-gray-500 dark:text-gray-400"><span>{card.label}</span><card.icon className={`h-4 w-4 ${card.tone}`} /></div><p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white break-words">{card.value}</p><p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{card.note}</p></div>)}
            </div>

            <section className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card overflow-hidden">
                <div className="p-4 space-y-4 border-b border-gray-200 dark:border-dark-border">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div className="inline-flex self-start rounded-lg bg-gray-100 dark:bg-gray-900 p-1" role="group" aria-label="Inventory grouping">{(['STYLE', 'SIZE'] as const).map(value => <button key={value} type="button" aria-pressed={groupBy === value} onClick={() => changeGrouping(value)} className={`px-4 py-2 rounded-md text-sm font-medium ${groupBy === value ? 'bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>{value === 'STYLE' ? 'By style' : 'By size'}</button>)}</div><p className="text-xs text-gray-500">Counts reflect the current search and filters.</p></div>
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="relative min-w-[210px] flex-[2]"><Search className="absolute top-3 left-3 h-4 w-4 text-gray-400" /><Input aria-label="Search inventory" className="pl-9" placeholder="Search name, barcode or details…" value={search} onChange={event => { startChange(); setSearch(event.target.value); }} /></div>
                        <FilterSelect label="Category" value={filters.categoryId} options={(facets?.categories || []).map(category => ({ value: category.id, label: category.name }))} onChange={value => changeFilter('categoryId', value)} />
                        <FilterSelect label="Brand" value={filters.brand} options={options(facets?.brands)} onChange={value => changeFilter('brand', value)} />
                        <FilterSelect label="Size" value={filters.size} options={options(facets?.sizes)} onChange={value => changeFilter('size', value)} />
                        {(hasAdvanced || scope === 'LEGACY') && <Button variant="outline" onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}><Filter className="h-4 w-4" />More filters{activeCount ? ` (${activeCount})` : ''}</Button>}
                        {filtered && <Button variant="ghost" onClick={clearFilters}><X className="h-4 w-4" />Clear filters</Button>}
                    </div>
                    {advancedOpen && <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">{facets?.attributes?.map(item => <FilterSelect key={item.key} label={prettyLabel(item.key)} value={filters.attributes[item.key] || ''} options={options(item.values)} onChange={value => { startChange(); setFilters(previous => ({ ...previous, attributes: { ...previous.attributes, [item.key]: value } })); }} />)}<FilterSelect label="Fabric" value={filters.fabric} options={options(facets?.fabrics)} onChange={value => changeFilter('fabric', value)} /><FilterSelect label="Pattern" value={filters.pattern} options={options(facets?.patterns)} onChange={value => changeFilter('pattern', value)} /><FilterSelect label="Quality" value={filters.quality} options={options(facets?.qualities)} onChange={value => changeFilter('quality', value)} />{scope === 'LEGACY' && <div className="min-w-[180px] flex-1"><label htmlFor="inventory-balance-filter" className="label text-xs">Recorded balance</label><select id="inventory-balance-filter" aria-label="Filter recorded balance" className="input text-sm" value={filters.balanceFilter} onChange={event => changeFilter('balanceFilter', event.target.value)}><option value="ALL">All recorded balances</option><option value="POSITIVE">Positive</option><option value="ZERO">Zero</option><option value="NEGATIVE">Negative</option></select></div>}</div>}
                </div>

                {error && <div role="alert" className="m-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-4 text-sm text-red-800 dark:text-red-300"><div className="flex items-start gap-2"><AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><div><p className="font-semibold">Inventory could not be refreshed</p><p className="mt-1">{error}</p></div></div><Button variant="outline" size="sm" className="mt-3" onClick={() => { void fetchInventory(); }}>Retry loading inventory</Button></div>}
                {stale && <p className="px-4 py-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20">Showing the last loaded results{loading ? ' while your new results load.' : '. Refresh to see current inventory.'}</p>}
                {emptyTracked ? <div className="px-6 py-12 text-center"><div className="inline-flex rounded-full bg-indigo-50 dark:bg-indigo-950/40 p-4 mb-4"><Package className="h-8 w-8 text-indigo-500" /></div><h3 className="text-lg font-semibold text-gray-900 dark:text-white">Your audited stock will appear here</h3><p className="max-w-md mx-auto mt-2 text-sm text-gray-500 dark:text-gray-400">Upload your Excel audit, give the items new barcodes and check their counts.</p>{onOpenAudit && <Button variant="primary" className="mt-5 mx-auto" onClick={() => { if (isCurrent()) onOpenAudit(); }}>Import Excel stock<ArrowRight className="h-4 w-4" /></Button>}</div> : (
                    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 dark:bg-gray-900/30 text-xs uppercase text-gray-500 dark:text-gray-400"><tr><th className="px-4 py-3 min-w-[270px]">{groupBy === 'STYLE' ? 'Details / Barcode' : 'Style / Details'}</th><th className="px-4 py-3">Size</th><th className="px-4 py-3 text-right">Selling price / MRP</th><th className="px-4 py-3 text-right">{quantityFor[scope]}</th><th className="px-4 py-3">Updated</th>{showActions && <th className="px-4 py-3 text-right">Actions</th>}</tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {data?.items.map(group => {
                            const shared = groupBy === 'STYLE' ? sharedAttributes(group) : [];
                            const sharedKeys = new Set(shared.map(([key]) => key));
                            return <React.Fragment key={group.id}>
                                {groupBy === 'STYLE' && <tr data-product-id={group.id} className="bg-indigo-50/50 dark:bg-indigo-950/20"><td className="px-4 py-3" colSpan={tableColumns}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-gray-900 dark:text-white">{group.name}<span className="ml-2 text-xs font-normal text-gray-500">{group.category}</span></p>{shared.length > 0 && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">{shared.map(([key, value]) => <span key={key}><span className="text-gray-400">{group.variants[0]?.attributeLabels?.[key] || prettyLabel(key)}:</span> {value}</span>)}</div>}</div><div className="text-right text-xs text-gray-500"><p>{group.variants.length} size {group.variants.length === 1 ? 'entry' : 'entries'} · <span className="font-semibold text-gray-800 dark:text-gray-200">{group.quantity.toLocaleString('en-IN')} {scope === 'TRACKED' ? 'pieces' : scope === 'LEGACY' ? 'recorded balance' : 'prepared balance'}</span></p>{scope === 'TRACKED' && group.mrpValue != null && <p className="mt-0.5">Stock value (MRP): {money(group.mrpValue)}</p>}</div></div></td></tr>}
                                {group.variants.map(variant => <tr key={variant.id} data-variant-id={variant.id} data-product-id={variant.productId} className="hover:bg-gray-50 dark:hover:bg-gray-900/20"><td className="px-4 py-3">{groupBy === 'SIZE' && <p className="font-medium text-gray-900 dark:text-white">{variant.name}<span className="ml-2 text-xs font-normal text-gray-500">{variant.category}</span></p>}<p className="font-mono text-xs text-gray-500">{variant.barcode || variant.sku || 'No barcode'}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">{visibleAttributes(variant).filter(([key]) => !sharedKeys.has(key)).map(([key, value]) => <span key={key}>{variant.attributeLabels?.[key] || prettyLabel(key)}: {value}</span>)}</div></td><td className="px-4 py-3"><span className="inline-flex min-w-[36px] justify-center rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200">{variant.size || 'Standard'}</span></td><td className="px-4 py-3 text-right whitespace-nowrap">{money(variant.sellingPrice)}{variant.sellingPrice !== variant.mrp && <p className="mt-0.5 text-xs text-gray-500">MRP: {money(variant.mrp)}</p>}</td><td className={`px-4 py-3 text-right font-semibold ${variant.stock < 0 ? 'text-red-600 dark:text-red-400' : variant.stock === 0 ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>{scope === 'TRACKED' && onAdjustStock ? <QuickStockCount variant={variant} disabled={stale} onChanged={() => { void fetchInventory(); }} /> : variant.stock.toLocaleString('en-IN')}</td><td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{updatedTime(variant.updatedAt)}</td>{showActions && <td className="px-4 py-3"><div className="flex justify-end gap-1">{onViewMovements && <Button variant="ghost" size="sm" disabled={stale} aria-label={`Movement history for ${variant.name} ${variant.size || 'Standard'}`} title="Movement history" onClick={() => viewMovements(variant.id)}><History className="h-4 w-4" /></Button>}{scope === 'TRACKED' && onAdjustStock && <Button variant="ghost" size="sm" disabled={stale} aria-label={`Adjust stock for ${variant.name} ${variant.size || 'Standard'}`} title="Edit count or record stock received" onClick={() => { if (isCurrent() && actionsReady.current) onAdjustStock(variant); }}><SlidersHorizontal className="h-4 w-4" />Edit count</Button>}{canEditProducts && onEditProduct && <Button variant="ghost" size="sm" disabled={stale} aria-label={`Edit product ${variant.name} ${variant.size || 'Standard'}`} title="Edit product" onClick={() => editProduct(variant.productId)}><Pencil className="h-4 w-4" /></Button>}</div></td>}</tr>)}
                            </React.Fragment>;
                        })}
                        {!data?.items.length && <tr><td colSpan={tableColumns} className="p-10 text-center text-gray-500">{loading ? 'Loading inventory…' : error ? 'Inventory is unavailable. Retry loading above.' : filtered ? 'No stock matches these filters.' : scope === 'PREPARED' ? 'No prepared styles yet.' : 'No old items remain.'}{filtered && !loading && !error && <Button variant="outline" size="sm" className="mt-3 mx-auto" onClick={clearFilters}>Clear filters</Button>}</td></tr>}
                    </tbody></table></div>
                )}
                {!emptyTracked && <div className="px-4 py-3 border-t border-gray-200 dark:border-dark-border flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500"><span>{first}–{last} of {(data?.totalMatching || 0).toLocaleString('en-IN')} {groupBy === 'STYLE' ? 'styles' : 'size entries'}</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" aria-label="Previous inventory page" disabled={loading || Boolean(error) || !data || data.page <= 1} onClick={() => { requestId.current += 1; actionsReady.current = false; setLoading(true); setPage(value => value - 1); }}><ChevronLeft className="h-4 w-4" /></Button><span>Page {data?.page || 1} of {data?.totalPages || 1}</span><Button variant="outline" size="sm" aria-label="Next inventory page" disabled={loading || Boolean(error) || !data || data.page >= data.totalPages} onClick={() => { requestId.current += 1; actionsReady.current = false; setLoading(true); setPage(value => value + 1); }}><ChevronRight className="h-4 w-4" /></Button></div></div>}
            </section>
        </div>
    );
};
