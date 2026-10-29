import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ClipboardList,
    Plus,
    Search,
    RefreshCw,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Calendar,
    Clock,
    FileText,
    ExternalLink,
    X,
    Trash2,
    Eye,
    Edit3,
    AlertCircle,
    Layers,
    Hash,
    HelpCircle,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { showToast } from '../ui/Toast';
import { useAuthStore } from '../../store/authStore';
import { toShopDateTimeLocal, fromShopDateTimeLocal } from '../../lib/stockDraftDateTime';
import {
    stockDraftService,
    StockDraftSummary,
    StockDraftDetail,
    StockDraftLineDetail,
    PreparedVariantSearchResult,
    CreateDraftPayload,
    SaveDraftPayload,
    CancelDraftPayload,
} from '../../services/stock-draft.service';

interface CountDraftsViewProps {
    canManageProducts: boolean;
    onReviewBatch?: (draftId: string) => void;
    initialDraftId?: string | null;
    onNavigationBlockedChange?: (blocked: boolean) => void;
}

interface LocalLineState {
    id?: string;
    variantId: string;
    countedQuantity: string; // string for input control: '' = uncounted, '0', '1', etc.
    notes: string;
    snapshot: {
        productName: string;
        barcode: string;
        sku: string;
        description: string;
        size: string | null;
        color: string | null;
        sellingPrice: number | null;
    };
    catalogueStatus?: 'OK' | 'CHANGED' | 'UNAVAILABLE';
    statusMessage?: string;
    currentLiveDetails?: StockDraftLineDetail['currentLiveDetails'];
}

type DraftWriteAttempt = {
    epoch: number;
    actorKey: string;
    rejectedBeforeCommit?: boolean;
    hadUncertainFailure?: boolean;
    continueToReview?: boolean;
} & (
    | { kind: 'CREATE'; payload: CreateDraftPayload & { draftId: string } }
    | { kind: 'SAVE'; payload: SaveDraftPayload }
    | { kind: 'CANCEL'; payload: CancelDraftPayload }
);

const formFingerprint = (name: string, date: string, reference: string, notes: string, lines: LocalLineState[]) => JSON.stringify([
    name, date, reference, notes, lines.map(line => [line.id, line.variantId, line.countedQuantity, line.notes]),
]);

