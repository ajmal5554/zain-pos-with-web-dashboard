import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { InventoryWorkspaceView } from '../components/stock/InventoryWorkspaceView';
import { StockEntryView } from '../components/stock/StockEntryView';
import { RackAuditView } from '../components/stock/RackAuditView';
import { MovementHistoryModal } from '../components/stock/MovementHistoryModal';
import { TrackedStockAdjustmentModal } from '../components/stock/TrackedStockAdjustmentModal';
import type { InventoryVariant } from '../types/inventoryWorkspace';

export const Stock: React.FC = () => {
    const { user } = useAuthStore();
    const allowed = Boolean(user && user.isActive !== false && (user.role === 'ADMIN' || user.permManageInventory));
    if (!allowed) return <p className="text-sm text-gray-500">You need inventory access to view stock.</p>;
    return <StockWorkspace key={`${user?.id}:${user?.role}:${Boolean(user?.permManageInventory)}:${Boolean(user?.permManageProducts)}`} />;
};

const StockWorkspace: React.FC = () => {
    const [tab, setTab] = useState<'INVENTORY' | 'MANUAL' | 'EXCEL'>('INVENTORY');
    const [revision, setRevision] = useState(0);
    const [navigationBlocked, setNavigationBlocked] = useState(false);
    const [historyId, setHistoryId] = useState<string | null>(null);
    const [adjustVariant, setAdjustVariant] = useState<InventoryVariant | null>(null);
    return <div className="space-y-6"><div><h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2.5"><Package className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />Stock</h1><p className="text-sm text-gray-500 mt-1">Audited items, size-wise quantities and individual barcodes.</p></div><div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-3">{[['INVENTORY', 'Inventory'], ['MANUAL', 'Add manually'], ['EXCEL', 'Excel upload']].map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} disabled={navigationBlocked || Boolean(adjustVariant) || Boolean(historyId)} onClick={() => { if (!navigationBlocked && !adjustVariant && !historyId) setTab(value as typeof tab); }} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${tab === value ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>{label}</button>)}</div>
        {tab === 'INVENTORY' && <InventoryWorkspaceView key={`tracked-${revision}`} scope="TRACKED" onOpenAudit={() => setTab('EXCEL')} onViewMovements={setHistoryId} onAdjustStock={setAdjustVariant} />}
        {tab === 'MANUAL' && <RackAuditView onBlockedChange={setNavigationBlocked} onInventoryChanged={() => setRevision(value => value + 1)} />}
        {tab === 'EXCEL' && <StockEntryView key={tab} mode="EXCEL" onBlockedChange={setNavigationBlocked} onSaved={() => { setNavigationBlocked(false); setRevision(value => value + 1); setTab('INVENTORY'); }} />}
        {historyId && <MovementHistoryModal key={historyId} variantId={historyId} onClose={() => setHistoryId(null)} />}
        {adjustVariant && <TrackedStockAdjustmentModal key={adjustVariant.id} variant={adjustVariant} initialKind="RECOUNT" onClose={() => setAdjustVariant(null)} onAdjusted={() => { setAdjustVariant(null); setRevision(value => value + 1); }} />}
    </div>;
};
