import React, { useState } from 'react';
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

    const navButtons = (
        <div className="flex flex-wrap items-center gap-2">
            {[
                ['INVENTORY', 'Inventory'],
                ['MANUAL', 'Add manually'],
                ['EXCEL', 'Excel upload'],
            ].map(([value, label]) => (
                <button
                    key={value}
                    type="button"
                    aria-pressed={tab === value}
                    disabled={navigationBlocked || Boolean(adjustVariant) || Boolean(historyId)}
                    onClick={() => {
                        if (!navigationBlocked && !adjustVariant && !historyId) setTab(value as typeof tab);
                    }}
                    className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        tab === value
                            ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                            : 'border-gray-200 dark:border-dark-border bg-gray-50 hover:bg-gray-100 dark:bg-dark-card dark:hover:bg-dark-border text-gray-700 dark:text-gray-300'
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    );

    return (
        <div className="space-y-6">
            {tab !== 'INVENTORY' && (
                <div className="flex flex-wrap items-start justify-between gap-3 pb-2 border-b border-gray-200 dark:border-gray-700">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                            {tab === 'MANUAL' ? 'Add stock manually' : 'Import stock from Excel'}
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            {tab === 'MANUAL'
                                ? 'Record counted racks or add physical garments directly.'
                                : 'Upload audit workbooks and review counts before adding to inventory.'}
                        </p>
                    </div>
                    {navButtons}
                </div>
            )}

            {tab === 'INVENTORY' && (
                <InventoryWorkspaceView
                    key={`tracked-${revision}`}
                    scope="TRACKED"
                    onOpenAudit={() => setTab('EXCEL')}
                    onViewMovements={setHistoryId}
                    onAdjustStock={setAdjustVariant}
                >
                    {navButtons}
                </InventoryWorkspaceView>
            )}
            {tab === 'MANUAL' && (
                <RackAuditView
                    onBlockedChange={setNavigationBlocked}
                    onInventoryChanged={() => setRevision((value) => value + 1)}
                />
            )}
            {tab === 'EXCEL' && (
                <StockEntryView
                    key={tab}
                    mode="EXCEL"
                    onBlockedChange={setNavigationBlocked}
                    onSaved={() => {
                        setNavigationBlocked(false);
                        setRevision((value) => value + 1);
                        setTab('INVENTORY');
                    }}
                />
            )}
            {historyId && <MovementHistoryModal key={historyId} variantId={historyId} onClose={() => setHistoryId(null)} />}
            {adjustVariant && (
                <TrackedStockAdjustmentModal
                    key={adjustVariant.id}
                    variant={adjustVariant}
                    initialKind="RECOUNT"
                    onClose={() => setAdjustVariant(null)}
                    onAdjusted={() => {
                        setAdjustVariant(null);
                        setRevision((value) => value + 1);
                    }}
                />
            )}
        </div>
    );
};