export const CountDraftsView: React.FC<CountDraftsViewProps> = ({ canManageProducts, onReviewBatch, initialDraftId, onNavigationBlockedChange }) => {
    const navigate = useNavigate();
    const { user } = useAuthStore();
    const canReadDrafts = Boolean(user && (user.role === 'ADMIN' || user.permManageInventory)
        && (!('isActive' in user) || user.isActive !== false));
    const actorKey = `${user?.id || ''}:${user?.role || ''}:${Boolean(user?.permManageInventory)}:${canReadDrafts}`;
    const actorKeyRef = useRef(actorKey);
    actorKeyRef.current = actorKey;
    const mountedRef = useRef(true);

    // Draft list states
    const [drafts, setDrafts] = useState<StockDraftSummary[]>([]);
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'CANCELLED' | 'POSTED'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalMatching, setTotalMatching] = useState(0);
    const [stats, setStats] = useState({ totalDrafts: 0, activeDraftCount: 0, cancelledDraftCount: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const listReqIdRef = useRef(0);

    // Editor Modal states
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
    const [editorLoading, setEditorLoading] = useState(false);
    const [editorError, setEditorError] = useState<string | null>(null);
    const editorReqIdRef = useRef(0);
    const [editorLoaded, setEditorLoaded] = useState(false);
    const editorSessionRef = useRef<{ epoch: number; open: boolean; draftId: string | null; loaded: boolean; status: 'DRAFT' | 'CANCELLED' | 'POSTED' | 'UNLOADED' }>({
        epoch: 0, open: false, draftId: null, loaded: false, status: 'UNLOADED',
    });
    const renderedEditorEpoch = editorSessionRef.current.epoch;
    const observedTimestampRef = useRef<string | null>(null);
    const writeAttemptRef = useRef<DraftWriteAttempt | null>(null);
    const writeInFlightRef = useRef<DraftWriteAttempt | null>(null);
    const [pendingWrite, setPendingWrite] = useState<DraftWriteAttempt['kind'] | null>(null);
    const [pendingRejected, setPendingRejected] = useState(false);

    // Form fields
    const [batchDescription, setBatchDescription] = useState('');
    const [observedAt, setObservedAt] = useState('');
    const [sourceReference, setSourceReference] = useState('');
    const [notes, setNotes] = useState('');
    const [currentRevision, setCurrentRevision] = useState(1);
    const [currentStatus, setCurrentStatus] = useState<'DRAFT' | 'CANCELLED' | 'POSTED'>('DRAFT');
    const [lines, setLines] = useState<LocalLineState[]>([]);
    const [saving, setSaving] = useState(false);

    // Variant Picker states
    const [variantSearchQuery, setVariantSearchQuery] = useState('');
    const [variantSearchResults, setVariantSearchResults] = useState<PreparedVariantSearchResult[]>([]);
    const [variantSearching, setVariantSearching] = useState(false);
    const [pickerError, setPickerError] = useState<string | null>(null);
    const searchReqIdRef = useRef(0);
    const [pickerRetry, setPickerRetry] = useState(0);

    // Cancel Confirm Dialog states
    const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const savedFormRef = useRef<string | null>(null);
    const discardActionRef = useRef<(() => void) | null>(null);
    const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
    const editorDirty = editorLoaded && currentStatus === 'DRAFT'
        && savedFormRef.current !== formFingerprint(batchDescription, observedAt, sourceReference, notes, lines);
    useEffect(() => { onNavigationBlockedChange?.(isEditorOpen || pendingWrite !== null); }, [isEditorOpen, pendingWrite, onNavigationBlockedChange]);
    useEffect(() => () => { onNavigationBlockedChange?.(false); }, [onNavigationBlockedChange]);

    // Debounce list search
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Fetch drafts list
    const fetchDrafts = async (page = currentPage) => {
        const reqId = ++listReqIdRef.current;
        const expectedActor = actorKey;
        if (!canReadDrafts) { setDrafts([]); setLoading(false); return; }
        setLoading(true);
        setError(null);

        try {
            const data = await stockDraftService.listDrafts({
                page,
                pageSize: 20,
                status: statusFilter,
                search: debouncedSearch,
            });

            // Discard stale response
            if (reqId !== listReqIdRef.current || !mountedRef.current || actorKeyRef.current !== expectedActor) return;

            setDrafts(data.items);
            setTotalPages(data.totalPages);
            setTotalMatching(data.totalMatching);
            setCurrentPage(data.page);
            setStats(data.stats);
        } catch (err: any) {
            if (reqId === listReqIdRef.current && mountedRef.current && actorKeyRef.current === expectedActor) {
                setError(err.message || 'Could not load saved stock items.');
            }
        } finally {
            if (reqId === listReqIdRef.current && mountedRef.current && actorKeyRef.current === expectedActor) {
                setLoading(false);
            }
        }
    };

    const isCurrentEditor = (epoch: number, expectedActor: string) => {
        const session = editorSessionRef.current;
        return mountedRef.current && actorKeyRef.current === expectedActor && session.open && session.epoch === epoch;
    };

    const resetPicker = () => {
        searchReqIdRef.current += 1;
        setVariantSearchQuery('');
        setVariantSearchResults([]);
        setVariantSearching(false);
        setPickerError(null);
    };

    const invalidateEditor = () => {
        editorReqIdRef.current += 1;
        editorSessionRef.current = {
            epoch: editorSessionRef.current.epoch + 1, open: false, draftId: null, loaded: false, status: 'UNLOADED',
        };
        observedTimestampRef.current = null;
        setEditorLoaded(false);
        setEditorLoading(false);
        setEditorError(null);
        setIsCancelConfirmOpen(false);
        setIsDiscardConfirmOpen(false);
        discardActionRef.current = null;
        savedFormRef.current = null;
        resetPicker();
    };

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            editorReqIdRef.current += 1;
            searchReqIdRef.current += 1;
            listReqIdRef.current += 1;
            editorSessionRef.current = { ...editorSessionRef.current, epoch: editorSessionRef.current.epoch + 1, open: false, loaded: false };
        };
    }, []);

    useEffect(() => {
        invalidateEditor();
        writeAttemptRef.current = null;
        writeInFlightRef.current = null;
        setPendingWrite(null);
        setPendingRejected(false);
        setSaving(false);
        setCancelling(false);
        setIsEditorOpen(false);
        setEditingDraftId(null);
        setDrafts([]);
        listReqIdRef.current += 1;
    }, [actorKey]);

    useEffect(() => {
        fetchDrafts(currentPage);
        return () => {
            listReqIdRef.current += 1;
        };
    }, [debouncedSearch, statusFilter, currentPage, actorKey]);

    const mayChangeEditor = (discardAction?: () => void) => {
        if (writeAttemptRef.current) {
            showToast('Retry the pending save or check the latest saved items before leaving this editor.', 'warning');
            return false;
        }
        if (editorDirty && discardAction) {
            discardActionRef.current = discardAction;
            setIsDiscardConfirmOpen(true);
            return false;
        }
        return canReadDrafts && actorKeyRef.current === actorKey;
    };

    const closeEditorNow = () => {
        invalidateEditor();
        setIsEditorOpen(false);
        setEditingDraftId(null);
    };
    const handleCloseEditor = () => {
        if (isCancelConfirmOpen || isDiscardConfirmOpen) return;
        if (!mayChangeEditor(closeEditorNow)) return;
        closeEditorNow();
    };

    const beginEditor = (draftId: string) => {
        invalidateEditor();
        editorSessionRef.current = { ...editorSessionRef.current, open: true, draftId };
        setBatchDescription('');
        setObservedAt('');
        setSourceReference('');
        setNotes('');
        setCurrentRevision(1);
        setCurrentStatus('DRAFT');
        setLines([]);
        setIsEditorOpen(true);
        return editorSessionRef.current.epoch;
    };

    const hydrateDraft = (draft: StockDraftDetail, epoch: number, expectedActor: string, draftId: string) => {
        if (!isCurrentEditor(epoch, expectedActor) || editorSessionRef.current.draftId !== draftId) return false;
        if (draft.id !== draftId || !Number.isInteger(draft.revision) || !['DRAFT', 'CANCELLED', 'POSTED'].includes(draft.status) || !Array.isArray(draft.lines)) {
            throw new Error('The wrong saved stock items were returned. Reload the intended record.');
        }
        editorSessionRef.current = { ...editorSessionRef.current, loaded: true, status: draft.status };
        observedTimestampRef.current = draft.observedAt || null;
        setEditingDraftId(draftId);
        setBatchDescription(draft.batchDescription);
        setObservedAt(toShopDateTimeLocal(draft.observedAt));
        setSourceReference(draft.sourceReference || '');
        setNotes(draft.notes || '');
        setCurrentRevision(draft.revision);
        setCurrentStatus(draft.status);
        const nextLines = draft.lines.map((line) => ({
            id: line.id, variantId: line.variantId,
            countedQuantity: line.countedQuantity === null ? '' : String(line.countedQuantity),
            notes: line.notes || '', snapshot: line.snapshot,
            catalogueStatus: line.catalogueStatus, statusMessage: line.statusMessage,
            currentLiveDetails: line.currentLiveDetails,
        }));
        setLines(nextLines);
        savedFormRef.current = formFingerprint(draft.batchDescription, toShopDateTimeLocal(draft.observedAt), draft.sourceReference || '', draft.notes || '', nextLines);
        setEditorLoaded(true);
        setEditorError(null);
        resetPicker();
        return true;
    };

    const handleNewDraft = (discardConfirmed = false) => {
        if (!discardConfirmed && !mayChangeEditor(() => handleNewDraft(true))) return;
        beginEditor(crypto.randomUUID());
        const now = new Date().toISOString();
        observedTimestampRef.current = now;
        setEditingDraftId(null);
        setObservedAt(toShopDateTimeLocal(now));
        savedFormRef.current = formFingerprint('', toShopDateTimeLocal(now), '', '', []);
        editorSessionRef.current = { ...editorSessionRef.current, loaded: true, status: 'DRAFT' };
        setEditorLoaded(true);
    };

    const recoverCancelledEntry = () => {
        if (!canReadDrafts || !editorLoaded || currentStatus !== 'CANCELLED' || pendingWrite || writeInFlightRef.current
            || !isCurrentEditor(renderedEditorEpoch, actorKey) || !lines.length
            || lines.some(line => !line.currentLiveDetails || !(line.currentLiveDetails.isPrepared || line.currentLiveDetails.isTracked))) return;
        const originalId = editingDraftId;
        const description = batchDescription;
        const freshLines = lines.map(line => {
            const live = line.currentLiveDetails!;
            return { ...line, id: crypto.randomUUID(), countedQuantity: '', catalogueStatus: 'OK' as const, statusMessage: '',
                snapshot: { productName: live.productName, barcode: live.barcode, sku: live.sku, description: live.formattedDescription,
                    size: live.size || null, color: live.color || null, sellingPrice: live.sellingPrice } };
        });
        handleNewDraft(true);
        setBatchDescription(description);
        setSourceReference(`Recount of cancelled entry ${originalId}`);
        setLines(freshLines);
    };

    const handleOpenDraft = async (draftId: string, discardConfirmed = false) => {
        if (!discardConfirmed && !mayChangeEditor(() => { void handleOpenDraft(draftId, true); })) return;
        const epoch = beginEditor(draftId);
        const expectedActor = actorKey;
        const reqId = ++editorReqIdRef.current;
        setEditingDraftId(draftId);
        setEditorLoading(true);
        try {
            const draft = await stockDraftService.getDraft(draftId);
            if (reqId !== editorReqIdRef.current || !isCurrentEditor(epoch, expectedActor)) return;
            hydrateDraft(draft, epoch, expectedActor, draftId);
        } catch (err: any) {
            if (reqId === editorReqIdRef.current && isCurrentEditor(epoch, expectedActor)) {
                setEditorError(err.message || 'Could not load the saved item details.');
            }
        } finally {
            if (reqId === editorReqIdRef.current && isCurrentEditor(epoch, expectedActor)) setEditorLoading(false);
        }
    };

    const mayEditDraft = () => {
        const session = editorSessionRef.current;
        return isCurrentEditor(renderedEditorEpoch, actorKey) && canReadDrafts && session.loaded
            && session.status === 'DRAFT' && !writeAttemptRef.current && !writeInFlightRef.current;
    };
    useEffect(() => { if (initialDraftId && canReadDrafts) void handleOpenDraft(initialDraftId); }, [initialDraftId, actorKey]);
    const formLocked = !canReadDrafts || !editorLoaded || editorLoading || currentStatus !== 'DRAFT' || pendingWrite !== null || saving || cancelling;

    const handleVariantSearchChange = (value: string) => {
        if (!mayEditDraft()) return;
        searchReqIdRef.current += 1;
        setVariantSearchQuery(value);
        setVariantSearchResults([]);
        setVariantSearching(false);
        setPickerError(null);
    };

    useEffect(() => {
        const reqId = ++searchReqIdRef.current;
        const epoch = editorSessionRef.current.epoch;
        const expectedActor = actorKey;
        const query = variantSearchQuery.trim();
        setVariantSearchResults([]);
        setPickerError(null);
        if (!isEditorOpen || !editorLoaded || currentStatus !== 'DRAFT' || pendingWrite || !query) {
            setVariantSearching(false);
            return;
        }
        setVariantSearching(true);
        const isCurrent = () => reqId === searchReqIdRef.current && isCurrentEditor(epoch, expectedActor)
            && editorSessionRef.current.loaded && editorSessionRef.current.status === 'DRAFT' && !writeAttemptRef.current;
        const timer = setTimeout(async () => {
            try {
                const results = await stockDraftService.searchPreparedVariants({ search: query, limit: 15 });
                if (isCurrent()) setVariantSearchResults(results);
            } catch (err: any) {
                if (isCurrent()) setPickerError(err.message || 'Could not search stock items.');
            } finally {
                if (isCurrent()) setVariantSearching(false);
            }
        }, 250);
        return () => {
            clearTimeout(timer);
            if (searchReqIdRef.current === reqId) searchReqIdRef.current += 1;
        };
    }, [variantSearchQuery, isEditorOpen, editorLoaded, currentStatus, pendingWrite, actorKey, pickerRetry]);

    const handleAddVariant = (variant: PreparedVariantSearchResult) => {
        if (!mayEditDraft()) return;
        const existingIdx = lines.findIndex((line) => line.variantId === variant.id);
        if (existingIdx !== -1) {
            showToast(`Barcode "${variant.barcode}" is already in this list (row ${existingIdx + 1}). Edit its quantity directly.`, 'warning');
            return;
        }
        const newLine: LocalLineState = {
            id: crypto.randomUUID(), variantId: variant.id, countedQuantity: '', notes: '',
            snapshot: {
                productName: variant.productName, barcode: variant.barcode, sku: variant.sku,
                description: variant.formattedDescription || variant.productName,
                size: variant.size, color: variant.color, sellingPrice: variant.sellingPrice,
            },
            catalogueStatus: 'OK',
        };
        setLines((previous) => previous.some((line) => line.variantId === variant.id) ? previous : [...previous, newLine]);
        handleVariantSearchChange('');
    };

    const handleRemoveLine = (lineId: string) => {
        if (!mayEditDraft()) return;
        setLines((previous) => previous.filter((line) => (line.id || line.variantId) !== lineId));
    };

    const handleLineCountChange = (lineId: string, value: string) => {
        if (!mayEditDraft()) return;
        if (value !== '' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 0)) return;
        setLines((previous) => previous.map((line) => (line.id || line.variantId) === lineId ? { ...line, countedQuantity: value } : line));
    };

    const handleLineNotesChange = (lineId: string, value: string) => {
        if (!mayEditDraft()) return;
        setLines((previous) => previous.map((line) => (line.id || line.variantId) === lineId ? { ...line, notes: value } : line));
    };

    const batchMetrics = useMemo(() => {
        let totalPieces = 0;
        let countedLinesCount = 0;
        let uncountedLinesCount = 0;
        for (const line of lines) {
            if (line.countedQuantity === '') uncountedLinesCount++;
            else {
                const quantity = Number(line.countedQuantity);
                if (Number.isSafeInteger(quantity) && quantity >= 0) { totalPieces += quantity; countedLinesCount++; }
            }
        }
        return { totalPieces, countedLinesCount, uncountedLinesCount, totalLines: lines.length };
    }, [lines]);

    const isCurrentAttempt = (attempt: DraftWriteAttempt) => writeAttemptRef.current === attempt
        && isCurrentEditor(attempt.epoch, attempt.actorKey) && editorSessionRef.current.draftId === attempt.payload.draftId;

    // The captured payload and operation ID never change during a retry. A fresh read resolves replayed results.
    const executeWriteAttempt = async (attempt: DraftWriteAttempt, sendWrite = true) => {
        if (!isCurrentAttempt(attempt) || writeInFlightRef.current) return;
        writeInFlightRef.current = attempt;
        setSaving(attempt.kind !== 'CANCEL');
        setCancelling(attempt.kind === 'CANCEL');
        setEditorError(null);
        let writeCompleted = !sendWrite;
        try {
            let requiredRevision = 0;
            if (sendWrite) {
                const result = attempt.kind === 'CREATE'
                    ? await stockDraftService.createDraft(attempt.payload)
                    : attempt.kind === 'SAVE'
                        ? await stockDraftService.saveDraft(attempt.payload)
                        : await stockDraftService.cancelDraft(attempt.payload);
                writeCompleted = true;
                if (!isCurrentAttempt(attempt)) return;
                if (result.draftId !== attempt.payload.draftId) throw new Error('The wrong saved stock items were returned.');
                requiredRevision = result.revision;
            }
            const draft = await stockDraftService.getDraft(attempt.payload.draftId);
            if (!isCurrentAttempt(attempt)) return;
            if (draft.revision < requiredRevision) throw new Error('The latest save has not been confirmed yet. Retry the pending request.');
            if (!hydrateDraft(draft, attempt.epoch, attempt.actorKey, attempt.payload.draftId)) return;
            writeAttemptRef.current = null;
            setPendingWrite(null);
            setPendingRejected(false);
            setIsCancelConfirmOpen(false);
            showToast(draft.status === 'CANCELLED' ? 'These stock items were cancelled. The saved record is shown.'
                : sendWrite ? 'Stock counts saved.' : 'Latest saved items loaded. Check them before continuing.',
                draft.status === 'CANCELLED' ? 'warning' : 'success');
            fetchDrafts(currentPage);
            if (attempt.continueToReview && draft.status === 'DRAFT' && onReviewBatch) {
                closeEditorNow();
                onReviewBatch(draft.id);
            }
        } catch (err: any) {
            if (!isCurrentAttempt(attempt)) return;
            const message = err.message || 'The request outcome could not be confirmed.';
            // The adapter distinguishes explicit rejection from an uncertain transport failure.
            if (sendWrite) {
                const confirmedRejection = !writeCompleted && err.confirmedRejected === true;
                if (!confirmedRejection) attempt.hadUncertainFailure = true;
                const requiresLatestReview = /stale edit|cancelled|operation id.*different/i.test(message);
                attempt.rejectedBeforeCommit = confirmedRejection && !attempt.hadUncertainFailure
                    && attempt.kind !== 'CANCEL' && !requiresLatestReview;
            }
            setPendingRejected(Boolean(attempt.rejectedBeforeCommit));
            setEditorError(message);
            showToast(message, 'error');
        } finally {
            if (writeInFlightRef.current === attempt) writeInFlightRef.current = null;
            if (isCurrentEditor(attempt.epoch, attempt.actorKey)) {
                setSaving(false);
                setCancelling(false);
            }
        }
    };

    const handleSaveDraft = async (continueToReview = false) => {
        if (!mayEditDraft()) return;
        if (!batchDescription.trim()) {
            setEditorError('Enter a name for these items, such as Crazy Heart Checks or Rack A shirts.');
            return;
        }
        try {
            const payloadLines = lines.map((line, index) => {
                const quantity = line.countedQuantity === '' ? null : Number(line.countedQuantity);
                if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0)) throw new Error('Counts must be non-negative whole pieces or blank.');
                return Object.freeze({
                    id: line.id, variantId: line.variantId, countedQuantity: quantity,
                    notes: line.notes.trim() || undefined, sortOrder: index,
                });
            });
            Object.freeze(payloadLines);
            const base = {
                operationId: crypto.randomUUID(), draftId: editorSessionRef.current.draftId!,
                batchDescription: batchDescription.trim(),
                observedAt: fromShopDateTimeLocal(observedAt, observedTimestampRef.current),
                sourceReference: sourceReference.trim() || null, notes: notes.trim() || null, lines: payloadLines,
            };
            const attempt: DraftWriteAttempt = editingDraftId
                ? { kind: 'SAVE', epoch: renderedEditorEpoch, actorKey, payload: Object.freeze({ ...base, expectedRevision: currentRevision }) }
                : { kind: 'CREATE', epoch: renderedEditorEpoch, actorKey, payload: Object.freeze(base) };
            attempt.continueToReview = continueToReview;
            writeAttemptRef.current = attempt;
            setPendingWrite(attempt.kind);
            setPendingRejected(false);
            resetPicker();
            await executeWriteAttempt(attempt);
        } catch (err: any) {
            setEditorError(err.message || 'Check the item details before saving.');
        }
    };

    const handleConfirmCancel = async () => {
        if (!isCancelConfirmOpen || !mayEditDraft() || !editingDraftId) return;
        const attempt: DraftWriteAttempt = {
            kind: 'CANCEL', epoch: renderedEditorEpoch, actorKey,
            payload: Object.freeze({ operationId: crypto.randomUUID(), draftId: editingDraftId, expectedRevision: currentRevision }),
        };
        writeAttemptRef.current = attempt;
        setPendingWrite('CANCEL');
        setPendingRejected(false);
        setIsCancelConfirmOpen(false);
        resetPicker();
        await executeWriteAttempt(attempt);
    };

    const handleRetryPending = async () => {
        const attempt = writeAttemptRef.current;
        if (attempt) await executeWriteAttempt(attempt);
    };

    const handleReviewLatest = async () => {
        const attempt = writeAttemptRef.current;
        if (attempt) await executeWriteAttempt(attempt, false);
    };

    const handleEditRejectedRequest = () => {
        const attempt = writeAttemptRef.current;
        if (!attempt || !attempt.rejectedBeforeCommit || writeInFlightRef.current || !isCurrentAttempt(attempt)) return;
        writeAttemptRef.current = null;
        setPendingWrite(null);
        setPendingRejected(false);
    };

    const handleReviewFromEditor = async () => {
        if (!mayEditDraft() || !onReviewBatch || !lines.length || lines.some(line => !Number.isSafeInteger(Number(line.countedQuantity)) || Number(line.countedQuantity) <= 0)) return;
        if (!editingDraftId || editorDirty) { await handleSaveDraft(true); return; }
        const id = editingDraftId;
        closeEditorNow();
        onReviewBatch(id);
    };

    return (
        <div className="space-y-6">
            {/* Header / Notice */}
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 text-amber-900 dark:text-amber-200 flex items-start gap-3 shadow-sm">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm space-y-1">
                    <p className="font-semibold text-amber-950 dark:text-amber-100 flex items-center gap-2">
                        <span>Saved stock items</span>
                    </p>
                    <p className="text-amber-800 dark:text-amber-300/90 leading-relaxed">
                        Continue unfinished counts and labels here. Use Check labels & stock when the pieces are ready for billing. Completed records remain available to view.
                    </p>
                </div>
            </div>

            {/* List Controls & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button
                        variant="primary"
                        onClick={() => handleNewDraft()}
                        disabled={!canReadDrafts || pendingWrite !== null}
                        className="flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Add counted items</span>
                    </Button>

                    <Button
                        variant="secondary"
                        onClick={() => fetchDrafts(currentPage)}
                        disabled={loading}
                        className="flex items-center gap-2"
                        title="Refresh saved stock items"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                    </Button>
                </div>

                {/* Filter and Search */}
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-[240px]">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search saved names or notes..."
                            className="w-full pl-9 pr-8 py-2 text-sm bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    <select
                        value={statusFilter}
                        onChange={(e) => {
                            setStatusFilter(e.target.value as any);
                            setCurrentPage(1);
                        }}
                        className="py-2 px-3 text-sm bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="ALL">All items ({stats.totalDrafts})</option>
                        <option value="DRAFT">Not ready for billing ({stats.activeDraftCount})</option>
                        <option value="CANCELLED">Cancelled ({stats.cancelledDraftCount})</option>
                        <option value="POSTED">Ready for billing</option>
                    </select>
                </div>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center justify-between text-red-700 dark:text-red-300">
                    <div className="flex items-center gap-2 text-sm">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                    <Button variant="danger" size="sm" onClick={() => fetchDrafts(currentPage)}>
                        Retry
                    </Button>
                </div>
            )}

            {/* Drafts Table */}
            {!error && (
                <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-sm overflow-hidden flex flex-col">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-bg text-gray-600 dark:text-gray-400 font-semibold text-xs uppercase tracking-wider">
                                    <th className="py-3 px-4">Name</th>
                                    <th className="py-3 px-4">Status</th>
                                    <th className="py-3 px-4">Counted on</th>
                                    <th className="py-3 px-4 text-right">Counted pieces</th>
                                    <th className="py-3 px-4 text-right">Sizes counted</th>
                                    <th className="py-3 px-4">Saved by</th>
                                    <th className="py-3 px-4 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
                                {loading && drafts.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-12 text-center text-gray-500">
                                            <div className="flex flex-col items-center justify-center gap-2">
                                                <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                                                <span>Loading saved stock items...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : drafts.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-14 text-center">
                                            <div className="flex flex-col items-center justify-center gap-3 max-w-sm mx-auto">
                                                <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 text-gray-400 rounded-full flex items-center justify-center">
                                                    <ClipboardList className="w-6 h-6" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-gray-900 dark:text-white">
                                                        No saved stock items found
                                                    </p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                        {searchQuery || statusFilter !== 'ALL'
                                                            ? 'No saved items match this search or status.'
                                                            : 'Add counted items to save their quantities and finish their labels later.'}
                                                    </p>
                                                </div>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => handleNewDraft()}
                                                disabled={!canReadDrafts || pendingWrite !== null}
                                                    className="mt-1"
                                                >
                                                    Add counted items
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    drafts.map((d) => {
                                        const isCancelled = d.status !== 'DRAFT';
                                        return (
                                            <tr
                                                key={d.id}
                                                className={`hover:bg-gray-50/75 dark:hover:bg-gray-800/50 transition-colors ${
                                                    isCancelled ? 'opacity-70 bg-gray-50/40 dark:bg-gray-900/20' : ''
                                                }`}
                                            >
                                                <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">
                                                    <div className="flex flex-col">
                                                        <span>{d.batchDescription}</span>
                                                        {d.sourceReference && (
                                                            <span className="text-xs text-gray-500 font-mono mt-0.5">
                                                                Ref: {d.sourceReference}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-1.5">
                                                        <span
                                                            className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                                                                isCancelled
                                                                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                                                    : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                                                            }`}
                                                        >
                                                            {d.status === 'DRAFT' ? 'Not ready for billing' : d.status === 'POSTED' ? 'Ready for billing' : 'Cancelled'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-xs text-gray-600 dark:text-gray-400 font-mono">
                                                    {d.observedAt
                                                        ? new Date(d.observedAt).toLocaleString('en-IN', {
                                                              timeZone: 'Asia/Kolkata',
                                                              dateStyle: 'medium',
                                                              timeStyle: 'short',
                                                          })
                                                        : '—'}
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono font-medium text-gray-900 dark:text-white">
                                                    {d.totalCountedPieces} pcs
                                                </td>
                                                <td className="py-3 px-4 text-right text-xs text-gray-600 dark:text-gray-400">
                                                    {d.countedLines} / {d.totalLines} counted
                                                </td>
                                                <td className="py-3 px-4 text-xs text-gray-600 dark:text-gray-400">
                                                    {d.updatedByName || d.createdByName}
                                                </td>
                                                <td className="py-3 px-4 text-center">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => handleOpenDraft(d.id)}
                                                        disabled={!canReadDrafts || pendingWrite !== null}
                                                        className="text-xs py-1 px-2.5 flex items-center gap-1.5"
                                                    >
                                                        {isCancelled ? (
                                                            <>
                                                                <Eye className="w-3.5 h-3.5 text-gray-500" />
                                                                <span>View</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Edit3 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                                                <span>Edit</span>
                                                            </>
                                                        )}
                                                    </Button>
                                                    {onReviewBatch && d.status === 'DRAFT' && <Button variant="outline" size="sm" className="mt-1 text-xs" disabled={!canReadDrafts || pendingWrite !== null || loading} onClick={() => { if (mayChangeEditor()) onReviewBatch(d.id); }}>Check labels & stock</Button>}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="p-3 bg-gray-50 dark:bg-dark-bg border-t border-gray-200 dark:border-dark-border flex items-center justify-between text-xs text-gray-500">
                            <span>
                                Page {currentPage} of {totalPages} ({totalMatching} saved records)
                            </span>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={currentPage <= 1 || loading}
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    className="py-1 px-2"
                                >
                                    Prev
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={currentPage >= totalPages || loading}
                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                    className="py-1 px-2"
                                >
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Draft Editor Modal */}
            <Modal
                isOpen={isEditorOpen && canReadDrafts}
                onClose={handleCloseEditor}
                title={
                    editingDraftId
                        ? currentStatus === 'POSTED'
                            ? 'Stock items — ready for billing (read only)'
                            : currentStatus === 'CANCELLED'
                            ? 'Cancelled stock items (read only)'
                            : 'Edit stock counts'
                        : 'New counted items'
                }
                size="xl"
            >
                <div className="space-y-5 max-h-[80vh] overflow-y-auto px-1">
                    {/* Draft Only Banner */}
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                            <span>
                                {currentStatus === 'POSTED' ? <><strong>Ready for billing — read only.</strong> These counts have already been added to stock. Make later corrections from Stock.</> : currentStatus === 'CANCELLED' ? <><strong>Cancelled — read only.</strong> These counts were not added to stock.</> : <><strong>Not ready for billing.</strong> Saving counts alone does not change stock. Check the physical pieces and their labels before making them ready for billing.</>}
                            </span>
                        </div>
                        {currentStatus === 'CANCELLED' && (
                            <span className="bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200 px-2 py-0.5 rounded font-bold uppercase text-[10px]">
                                Cancelled
                            </span>
                        )}
                    </div>

                    {pendingWrite && (
                        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                            <p>{saving || cancelling ? 'Request in progress. Fields are locked until the saved result is confirmed.'
                                : 'The request outcome needs review. Fields stay locked so a retry sends exactly the same request.'}</p>
                            <div className="flex flex-wrap gap-2">
                                <Button size="sm" onClick={handleRetryPending} disabled={saving || cancelling}>
                                    {pendingWrite === 'CANCEL' ? 'Retry pending cancellation' : 'Retry pending save'}
                                </Button>
                                <Button variant="secondary" size="sm" onClick={handleReviewLatest} disabled={saving || cancelling}>
                                    Check latest saved items
                                </Button>
                                {pendingRejected && (
                                    <Button variant="secondary" size="sm" onClick={handleEditRejectedRequest} disabled={saving || cancelling}>
                                        Edit rejected request
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}

                    {editorError && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
                            <span>{editorError}</span>
                            {editingDraftId && !pendingWrite && !editorLoading && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleOpenDraft(editingDraftId)}
                                    className="text-xs"
                                >
                                    Reload Latest
                                </Button>
                            )}
                        </div>
                    )}

                    {editorLoading ? (
                        <div className="py-16 flex flex-col items-center justify-center gap-2 text-gray-500">
                            <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                            <span className="text-sm">Loading saved item details...</span>
                        </div>
                    ) : editorLoaded ? (
                        <>
                            {/* Header Form */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        Name / location <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={batchDescription}
                                        disabled={formLocked}
                                        onChange={(e) => { if (mayEditDraft()) setBatchDescription(e.target.value); }}
                                        placeholder="e.g. Crazy Heart Checks / Rack A"
                                        className="w-full py-2 px-3 text-sm bg-gray-50 dark:bg-dark-bg border border-gray-300 dark:border-dark-border rounded-lg text-gray-900 dark:text-white disabled:opacity-60"
                                    />
                                    <p className="text-[11px] text-gray-500">
                                        A name to recognise these counted pieces.
                                    </p>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        Counted on (India time, optional)
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={observedAt}
                                        disabled={formLocked}
                                        onChange={(e) => { if (mayEditDraft()) setObservedAt(e.target.value); }}
                                        className="w-full py-2 px-3 text-sm bg-gray-50 dark:bg-dark-bg border border-gray-300 dark:border-dark-border rounded-lg text-gray-900 dark:text-white disabled:opacity-60"
                                    />
                                    <p className="text-[11px] text-gray-500">
                                        When you physically counted these pieces.
                                    </p>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        Reference (optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={sourceReference}
                                        disabled={formLocked}
                                        onChange={(e) => { if (mayEditDraft()) setSourceReference(e.target.value); }}
                                        placeholder="e.g. Old Shirt 700 sheet row 12"
                                        className="w-full py-2 px-3 text-sm bg-gray-50 dark:bg-dark-bg border border-gray-300 dark:border-dark-border rounded-lg text-gray-900 dark:text-white disabled:opacity-60"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        Notes (optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={notes}
                                        disabled={formLocked}
                                        onChange={(e) => { if (mayEditDraft()) setNotes(e.target.value); }}
                                        placeholder="e.g. 5 hangers missing labels, checked by cash desk"
                                        className="w-full py-2 px-3 text-sm bg-gray-50 dark:bg-dark-bg border border-gray-300 dark:border-dark-border rounded-lg text-gray-900 dark:text-white disabled:opacity-60"
                                    />
                                </div>
                            </div>

                            {/* Batch Observed Metrics Bar */}
                            <div className="bg-gray-50 dark:bg-dark-bg border border-gray-200 dark:border-dark-border rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                                <div className="flex items-center gap-4">
                                    <div>
                                        <span className="text-gray-500">Counted pieces:</span>{' '}
                                        <strong className="text-sm text-indigo-600 dark:text-indigo-400 font-mono">
                                            {batchMetrics.totalPieces} pieces
                                        </strong>
                                    </div>
                                    <div className="text-gray-500">
                                        <span>Sizes:</span>{' '}
                                        <strong className="text-gray-800 dark:text-gray-200">
                                            {batchMetrics.countedLinesCount} counted
                                        </strong>
                                        {batchMetrics.uncountedLinesCount > 0 && (
                                            <span className="text-amber-600 ml-1">
                                                ({batchMetrics.uncountedLinesCount} not counted)
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="text-[11px] text-gray-500 italic">
                                    Enter 0 for no pieces. Leave blank if not counted yet.
                                </div>
                            </div>

                            {/* Prepared Variant Picker (Only active if draft not cancelled) */}
                            {currentStatus === 'DRAFT' && (
                                <div className="space-y-2 border border-dashed border-gray-300 dark:border-dark-border rounded-lg p-3 bg-white/50 dark:bg-dark-card/50">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                                            <Search className="w-3.5 h-3.5 text-indigo-500" />
                                            <span>Add an item or size</span>
                                        </label>
                                        {canManageProducts && (
                                            <button
                                                type="button"
                                                disabled={formLocked}
                                                onClick={() => { if (mayEditDraft() && mayChangeEditor(() => navigate('/products'))) navigate('/products'); }}
                                                className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                                            >
                                                <span>Create item in Products</span>
                                                <ExternalLink className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={variantSearchQuery}
                                            disabled={formLocked}
                                            onChange={(e) => handleVariantSearchChange(e.target.value)}
                                            placeholder="Search items by barcode, brand, quality or size..."
                                            className="w-full py-2 px-3 text-sm bg-white dark:bg-dark-bg border border-gray-300 dark:border-dark-border rounded-lg text-gray-900 dark:text-white"
                                        />
                                        {variantSearching && (
                                            <RefreshCw className="w-4 h-4 animate-spin text-indigo-500 absolute right-3 top-1/2 -translate-y-1/2" />
                                        )}
                                    </div>

                                    {pickerError && (
                                        <div className="flex items-center gap-2 text-xs text-rose-500">
                                            <span>{pickerError}</span>
                                            <Button variant="secondary" size="sm" disabled={formLocked} onClick={() => {
                                                if (mayEditDraft()) { searchReqIdRef.current += 1; setPickerRetry((value) => value + 1); }
                                            }}>Retry search</Button>
                                        </div>
                                    )}

                                    {/* Variant Search Dropdown */}
                                    {variantSearchResults.length > 0 && (
                                        <div className="border border-gray-200 dark:border-dark-border rounded-lg bg-white dark:bg-dark-card shadow-lg max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-dark-border">
                                            {variantSearchResults.map((v) => {
                                                const inDraft = lines.some((l) => l.variantId === v.id);
                                                return (
                                                    <button
                                                        type="button"
                                                        key={v.id}
                                                        disabled={formLocked || inDraft}
                                                        onClick={() => handleAddVariant(v)}
                                                        className={`w-full p-2.5 flex items-center justify-between text-left text-xs cursor-pointer transition-colors ${
                                                            inDraft
                                                                ? 'bg-amber-50/50 dark:bg-amber-950/20 text-gray-500'
                                                                : 'hover:bg-indigo-50 dark:hover:bg-indigo-950/30 text-gray-900 dark:text-white'
                                                        }`}
                                                    >
                                                        <div className="space-y-0.5">
                                                            <div className="font-medium flex items-center gap-2">
                                                                <span>{v.productName}</span>
                                                                <span className="font-mono text-gray-500">[{v.barcode}]</span>
                                                                {inDraft && (
                                                                    <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-semibold">
                                                                        Already added
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                                                {v.formattedDescription}
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-mono text-gray-700 dark:text-gray-300">
                                                                ₹{v.sellingPrice}
                                                            </div>
                                                            <div className="text-[10px] text-amber-600 font-medium">
                                                                {v.isPrepared ? 'Not ready for billing' : 'Ready for billing'}
                                                            </div>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Draft Lines Table */}
                            <div className="border border-gray-200 dark:border-dark-border rounded-lg overflow-hidden">
                                <div className="bg-gray-100/70 dark:bg-dark-bg p-2.5 border-b border-gray-200 dark:border-dark-border flex items-center justify-between">
                                    <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                        Items and sizes ({lines.length})
                                    </h4>
                                    <span className="text-[11px] text-gray-500">
                                        Each size has its own barcode.
                                    </span>
                                </div>

                                {lines.length === 0 ? (
                                    <div className="py-10 text-center text-xs text-gray-500">
                                        <p>No items added yet.</p>
                                        <p className="text-[11px] text-gray-400 mt-1">
                                            Search for an item above, or save this record to continue later.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead>
                                                <tr className="bg-gray-50 dark:bg-dark-bg text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-dark-border">
                                                    <th className="py-2.5 px-3">#</th>
                                                    <th className="py-2.5 px-3">Item details</th>
                                                    <th className="py-2.5 px-3 font-mono">Barcode</th>
                                                    <th className="py-2.5 px-3 text-right">Count (Pieces)</th>
                                                    <th className="py-2.5 px-3">Notes</th>
                                                    {currentStatus === 'DRAFT' && (
                                                        <th className="py-2.5 px-3 text-center">Action</th>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
                                                {lines.map((l, idx) => {
                                                    const isChanged = l.catalogueStatus === 'CHANGED';
                                                    const isUnavailable = l.catalogueStatus === 'UNAVAILABLE';

                                                    return (
                                                        <tr key={l.id || l.variantId} className="hover:bg-gray-50/50">
                                                            <td className="py-2.5 px-3 text-gray-400 font-mono">
                                                                {idx + 1}
                                                            </td>
                                                            <td className="py-2.5 px-3">
                                                                <div className="font-medium text-gray-900 dark:text-white">
                                                                    {l.snapshot.productName}
                                                                </div>
                                                                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                                                    Saved: {l.snapshot.description}
                                                                    {l.snapshot.sellingPrice !== null && <span> · ₹{l.snapshot.sellingPrice}</span>}
                                                                </div>
                                                                {(l.snapshot.size || l.snapshot.color) && (
                                                                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                                                        {[l.snapshot.size && `Size: ${l.snapshot.size}`, l.snapshot.color && `Color: ${l.snapshot.color}`].filter(Boolean).join(' · ')}
                                                                    </div>
                                                                )}

                                                                {/* Catalogue Difference Warning Banner */}
                                                                {isChanged && (
                                                                    <div className="mt-1 text-[10px] text-amber-700 bg-amber-50 dark:bg-amber-950/40 p-1 rounded border border-amber-200">
                                                                        Item details changed since this count was saved ({l.statusMessage}).
                                                                    </div>
                                                                )}
                                                                {isUnavailable && (
                                                                    <div className="mt-1 text-[10px] text-rose-700 bg-rose-50 dark:bg-rose-950/40 p-1 rounded border border-rose-200">
                                                                        Check this item: {l.statusMessage || 'This item is no longer active.'}
                                                                    </div>
                                                                )}
                                                                {(isChanged || isUnavailable) && l.currentLiveDetails && (
                                                                    <div className="mt-1 rounded border border-amber-200 p-1.5 text-[11px] text-gray-700 dark:text-gray-300">
                                                                        <div className="font-semibold">Current item: {l.currentLiveDetails.productName}</div>
                                                                        <div>{l.currentLiveDetails.formattedDescription}</div>
                                                                        <div>Barcode: {l.currentLiveDetails.barcode} · SKU: {l.currentLiveDetails.sku} · ₹{l.currentLiveDetails.sellingPrice}</div>
                                                                        {(l.currentLiveDetails.size || l.currentLiveDetails.color) && (
                                                                            <div>{[l.currentLiveDetails.size && `Size: ${l.currentLiveDetails.size}`, l.currentLiveDetails.color && `Color: ${l.currentLiveDetails.color}`].filter(Boolean).join(' · ')}</div>
                                                                        )}
                                                                        {l.currentLiveDetails.attributes && (
                                                                            <div>{Object.entries(l.currentLiveDetails.attributes).filter(([, value]) => value).map(([key, value]) => `${key === 'styleRef' ? 'Style reference' : key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`).join(' · ')}</div>
                                                                        )}
                                                                        {!l.currentLiveDetails.isPrepared && <div>Check this item before adding more counted pieces.</div>}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="py-2.5 px-3 font-mono text-gray-600 dark:text-gray-400">
                                                                {l.snapshot.barcode}
                                                            </td>
                                                            <td className="py-2.5 px-3 text-right">
                                                                <input
                                                                    type="text"
                                                                    inputMode="numeric"
                                                                    pattern="[0-9]*"
                                                                    value={l.countedQuantity}
                                                                    disabled={formLocked}
                                                                    onChange={(e) => handleLineCountChange(l.id || l.variantId, e.target.value)}
                                                                    placeholder="Blank"
                                                                    className="w-20 py-1 px-2 text-right font-mono text-sm border border-gray-300 dark:border-dark-border rounded bg-white dark:bg-dark-bg text-gray-900 dark:text-white disabled:opacity-60 focus:ring-1 focus:ring-indigo-500"
                                                                />
                                                            </td>
                                                            <td className="py-2.5 px-3">
                                                                <input
                                                                    type="text"
                                                                    value={l.notes}
                                                                    disabled={formLocked}
                                                                    onChange={(e) => handleLineNotesChange(l.id || l.variantId, e.target.value)}
                                                                    placeholder="e.g. 1 torn seam"
                                                                    className="w-full py-1 px-2 text-xs border border-gray-300 dark:border-dark-border rounded bg-white dark:bg-dark-bg text-gray-900 dark:text-white disabled:opacity-60"
                                                                />
                                                            </td>
                                                            {currentStatus === 'DRAFT' && (
                                                                <td className="py-2.5 px-3 text-center">
                                                                    <button
                                                                        type="button"
                                                                        disabled={formLocked}
                                                                        onClick={() => handleRemoveLine(l.id || l.variantId)}
                                                                        className="p-1 text-gray-400 hover:text-rose-600 rounded"
                                                                        title="Remove item"
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Modal Actions */}
                            <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-dark-border">
                                <div>
                                    {editingDraftId && currentStatus === 'DRAFT' && (
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => { if (mayEditDraft()) setIsCancelConfirmOpen(true); }}
                                            disabled={formLocked}
                                            className="text-xs"
                                        >
                                            Cancel these items
                                        </Button>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={handleCloseEditor}
                                        disabled={pendingWrite !== null}
                                    >
                                        Close
                                    </Button>

                                    {currentStatus === 'CANCELLED' && <Button variant="primary" onClick={recoverCancelledEntry}
                                        disabled={!editorLoaded || !lines.length || lines.some(line => !line.currentLiveDetails || !(line.currentLiveDetails.isPrepared || line.currentLiveDetails.isTracked))}>
                                        Create new stock entry
                                    </Button>}
                                    {currentStatus === 'DRAFT' && (
                                        <Button
                                            variant="primary"
                                            onClick={() => { void handleSaveDraft(); }}
                                            disabled={formLocked}
                                            className="flex items-center gap-1.5"
                                        >
                                            {saving ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                    <span>Saving...</span>
                                                </>
                                            ) : (
                                                <span>Save counts</span>
                                            )}
                                        </Button>
                                    )}
                                    {onReviewBatch && currentStatus === 'DRAFT' && <Button variant="primary" onClick={() => { void handleReviewFromEditor(); }} disabled={formLocked || !lines.length || lines.some(line => !line.countedQuantity || Number(line.countedQuantity) <= 0)}>
                                        {!editingDraftId || editorDirty ? 'Save & continue' : 'Continue to inventory'}
                                    </Button>}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="py-8 text-center text-sm text-gray-500">
                            Item details are unavailable. Reload the saved record before editing.
                            <div className="mt-3"><Button variant="secondary" onClick={handleCloseEditor}>Close</Button></div>
                        </div>
                    )}
                </div>
            </Modal>

            {/* In-app Cancel Confirm Dialog */}
            <ConfirmDialog
                isOpen={isCancelConfirmOpen}
                onClose={() => { if (!writeAttemptRef.current && !writeInFlightRef.current) setIsCancelConfirmOpen(false); }}
                onConfirm={handleConfirmCancel}
                title="Cancel these stock items?"
                message="These counts will not be added to stock. The saved record stays available to view, but you cannot edit or reopen it after cancelling."
                confirmText="Cancel items"
                cancelText="Keep items"
                confirmVariant="danger"
                loading={cancelling}
            />
            <ConfirmDialog isOpen={isDiscardConfirmOpen && canReadDrafts} title="Unsaved stock counts" message="Your latest changes have not been saved. Discard them and continue?" confirmText="Discard changes" cancelText="Keep editing" variant="warning"
                onClose={() => { discardActionRef.current = null; setIsDiscardConfirmOpen(false); }}
                onConfirm={() => {
                    const action = discardActionRef.current;
                    discardActionRef.current = null;
                    setIsDiscardConfirmOpen(false);
                    if (action && canReadDrafts && actorKeyRef.current === actorKey && !writeAttemptRef.current) action();
                }} />
        </div>
    );
};
