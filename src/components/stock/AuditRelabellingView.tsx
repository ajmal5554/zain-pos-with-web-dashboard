import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/Button';
import { ExcelAuditView } from './ExcelAuditView';
import type { ExcelAuditSelection } from './ExcelAuditView';
import { CountDraftsView } from './CountDraftsView';
import { PrepareAuditStyleModal } from './PrepareAuditStyleModal';
import { ReviewStockBatchModal } from './ReviewStockBatchModal';

interface UploadProps {
    onInventoryChanged?: () => void;
    onNavigationBlockedChange?: (blocked: boolean) => void;
}
export const AuditRelabellingView: React.FC<UploadProps> = (props) => {
    const { user } = useAuthStore();
    const allowed = Boolean(user && user.isActive !== false && (user.role === 'ADMIN' || user.permManageInventory));
    if (!allowed) return <p className="text-sm text-gray-500">Inventory access is required.</p>;
    return <AuditRelabellingData key={`${user?.id}:${user?.role}:${Boolean(user?.permManageInventory)}:${Boolean(user?.permManageProducts)}`} {...props} />;
};

const AuditRelabellingData: React.FC<UploadProps> = ({ onInventoryChanged, onNavigationBlockedChange }) => {
    const { user } = useAuthStore();
    const canManageProducts = Boolean(user && (user.role === 'ADMIN' || user.permManageProducts));
    const [unfinished, setUnfinished] = useState(false);
    const [selection, setSelection] = useState<ExcelAuditSelection | null>(null);
    const [newDraftId, setNewDraftId] = useState<string | null>(null);
    const [reviewId, setReviewId] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    const [editorBlocked, setEditorBlocked] = useState(false);
    const blocked = editorBlocked || Boolean(selection) || Boolean(reviewId);
    useEffect(() => {
        onNavigationBlockedChange?.(blocked);
        return () => onNavigationBlockedChange?.(false);
    }, [blocked, onNavigationBlockedChange]);
    return <div className="space-y-5">
        <div className="flex flex-wrap justify-between items-center gap-3">
            <p className="text-sm text-gray-500">Import your audit, check the items and give each size its own barcode.</p>
            <Button variant="outline" size="sm" disabled={blocked} onClick={() => { if (!blocked) { setNewDraftId(null); setUnfinished(value => !value); } }}>
                {unfinished ? 'Back to Excel upload' : 'Continue unfinished items'}
            </Button>
        </div>
        {unfinished ? <CountDraftsView key={`items-${revision}`} canManageProducts={canManageProducts} initialDraftId={newDraftId} onNavigationBlockedChange={setEditorBlocked} onReviewBatch={setReviewId} />
            : <ExcelAuditView key={`excel-${revision}`} onPrepareSelection={canManageProducts ? setSelection : undefined} onOpenSavedItems={draftId => { setNewDraftId(draftId); setUnfinished(true); }} />}
        {selection && <PrepareAuditStyleModal key={`${selection.fileHash}:${selection.rows.map(row => row.id).join('|')}`} selection={selection} onClose={() => setSelection(null)} onPrepared={draftId => { setSelection(null); setNewDraftId(draftId); setUnfinished(true); setRevision(value => value + 1); }} />}
        {reviewId && <ReviewStockBatchModal key={reviewId} draftId={reviewId} onClose={() => setReviewId(null)} onPosted={() => { setReviewId(null); setNewDraftId(null); setUnfinished(false); setRevision(value => value + 1); onInventoryChanged?.(); }} />}
    </div>;
};
