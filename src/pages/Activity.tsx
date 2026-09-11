import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { auditService } from '../services/audit.service';
import { useAuthStore } from '../store/authStore';
import { 
    format, 
    subDays, 
    startOfDay, 
    endOfDay, 
    startOfMonth, 
    endOfMonth, 
    isWithinInterval, 
    formatDistanceToNow 
} from 'date-fns';
import { 
    Activity, 
    Search, 
    RefreshCw, 
    User, 
    ShieldAlert, 
    ArrowRight, 
    DollarSign, 
    Clock, 
    Tag, 
    Undo2, 
    Download, 
    Calendar, 
    Filter, 
    X, 
    ChevronLeft, 
    ChevronRight, 
    AlertTriangle, 
    ShieldCheck, 
    Percent, 
    Layers, 
    Eye,
    EyeOff,
    Receipt,
    CalendarDays,
    UserCheck,
    Info,
    ShoppingCart,
    ArrowDownRight,
    ArrowUpRight,
    Repeat
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';

interface AuditLog {
    id: string;
    action: string;
    details: string;
    userId: string | null;
    user?: {
        id?: string;
        name: string;
        role: string;
    };
    createdAt: string;
}

export type DatePreset = 'ALL_TIME' | 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH' | 'CUSTOM';
export type CategoryFilter = 'ALL' | 'sales' | 'inventory' | 'auth' | 'financial' | 'system';
export type SeverityLevel = 'ALL' | 'CRITICAL' | 'WARNING' | 'FINANCIAL' | 'INFO';

const CATEGORY_MAP: Record<string, string[]> = {
    sales: [
        'SALE_CREATE', 'SALE_COMPLETED', 'SALE_REFUND', 'REFUND', 'SALE_RETURN',
        'SALE_VOID', 'SALE_DELETE', 'SALE_UPDATE', 'DISCOUNT_APPLIED',
        'PRICE_OVERRIDE', 'EXCHANGE', 'PAYMENT_UPDATE'
    ],
    inventory: [
        'STOCK_ADD', 'STOCK_ADJUST', 'INVENTORY_ADJUSTMENT', 'PRODUCT_DELETE',
        'PRODUCT_UPDATE', 'INVENTORY_ALERT', 'LOW_STOCK'
    ],
    auth: [
        'USER_LOGIN', 'USER_LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGE',
        'PERMISSION_CHANGE', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETED',
        'USER_UPDATE', 'REMOTE_USER_UPDATED'
    ],
    financial: [
        'CASH_DRAWER_OPEN', 'CASH_DRAWER_CLOSE', 'SHIFT_START', 'SHIFT_END',
        'CASH_RECONCILIATION'
    ],
    system: [
        'DATA_SYNC', 'REPORT_GENERATED', 'SETTINGS_CHANGE', 'BACKUP_CREATED',
        'BACKUP_RESTORED'
    ]
};

function getActionCategory(action: string): string {
    const act = action.toUpperCase();
    for (const [cat, list] of Object.entries(CATEGORY_MAP)) {
        if (list.some(a => act.includes(a) || a.includes(act))) {
            return cat;
        }
    }
    return 'system';
}

function getActionSeverity(action: string): 'CRITICAL' | 'WARNING' | 'FINANCIAL' | 'INFO' {
    const act = action.toUpperCase();
    if (
        act.includes('VOID') || 
        act.includes('DELETE') || 
        act.includes('FAILED') || 
        act.includes('REFUND') ||
        act.includes('RETURN') ||
        act.includes('PERMISSION')
    ) {
        return 'CRITICAL';
    }
    if (
        act.includes('DISCOUNT') || 
        act.includes('OVERRIDE') || 
        act.includes('ADJUST') || 
        act.includes('ALERT') ||
        act.includes('DRAWER')
    ) {
        return 'WARNING';
    }
    if (
        act.includes('SHIFT') || 
        act.includes('RECONCIL') || 
        act.includes('EXCHANGE') || 
        act.includes('PAYMENT')
    ) {
        return 'FINANCIAL';
    }
    return 'INFO';
}

function formatActionTitle(action: string): string {
    const customTitles: Record<string, string> = {
        'SALE_VOID': 'Sale Voided',
        'SALE_REFUND': 'Sale Refunded',
        'REFUND': 'Sale Refunded',
        'SALE_RETURN': 'Return Processed',
        'SALE_UPDATE': 'Sale Modified',
        'DISCOUNT_APPLIED': 'Discount Applied',
        'PRICE_OVERRIDE': 'Price Override',
        'EXCHANGE': 'Item Exchange',
        'PAYMENT_UPDATE': 'Payment Updated',
        'INVENTORY_ADJUSTMENT': 'Stock Recount / Adjustment',
        'STOCK_ADJUST': 'Stock Adjustment',
        'STOCK_ADD': 'Stock Added',
        'PRODUCT_DELETE': 'Product Deleted',
        'PRODUCT_UPDATE': 'Product Modified',
        'INVENTORY_ALERT': 'Low Stock Alert',
        'USER_LOGIN': 'User Login',
        'USER_LOGOUT': 'User Logout',
        'LOGIN_FAILED': 'Failed Login Attempt',
        'PASSWORD_CHANGE': 'Password Changed',
        'PERMISSION_CHANGE': 'Permissions Modified',
        'USER_CREATED': 'User Created',
        'USER_UPDATED': 'User Account Updated',
        'USER_UPDATE': 'User Account Updated',
        'REMOTE_USER_UPDATED': 'User Account Updated',
        'USER_DELETED': 'User Deleted',
        'CASH_DRAWER_OPEN': 'Cash Drawer Opened',
        'CASH_DRAWER_CLOSE': 'Cash Drawer Closed',
        'SHIFT_START': 'Shift Started',
        'SHIFT_END': 'Shift Ended',
        'CASH_RECONCILIATION': 'Cash Reconciled',
        'DATA_SYNC': 'Cloud Sync',
        'REPORT_GENERATED': 'Report Exported',
        'SETTINGS_CHANGE': 'Settings Updated',
        'BACKUP_CREATED': 'Database Backup',
        'BACKUP_RESTORED': 'Database Restored'
    };

    if (customTitles[action]) return customTitles[action];
    return action
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

export interface ItemChangeDetail {
    type: 'ADDED' | 'REMOVED' | 'QTY_CHANGED' | 'RATE_CHANGED';
    name: string;
    variant?: string;
    oldQty?: number;
    newQty?: number;
    oldRate?: number;
    newRate?: number;
    rate?: number;
}

export interface ExchangeItemDetail {
    name: string;
    variant?: string;
    qty: number;
    rate?: number;
    total?: number;
}

export interface RefundItemDetail {
    name: string;
    variant?: string;
    qty: number;
    amount: number;
}

export interface SaleDiffDetails {
    version?: number;
    type?: 'SALE_UPDATE' | 'PAYMENT_UPDATE' | 'EXCHANGE' | 'REFUND' | string;
    invoiceNo?: string;
    summary?: string;
    // For SALE_UPDATE
    totals?: {
        before: {
            grandTotal?: number;
            subtotal?: number;
            discount?: number;
            discountPercent?: number;
            taxAmount?: number;
            itemCount?: number;
            paymentMethod?: string;
            customerName?: string;
        };
        after: {
            grandTotal?: number;
            subtotal?: number;
            discount?: number;
            discountPercent?: number;
            taxAmount?: number;
            itemCount?: number;
            paymentMethod?: string;
            customerName?: string;
        };
    };
    itemChanges?: ItemChangeDetail[];
    // For PAYMENT_UPDATE
    payment?: {
        before: {
            method: string;
            paidAmount?: number;
            payments?: Array<{ paymentMode: string; amount: number }>;
        };
        after: {
            method: string;
            paidAmount?: number;
            payments?: Array<{ paymentMode: string; amount: number }>;
        };
    };
    // For EXCHANGE
    originalBillNo?: string;
    replacementBillNo?: string;
    returnedItems?: ExchangeItemDetail[];
    replacementItems?: ExchangeItemDetail[];
    returnedTotal?: number;
    replacementTotal?: number;
    differenceAmount?: number;
    netPayable?: number;
    exchangeCreditApplied?: number;
    paymentMethod?: string;
    customerName?: string;
    // For REFUND
    billNo?: string;
    refundAmount?: number;
    reason?: string;
    refundPayments?: Array<{ paymentMode: string; amount: number }>;
    refundedItems?: RefundItemDetail[];
    remarks?: string;
}

interface ParsedLogInfo {
    narrative: string;
    invoiceNo?: string;
    amount?: string;
    percentage?: string;
    reason?: string;
    targetUser?: string;
    diff?: SaleDiffDetails;
}

function parseLogExplanation(log: AuditLog): ParsedLogInfo {
    const act = (log.action || '').toUpperCase();
    const det = log.details || '';
    const operator = log.user?.name || 'Staff Member';

    let diff: SaleDiffDetails | undefined = undefined;
    let invoiceNo: string | undefined = undefined;
    let amount: string | undefined = undefined;
    let percentage: string | undefined = undefined;
    let reason: string | undefined = undefined;
    let targetUser: string | undefined = undefined;
    let narrative = det;

    // Check if details is JSON payload (v2 format)
    if (det.trim().startsWith('{') && det.trim().endsWith('}')) {
        try {
            const parsedJson = JSON.parse(det);
            if (parsedJson.type === 'SALE_UPDATE' || parsedJson.totals) {
                diff = parsedJson;
                invoiceNo = parsedJson.invoiceNo;
                const beforeTotal = parsedJson.totals?.before?.grandTotal;
                const afterTotal = parsedJson.totals?.after?.grandTotal;
                amount = afterTotal !== undefined ? String(afterTotal) : undefined;
                
                const delta = (afterTotal !== undefined && beforeTotal !== undefined) ? afterTotal - beforeTotal : 0;
                const deltaStr = delta !== 0 ? ` (${delta > 0 ? '+' : '-'}₹${Math.abs(delta).toFixed(2)})` : '';
                const itemsDeltaStr = parsedJson.itemChanges?.length
                    ? ` • ${parsedJson.itemChanges.map((c: any) => {
                        if (c.type === 'ADDED') return `+${c.name}${c.variant ? ` (${c.variant})` : ''} x${c.newQty || 1}`;
                        if (c.type === 'REMOVED') return `-${c.name}${c.variant ? ` (${c.variant})` : ''} x${c.oldQty || 1}`;
                        if (c.type === 'QTY_CHANGED') return `${c.name} qty ${c.oldQty}→${c.newQty}`;
                        if (c.type === 'RATE_CHANGED') return `${c.name} rate ₹${c.oldRate}→₹${c.newRate}`;
                        return c.name;
                    }).join(', ')}`
                    : '';

                narrative = `Bill #${invoiceNo || ''} was modified by ${operator}: Total ₹${beforeTotal?.toFixed(2) || '?'} → ₹${afterTotal?.toFixed(2) || '?'}${deltaStr}${itemsDeltaStr}`;
            } else if (parsedJson.type === 'PAYMENT_UPDATE' || parsedJson.payment) {
                diff = parsedJson;
                invoiceNo = parsedJson.invoiceNo;
                amount = parsedJson.payment?.after?.paidAmount !== undefined ? String(parsedJson.payment.after.paidAmount) : undefined;
                narrative = `Payment method for Bill #${invoiceNo || ''} was updated by ${operator}: ${parsedJson.payment?.before?.method || 'N/A'} → ${parsedJson.payment?.after?.method || 'N/A'}`;
            } else if (parsedJson.type === 'EXCHANGE' || parsedJson.returnedItems || parsedJson.replacementItems) {
                diff = parsedJson;
                invoiceNo = parsedJson.originalBillNo || parsedJson.replacementBillNo;
                amount = parsedJson.replacementTotal !== undefined 
                    ? String(parsedJson.replacementTotal) 
                    : (parsedJson.returnedTotal !== undefined ? String(parsedJson.returnedTotal) : undefined);
                
                const returnedSummary = (parsedJson.returnedItems || []).map((i: any) => `${i.name} x${i.qty}`).join(', ');
                const replacementSummary = (parsedJson.replacementItems || []).map((i: any) => `${i.name} x${i.qty}`).join(', ');
                const diffAmt = parsedJson.differenceAmount || 0;
                const diffStr = diffAmt > 0 ? ` (+₹${diffAmt.toFixed(2)} paid)` : diffAmt < 0 ? ` (-₹${Math.abs(diffAmt).toFixed(2)} refunded)` : ' (Equal Value: ₹0.00)';

                narrative = `Item exchange processed by ${operator}: Returned ${returnedSummary || 'items'} (Bill #${parsedJson.originalBillNo || '?'}) for ${replacementSummary || 'items'}${parsedJson.replacementBillNo ? ` (Replacement Bill #${parsedJson.replacementBillNo})` : ''}${diffStr}.`;
            } else if (parsedJson.type === 'REFUND' || parsedJson.refundedItems) {
                diff = parsedJson;
                invoiceNo = parsedJson.billNo;
                amount = parsedJson.refundAmount !== undefined ? String(parsedJson.refundAmount) : undefined;
                reason = parsedJson.reason;
                const refundedSummary = (parsedJson.refundedItems || []).map((i: any) => `${i.name} x${i.qty}`).join(', ');
                narrative = `Refund of ₹${parsedJson.refundAmount?.toFixed(2) || '0.00'} processed by ${operator} for Bill #${invoiceNo || ''}${refundedSummary ? `: ${refundedSummary}` : ''}${reason ? ` · Reason: ${reason}` : ''}.`;
            }
        } catch {
            // Not valid JSON, proceed to standard parsing
        }
    }

    if (!diff) {
        // Robust invoice extraction: DO NOT extract literal words "ID", "NO", "NUMBER" as invoice number
        const explicitBillMatch = det.match(/(?:Bill|Sale|Invoice|Receipt)\s*#\s*([A-Za-z0-9-]+)/i);
        if (explicitBillMatch) {
            invoiceNo = explicitBillMatch[1];
        } else {
            const genericMatch = det.match(/(?:Bill|Sale|Invoice)\s+(?:#\s*)?([A-Za-z0-9-]+)/i);
            if (genericMatch && !['ID', 'NO', 'NUMBER'].includes(genericMatch[1].toUpperCase())) {
                invoiceNo = genericMatch[1];
            }
        }

        const amtMatch = det.match(/(?:₹|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i) || det.match(/Amount:?\s*₹?\s*([\d,]+(?:\.\d{1,2})?)/i);
        amount = amtMatch ? amtMatch[1] : undefined;

        const pctMatch = det.match(/(\d+(?:\.\d+)?\s*%)/);
        percentage = pctMatch ? pctMatch[1] : undefined;

        const reasonMatch = det.match(/Reason:\s*([^.\n]+)/i);
        reason = reasonMatch ? reasonMatch[1].trim() : undefined;

        const userMatch = det.match(/(?:user|User)\s*["']?([A-Za-z0-9_ -]+)["']?/);
        targetUser = userMatch ? userMatch[1].trim() : undefined;

        if (act === 'EXCHANGE') {
            // Check legacy exchange format:
            // e.g. "Exchange processed for Invoice ID 4b01a7dc-3f8f-4929-9e30-d85fe9587c71. Diff: Rs.0.00, Replacement Sale #1189"
            const replMatch = det.match(/Replacement\s+Sale\s*#?([A-Za-z0-9-]+)/i);
            const diffMatch = det.match(/Diff:\s*(?:Rs\.?|₹)?\s*([-\d,.]+)/i);
            const replBillNo = replMatch ? replMatch[1] : undefined;
            const diffVal = diffMatch ? parseFloat(diffMatch[1].replace(/,/g, '')) : undefined;

            if (replBillNo) {
                invoiceNo = replBillNo;
            }

            const diffStr = diffVal !== undefined
                ? (diffVal > 0 ? ` (+₹${diffVal.toFixed(2)} paid)` : diffVal < 0 ? ` (-₹${Math.abs(diffVal).toFixed(2)} refunded)` : ' (Equal Value: ₹0.00)')
                : '';

            narrative = replBillNo
                ? `Item exchange processed by ${operator} resulting in Replacement Bill #${replBillNo}${diffStr}.`
                : `Item exchange processed by ${operator}${diffStr}.`;

            if (diffVal !== undefined) {
                amount = Math.abs(diffVal).toFixed(2);
            }
        } else if (act === 'SALE_UPDATE') {
            const oldTotalMatch = det.match(/Old Total:\s*(?:Rs\.?|₹)?\s*([\d,.]+)/i);
            const newTotalMatch = det.match(/New Total:\s*(?:Rs\.?|₹)?\s*([\d,.]+)/i);
            const oldTotal = oldTotalMatch ? parseFloat(oldTotalMatch[1].replace(/,/g, '')) : undefined;
            const newTotal = newTotalMatch ? parseFloat(newTotalMatch[1].replace(/,/g, '')) : undefined;
            const pipeIndex = det.indexOf('|');
            const changesText = pipeIndex !== -1 ? det.slice(pipeIndex + 1).trim() : '';

            const parsedItemChanges: ItemChangeDetail[] = [];
            if (changesText) {
                changesText.split(';').forEach(chunk => {
                    const c = chunk.trim();
                    if (!c) return;
                    if (c.startsWith('added ')) {
                        parsedItemChanges.push({ type: 'ADDED', name: c.replace('added ', '') });
                    } else if (c.startsWith('removed ')) {
                        parsedItemChanges.push({ type: 'REMOVED', name: c.replace('removed ', '') });
                    } else if (c.includes(' qty ')) {
                        const m = c.match(/(.+)\s+qty\s+(\d+)\s*->\s*(\d+)/i);
                        if (m) parsedItemChanges.push({ type: 'QTY_CHANGED', name: m[1].trim(), oldQty: Number(m[2]), newQty: Number(m[3]) });
                        else parsedItemChanges.push({ type: 'QTY_CHANGED', name: c });
                    } else if (c.includes(' rate ')) {
                        const m = c.match(/(.+)\s+rate\s+Rs\.?([\d.]+)\s*->\s*Rs\.?([\d.]+)/i);
                        if (m) parsedItemChanges.push({ type: 'RATE_CHANGED', name: m[1].trim(), oldRate: Number(m[2]), newRate: Number(m[3]) });
                        else parsedItemChanges.push({ type: 'RATE_CHANGED', name: c });
                    }
                });
            }

            diff = {
                type: 'SALE_UPDATE',
                invoiceNo,
                totals: (oldTotal !== undefined || newTotal !== undefined) ? {
                    before: { grandTotal: oldTotal },
                    after: { grandTotal: newTotal }
                } : undefined,
                itemChanges: parsedItemChanges.length > 0 ? parsedItemChanges : undefined
            };

            const delta = (newTotal !== undefined && oldTotal !== undefined) ? newTotal - oldTotal : 0;
            const deltaStr = delta !== 0 ? ` (${delta > 0 ? '+' : '-'}₹${Math.abs(delta).toFixed(2)})` : '';
            const itemsStr = changesText ? ` • ${changesText}` : '';
            narrative = `Bill #${invoiceNo || ''} was modified by ${operator}: Total ₹${oldTotal?.toFixed(2) || '?'} → ₹${newTotal?.toFixed(2) || '?'}${deltaStr}${itemsStr}`;
        } else if (act === 'PAYMENT_UPDATE') {
            const oldMethodMatch = det.match(/Old Method:\s*([A-Za-z0-9_-]+)/i);
            const newMethodMatch = det.match(/New Method:\s*([A-Za-z0-9_-]+)/i);
            const oldMethod = oldMethodMatch ? oldMethodMatch[1] : 'N/A';
            const newMethod = newMethodMatch ? newMethodMatch[1] : 'N/A';

            diff = {
                type: 'PAYMENT_UPDATE',
                invoiceNo,
                payment: {
                    before: { method: oldMethod },
                    after: { method: newMethod }
                }
            };
            narrative = `Payment method for Bill #${invoiceNo || ''} was updated by ${operator}: ${oldMethod} → ${newMethod}`;
        } else if (act === 'USER_UPDATE' || act === 'USER_UPDATED' || act === 'REMOTE_USER_UPDATED') {
            if (det.includes(':')) {
                narrative = det;
            } else {
                narrative = `${operator} modified account permissions, profile details, or discount limits for staff account "${targetUser || 'staff member'}".`;
            }
        } else if (act === 'SALE_VOID') {
            narrative = invoiceNo
                ? `Bill #${invoiceNo} was voided and cancelled by ${operator}${amount ? ` (Amount: ₹${amount})` : ''}${reason ? `. Reason: ${reason}` : ''}. Items were restored to inventory.`
                : `A completed sale was cancelled and voided by ${operator}${reason ? `. Reason: ${reason}` : ''}.`;
        } else if (act === 'SALE_REFUND' || act === 'REFUND') {
            narrative = invoiceNo
                ? `A refund of ${amount ? `₹${amount}` : 'goods'} was processed on Bill #${invoiceNo} by ${operator}${reason ? `. Reason: ${reason}` : ''}.`
                : `A refund was processed by ${operator}${amount ? ` for ₹${amount}` : ''}${reason ? `. Reason: ${reason}` : ''}.`;
        } else if (act === 'DISCOUNT_APPLIED') {
            narrative = invoiceNo
                ? `A discretionary discount of ${amount ? `₹${amount}` : ''}${percentage ? ` (${percentage})` : ''} was applied on Bill #${invoiceNo} by ${operator}.`
                : `A discount was applied to the checkout bill by ${operator}.`;
        } else if (act === 'PRICE_OVERRIDE') {
            narrative = invoiceNo
                ? `A price override was authorized and applied on Bill #${invoiceNo} by ${operator}.`
                : `A price override was approved and applied by ${operator}.`;
        } else if (act === 'INVENTORY_ADJUSTMENT' || act === 'STOCK_ADJUST') {
            narrative = `Stock inventory counts were manually adjusted by ${operator}. ${det}`;
        } else if (act === 'CASH_DRAWER_OPEN') {
            narrative = `Cash drawer was manually opened by ${operator} outside a completed sale transaction.`;
        } else if (act === 'USER_LOGIN') {
            narrative = `${operator} logged into the POS terminal.`;
        } else if (act === 'USER_LOGOUT') {
            narrative = `${operator} logged out from the terminal session.`;
        } else if (act === 'LOGIN_FAILED') {
            narrative = `An unsuccessful login attempt was detected and blocked by the system security layer.`;
        } else if (act === 'PERMISSION_CHANGE') {
            narrative = `${operator} updated permission policies or maximum discount limits for user "${targetUser || 'staff member'}".`;
        }
    }

    return {
        narrative,
        invoiceNo,
        amount,
        percentage,
        reason,
        targetUser,
        diff
    };
}

export const ActivityPage: React.FC = () => {
    const [rawLogs, setRawLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [datePreset, setDatePreset] = useState<DatePreset>('ALL_TIME');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('ALL');
    const [selectedAction, setSelectedAction] = useState<string>('ALL');
    const [selectedUser, setSelectedUser] = useState<string>('ALL');
    const [selectedSeverity, setSelectedSeverity] = useState<SeverityLevel>('ALL');
    const [pageSize, setPageSize] = useState<number>(25);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

    // Persistent toggle to filter routine logins by default
    const [hideLogins, setHideLogins] = useState<boolean>(() => {
        const saved = localStorage.getItem('pos_hide_routine_logins');
        return saved !== null ? saved === 'true' : true;
    });

    const toggleHideLogins = () => {
        setHideLogins(prev => {
            const next = !prev;
            localStorage.setItem('pos_hide_routine_logins', String(next));
            return next;
        });
        setCurrentPage(1);
    };

    const { user } = useAuthStore();

    const loadLogs = useCallback(async () => {
        setLoading(true);
        try {
            const data = await auditService.getLogs(1000);
            setRawLogs(data || []);
        } catch (error) {
            console.error('Failed to load logs:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadLogs();
    }, [loadLogs]);

    const dateInterval = useMemo(() => {
        const now = new Date();
        switch (datePreset) {
            case 'TODAY':
                return { start: startOfDay(now), end: endOfDay(now) };
            case 'YESTERDAY': {
                const yest = subDays(now, 1);
                return { start: startOfDay(yest), end: endOfDay(yest) };
            }
            case 'LAST_7_DAYS':
                return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
            case 'LAST_30_DAYS':
                return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
            case 'THIS_MONTH':
                return { start: startOfMonth(now), end: endOfMonth(now) };
            case 'CUSTOM':
                if (customStartDate && customEndDate) {
                    return {
                        start: startOfDay(new Date(customStartDate)),
                        end: endOfDay(new Date(customEndDate))
                    };
                }
                return null;
            case 'ALL_TIME':
            default:
                return null;
        }
    }, [datePreset, customStartDate, customEndDate]);

    const { availableActions, availableUsers } = useMemo(() => {
        const actionsSet = new Set<string>();
        const usersMap = new Map<string, { id: string; name: string; role: string }>();

        rawLogs.forEach(log => {
            if (log.action) actionsSet.add(log.action);
            if (log.user?.name) {
                const key = log.userId || log.user.name;
                if (!usersMap.has(key)) {
                    usersMap.set(key, {
                        id: key,
                        name: log.user.name,
                        role: log.user.role || 'USER'
                    });
                }
            }
        });

        return {
            availableActions: Array.from(actionsSet).sort(),
            availableUsers: Array.from(usersMap.values()).sort((a, b) => a.name.localeCompare(b.name))
        };
    }, [rawLogs]);

    const routineLoginsCount = useMemo(() => {
        return rawLogs.filter(l => l.action === 'USER_LOGIN' || l.action === 'USER_LOGOUT').length;
    }, [rawLogs]);

    const filteredLogs = useMemo(() => {
        return rawLogs.filter(log => {
            const act = log.action;

            if (hideLogins && (act === 'USER_LOGIN' || act === 'USER_LOGOUT')) {
                if (selectedAction !== 'USER_LOGIN' && selectedAction !== 'USER_LOGOUT' && selectedCategory !== 'auth') {
                    return false;
                }
            }

            if (dateInterval) {
                const logDate = new Date(log.createdAt);
                if (isNaN(logDate.getTime()) || !isWithinInterval(logDate, dateInterval)) {
                    return false;
                }
            }

            if (selectedCategory !== 'ALL') {
                const cat = getActionCategory(act);
                if (cat !== selectedCategory) return false;
            }

            if (selectedAction !== 'ALL' && act !== selectedAction) {
                return false;
            }

            if (selectedUser !== 'ALL') {
                const matchId = log.userId === selectedUser;
                const matchName = log.user?.name === selectedUser;
                if (!matchId && !matchName) return false;
            }

            if (selectedSeverity !== 'ALL') {
                const sev = getActionSeverity(act);
                if (sev !== selectedSeverity) return false;
            }

            if (searchQuery.trim()) {
                const term = searchQuery.toLowerCase().trim();
                const matchDetails = (log.details || '').toLowerCase().includes(term);
                const matchAction = (act || '').toLowerCase().includes(term);
                const matchUser = (log.user?.name || '').toLowerCase().includes(term);
                const matchRole = (log.user?.role || '').toLowerCase().includes(term);
                if (!matchDetails && !matchAction && !matchUser && !matchRole) {
                    return false;
                }
            }

            return true;
        });
    }, [rawLogs, hideLogins, dateInterval, selectedCategory, selectedAction, selectedUser, selectedSeverity, searchQuery]);

    const kpiSummary = useMemo(() => {
        let critical = 0;
        let warning = 0;
        let financial = 0;
        const actors = new Set<string>();

        filteredLogs.forEach(l => {
            const sev = getActionSeverity(l.action);
            if (sev === 'CRITICAL') critical++;
            else if (sev === 'WARNING') warning++;
            else if (sev === 'FINANCIAL') financial++;

            if (l.user?.name) actors.add(l.user.name);
        });

        return {
            total: filteredLogs.length,
            critical,
            warning,
            financial,
            actors: actors.size
        };
    }, [filteredLogs]);

    const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
    const paginatedLogs = useMemo(() => {
        if (pageSize >= 9999) return filteredLogs;
        const start = (currentPage - 1) * pageSize;
        return filteredLogs.slice(start, start + pageSize);
    }, [filteredLogs, currentPage, pageSize]);

    const handleResetFilters = () => {
        setSearchQuery('');
        setDatePreset('ALL_TIME');
        setCustomStartDate('');
        setCustomEndDate('');
        setSelectedCategory('ALL');
        setSelectedAction('ALL');
        setSelectedUser('ALL');
        setSelectedSeverity('ALL');
        setCurrentPage(1);
    };

    const hasActiveFilters = 
        datePreset !== 'ALL_TIME' || 
        selectedCategory !== 'ALL' || 
        selectedAction !== 'ALL' || 
        selectedUser !== 'ALL' || 
        selectedSeverity !== 'ALL' || 
        searchQuery.trim() !== '';

    const handleExportCSV = () => {
        if (filteredLogs.length === 0) return;
        const headers = ['ID', 'Date Time', 'Action', 'Category', 'Severity', 'Operator', 'Role', 'Explanation'];
        const rows = filteredLogs.map(l => {
            const parsed = parseLogExplanation(l);
            return [
                `"${l.id}"`,
                `"${format(new Date(l.createdAt), 'yyyy-MM-dd HH:mm:ss')}"`,
                `"${l.action}"`,
                `"${getActionCategory(l.action)}"`,
                `"${getActionSeverity(l.action)}"`,
                `"${(l.user?.name || 'System').replace(/"/g, '""')}"`,
                `"${(l.user?.role || 'N/A').replace(/"/g, '""')}"`,
                `"${parsed.narrative.replace(/"/g, '""').replace(/\n/g, ' ')}"`
            ];
        });

        const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const encodedUri = encodeURI(csv);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `pos_activity_log_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const getActionVisual = (action: string) => {
        const severity = getActionSeverity(action);
        const category = getActionCategory(action);

        if (severity === 'CRITICAL') {
            return {
                icon: ShieldAlert,
                bgClass: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400',
                borderLeft: 'border-l-rose-500'
            };
        }
        if (severity === 'WARNING') {
            return {
                icon: AlertTriangle,
                bgClass: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400',
                borderLeft: 'border-l-amber-500'
            };
        }
        if (category === 'sales' || severity === 'FINANCIAL') {
            return {
                icon: ShoppingCart,
                bgClass: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400',
                borderLeft: 'border-l-emerald-500'
            };
        }
        if (category === 'inventory') {
            return {
                icon: Tag,
                bgClass: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400',
                borderLeft: 'border-l-purple-500'
            };
        }
        if (category === 'auth') {
            return {
                icon: User,
                bgClass: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400',
                borderLeft: 'border-l-sky-500'
            };
        }
        return {
            icon: Activity,
            bgClass: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
            borderLeft: 'border-l-gray-400'
        };
    };

    if (user?.role !== 'ADMIN') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
                <div className="bg-red-50 p-6 rounded-full mb-4">
                    <ShieldAlert className="w-16 h-16 text-red-500" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
                <p className="text-gray-500 max-w-sm">
                    Only administrators can view the system activity logs.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-12">
            {/* Header: Title & Fixed Action Buttons (No wrapping) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-3">
                        <div className="bg-primary-600 p-2 rounded-xl text-white shadow-sm">
                            <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
                        </div>
                        Activity Tracker
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">Audit trail of discounts, price overrides, refunds, inventory, and staff actions</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        variant="secondary"
                        onClick={handleExportCSV}
                        className="bg-white hover:bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 shadow-sm text-xs font-semibold flex items-center gap-1.5 h-9"
                    >
                        <Download className="w-4 h-4 text-gray-600" />
                        <span>Export CSV</span>
                    </Button>

                    <Button
                        variant="secondary"
                        onClick={loadLogs}
                        className="bg-white hover:bg-gray-50 w-9 h-9 p-0 rounded-lg border border-gray-200 shadow-sm flex items-center justify-center"
                        title="Reload logs"
                    >
                        <RefreshCw className={`w-4 h-4 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </div>

            {/* KPI Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-dark-card p-4 rounded-xl border border-gray-200 dark:border-dark-border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Filtered Events</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">
                            {loading ? '...' : kpiSummary.total.toLocaleString()}
                        </p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex items-center justify-center">
                        <Activity className="w-5 h-5" />
                    </div>
                </div>

                <div className="bg-white dark:bg-dark-card p-4 rounded-xl border border-gray-200 dark:border-dark-border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Critical Actions</p>
                        <p className="text-2xl font-bold text-rose-600 mt-0.5">
                            {loading ? '...' : kpiSummary.critical}
                        </p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                </div>

                <div className="bg-white dark:bg-dark-card p-4 rounded-xl border border-gray-200 dark:border-dark-border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Discounts & Overrides</p>
                        <p className="text-2xl font-bold text-amber-600 mt-0.5">
                            {loading ? '...' : kpiSummary.warning}
                        </p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                        <Percent className="w-5 h-5" />
                    </div>
                </div>

                <div className="bg-white dark:bg-dark-card p-4 rounded-xl border border-gray-200 dark:border-dark-border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Active Staff</p>
                        <p className="text-2xl font-bold text-sky-600 mt-0.5">
                            {loading ? '...' : kpiSummary.actors}
                        </p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                        <User className="w-5 h-5" />
                    </div>
                </div>
            </div>

            {/* Filter Controls Bar */}
            <div className="bg-white dark:bg-dark-card p-4 rounded-xl border border-gray-200 dark:border-dark-border shadow-sm space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    {/* Search Input */}
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCurrentPage(1);
                            }}
                            placeholder="Search by bill, staff, action, or reason..."
                            className="pl-9 pr-8 h-9 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-lg outline-none w-full text-xs"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Filter Dropdowns & Routine Logins Toggle */}
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Time Period */}
                        <select
                            value={datePreset}
                            onChange={(e) => {
                                setDatePreset(e.target.value as DatePreset);
                                setCurrentPage(1);
                            }}
                            className="h-9 px-2.5 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-lg text-xs font-medium outline-none"
                        >
                            <option value="ALL_TIME">All Time</option>
                            <option value="TODAY">Today</option>
                            <option value="YESTERDAY">Yesterday</option>
                            <option value="LAST_7_DAYS">Last 7 Days</option>
                            <option value="LAST_30_DAYS">Last 30 Days</option>
                            <option value="THIS_MONTH">This Month</option>
                            <option value="CUSTOM">Custom Range</option>
                        </select>

                        {/* Category */}
                        <select
                            value={selectedCategory}
                            onChange={(e) => {
                                setSelectedCategory(e.target.value as CategoryFilter);
                                setCurrentPage(1);
                            }}
                            className="h-9 px-2.5 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-lg text-xs font-medium outline-none"
                        >
                            <option value="ALL">All Categories</option>
                            <option value="sales">Sales & Overrides</option>
                            <option value="inventory">Inventory & Stock</option>
                            <option value="auth">Security & Users</option>
                            <option value="financial">Cash & Shifts</option>
                            <option value="system">System & Sync</option>
                        </select>

                        {/* Staff */}
                        <select
                            value={selectedUser}
                            onChange={(e) => {
                                setSelectedUser(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="h-9 px-2.5 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-lg text-xs font-medium outline-none"
                        >
                            <option value="ALL">All Staff ({availableUsers.length})</option>
                            {availableUsers.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.name} ({u.role})
                                </option>
                            ))}
                        </select>

                        {/* Hide Routine Logins Toggle Checkbox */}
                        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card h-9 hover:bg-gray-50">
                            <input
                                type="checkbox"
                                checked={hideLogins}
                                onChange={toggleHideLogins}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
                            />
                            <span>Hide Routine Logins</span>
                            {routineLoginsCount > 0 && (
                                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 font-semibold">
                                    {routineLoginsCount}
                                </span>
                            )}
                        </label>

                        {hasActiveFilters && (
                            <button
                                onClick={handleResetFilters}
                                className="h-9 px-2 text-xs font-medium text-rose-600 hover:text-rose-700 flex items-center gap-1"
                            >
                                <X className="w-3.5 h-3.5" />
                                Reset
                            </button>
                        )}
                    </div>
                </div>

                {/* Custom Date Range Row */}
                {datePreset === 'CUSTOM' && (
                    <div className="flex items-center gap-3 pt-2 border-t border-gray-100 dark:border-dark-border text-xs text-gray-500">
                        <span>From:</span>
                        <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => {
                                setCustomStartDate(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="h-8 px-2 rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card"
                        />
                        <span>To:</span>
                        <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => {
                                setCustomEndDate(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="h-8 px-2 rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card"
                        />
                    </div>
                )}
            </div>

            {/* Clean Native Audit Table (Replacing AI Cards) */}
            <div className="bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="table">
                        <thead>
                            <tr>
                                <th className="w-[180px]">Action</th>
                                <th>Event Summary</th>
                                <th className="w-[150px]">Staff</th>
                                <th className="w-[170px]">Date & Time</th>
                                <th className="w-[80px] text-right">Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <tr key={i}>
                                        <td colSpan={5} className="py-4 text-center">
                                            <div className="h-4 bg-gray-100 dark:bg-gray-800 animate-pulse rounded w-3/4 mx-auto" />
                                        </td>
                                    </tr>
                                ))
                            ) : paginatedLogs.length > 0 ? (
                                paginatedLogs.map((log) => {
                                    const severity = getActionSeverity(log.action);
                                    const parsed = parseLogExplanation(log);
                                    const logDate = new Date(log.createdAt);

                                    return (
                                        <tr key={log.id} className="hover:bg-gray-50/70 dark:hover:bg-gray-800/50 transition-colors">
                                            {/* Action Badge */}
                                            <td className="align-top py-3">
                                                <div className="space-y-1">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                                                        severity === 'CRITICAL' ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300' :
                                                        severity === 'WARNING' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                                                        severity === 'FINANCIAL' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' :
                                                        'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                                    }`}>
                                                        {formatActionTitle(log.action)}
                                                    </span>
                                                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-mono">
                                                        {getActionCategory(log.action)}
                                                    </p>
                                                </div>
                                            </td>

                                            {/* Event Summary */}
                                            <td className="align-top py-3">
                                                <div className="space-y-1.5">
                                                    <p className="text-sm text-gray-800 dark:text-gray-200 font-normal leading-relaxed">
                                                        {parsed.narrative}
                                                    </p>

                                                    {/* Key highlights inline */}
                                                    {(parsed.invoiceNo || parsed.amount || parsed.percentage || parsed.reason) && (
                                                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                                            {parsed.invoiceNo && (
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                                                    Bill #{parsed.invoiceNo}
                                                                </span>
                                                            )}
                                                            {parsed.amount && (
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                                    ₹{parsed.amount}
                                                                </span>
                                                            )}
                                                            {parsed.percentage && (
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                                                    {parsed.percentage}
                                                                </span>
                                                            )}
                                                            {parsed.reason && (
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-normal bg-gray-100 text-gray-600">
                                                                    Reason: {parsed.reason}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Staff */}
                                            <td className="align-top py-3 text-xs text-gray-700 dark:text-gray-300">
                                                <div className="font-semibold text-gray-900 dark:text-gray-100">
                                                    {log.user?.name || 'System'}
                                                </div>
                                                {log.user?.role && (
                                                    <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                                                        {log.user.role}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Date & Time */}
                                            <td className="align-top py-3 text-xs text-gray-500 whitespace-nowrap">
                                                <div className="font-medium text-gray-800 dark:text-gray-200">
                                                    {!isNaN(logDate.getTime()) ? format(logDate, 'dd MMM yyyy, hh:mm a') : log.createdAt}
                                                </div>
                                                {!isNaN(logDate.getTime()) && (
                                                    <div className="text-[11px] text-gray-400 mt-0.5">
                                                        {formatDistanceToNow(logDate, { addSuffix: true })}
                                                    </div>
                                                )}
                                            </td>

                                            {/* View Button */}
                                            <td className="align-top py-3 text-right">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setSelectedLog(log)}
                                                    className="h-8 px-2.5 text-xs text-gray-600 hover:text-gray-900"
                                                    title="View breakdown"
                                                >
                                                    <Eye className="w-3.5 h-3.5 mr-1" />
                                                    View
                                                </Button>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={5} className="py-12 text-center text-gray-400">
                                        <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                        <p className="text-sm font-medium">No activity records found</p>
                                        <p className="text-xs text-gray-400 mt-1">Try selecting 'All Time' or unchecking 'Hide Routine Logins'</p>
                                        {hasActiveFilters && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={handleResetFilters}
                                                className="mt-3 text-xs"
                                            >
                                                Clear Filters
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-dark-border bg-gray-50/50 dark:bg-dark-card/50">
                        <span className="text-xs text-gray-500">
                            Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredLogs.length)} of {filteredLogs.length} records
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                className="h-8 px-2.5 text-xs"
                            >
                                <ChevronLeft className="w-4 h-4 mr-1" />
                                Prev
                            </Button>
                            <span className="text-xs font-semibold px-1 text-gray-700 dark:text-gray-300">
                                Page {currentPage} of {totalPages}
                            </span>
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                className="h-8 px-2.5 text-xs"
                            >
                                Next
                                <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Inspect Modal: Structured What, When, Who breakdown (No Raw JSON) */}
            <Modal
                isOpen={Boolean(selectedLog)}
                onClose={() => setSelectedLog(null)}
                title={selectedLog ? formatActionTitle(selectedLog.action) : 'Activity Event Breakdown'}
                size="lg"
            >
                {selectedLog && (() => {
                    const parsed = parseLogExplanation(selectedLog);
                    const logDate = new Date(selectedLog.createdAt);

                    return (
                        <div className="space-y-4 text-xs p-1">
                            {/* What Happened Box */}
                            <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 space-y-1.5">
                                <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 font-bold uppercase tracking-wider text-[11px]">
                                    <Info className="w-3.5 h-3.5" />
                                    What Happened:
                                </div>
                                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-relaxed">
                                    {parsed.narrative}
                                </p>
                            </div>

                            {/* Before vs. After Bill Modification Comparison */}
                            {parsed.diff && (
                                <div className="p-4 rounded-xl bg-gray-50 dark:bg-dark-card border border-gray-200 dark:border-dark-border space-y-3">
                                    <div className="flex items-center justify-between border-b border-gray-200 dark:border-dark-border pb-2.5">
                                        <span className="font-bold text-gray-800 dark:text-gray-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
                                            <ArrowRight className="w-3.5 h-3.5 text-primary-600" />
                                            Before vs. After Modification History
                                        </span>
                                        {parsed.diff.invoiceNo && (
                                            <span className="text-[11px] font-bold text-primary-600 bg-primary-50 dark:bg-primary-950 px-2 py-0.5 rounded">
                                                Bill #{parsed.diff.invoiceNo}
                                            </span>
                                        )}
                                    </div>

                                    {/* Totals Comparison Table */}
                                    {parsed.diff.totals && (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs text-left">
                                                <thead>
                                                    <tr className="text-gray-400 border-b border-gray-200 dark:border-dark-border text-[10px] uppercase">
                                                        <th className="py-1.5">Attribute</th>
                                                        <th className="py-1.5">Before Change</th>
                                                        <th className="py-1.5">After Change</th>
                                                        <th className="py-1.5 text-right">Net Difference</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                                    {parsed.diff.totals.before.grandTotal !== undefined && parsed.diff.totals.after.grandTotal !== undefined && (
                                                        <tr>
                                                            <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">Grand Total</td>
                                                            <td className="py-2 text-gray-500 font-mono">₹{parsed.diff.totals.before.grandTotal.toFixed(2)}</td>
                                                            <td className="py-2 font-bold text-gray-900 dark:text-white font-mono">₹{parsed.diff.totals.after.grandTotal.toFixed(2)}</td>
                                                            <td className="py-2 text-right font-semibold font-mono">
                                                                {(() => {
                                                                    const diffVal = (parsed.diff.totals.after.grandTotal || 0) - (parsed.diff.totals.before.grandTotal || 0);
                                                                    if (diffVal === 0) return <span className="text-gray-400">₹0.00</span>;
                                                                    return diffVal > 0 ? (
                                                                        <span className="text-emerald-600 font-bold">+₹{diffVal.toFixed(2)}</span>
                                                                    ) : (
                                                                        <span className="text-rose-600 font-bold">-₹{Math.abs(diffVal).toFixed(2)}</span>
                                                                    );
                                                                })()}
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {parsed.diff.totals.before.itemCount !== undefined && parsed.diff.totals.after.itemCount !== undefined && (
                                                        <tr>
                                                            <td className="py-2 text-gray-600 dark:text-gray-400">Total Items Count</td>
                                                            <td className="py-2 text-gray-500">{parsed.diff.totals.before.itemCount} items</td>
                                                            <td className="py-2 font-semibold text-gray-800 dark:text-gray-200">{parsed.diff.totals.after.itemCount} items</td>
                                                            <td className="py-2 text-right">
                                                                {parsed.diff.totals.after.itemCount - parsed.diff.totals.before.itemCount !== 0 ? (
                                                                    <span className="font-semibold text-gray-600">
                                                                        {parsed.diff.totals.after.itemCount - parsed.diff.totals.before.itemCount > 0 ? '+' : ''}
                                                                        {parsed.diff.totals.after.itemCount - parsed.diff.totals.before.itemCount} items
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-gray-400">No change</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {(parsed.diff.totals.before.discount !== undefined || parsed.diff.totals.after.discount !== undefined) && (
                                                        (parsed.diff.totals.before.discount || 0) !== (parsed.diff.totals.after.discount || 0)
                                                    ) && (
                                                        <tr>
                                                            <td className="py-2 text-gray-600 dark:text-gray-400">Discount Applied</td>
                                                            <td className="py-2 text-gray-500 font-mono">₹{(parsed.diff.totals.before.discount || 0).toFixed(2)}</td>
                                                            <td className="py-2 font-semibold text-amber-600 font-mono">₹{(parsed.diff.totals.after.discount || 0).toFixed(2)}</td>
                                                            <td className="py-2 text-right text-amber-600 font-mono">
                                                                {(parsed.diff.totals.after.discount || 0) > (parsed.diff.totals.before.discount || 0) ? '+' : ''}
                                                                ₹{((parsed.diff.totals.after.discount || 0) - (parsed.diff.totals.before.discount || 0)).toFixed(2)}
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {parsed.diff.totals.before.paymentMethod && parsed.diff.totals.after.paymentMethod && (
                                                        parsed.diff.totals.before.paymentMethod !== parsed.diff.totals.after.paymentMethod
                                                    ) && (
                                                        <tr>
                                                            <td className="py-2 text-gray-600 dark:text-gray-400">Payment Mode</td>
                                                            <td className="py-2 text-gray-500">{parsed.diff.totals.before.paymentMethod}</td>
                                                            <td className="py-2 font-semibold text-indigo-600" colSpan={2}>
                                                                → {parsed.diff.totals.after.paymentMethod}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {/* Payment Only Diff */}
                                    {parsed.diff.payment && (
                                        <div className="flex items-center gap-3 p-3 bg-white dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border">
                                            <span className="text-gray-500 text-xs">Payment Method:</span>
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">{parsed.diff.payment.before.method}</span>
                                            <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                                            <span className="font-bold text-indigo-600">{parsed.diff.payment.after.method}</span>
                                            {parsed.diff.payment.after.paidAmount && (
                                                <span className="ml-auto font-mono font-semibold text-emerald-600 text-xs">
                                                    Paid: ₹{parsed.diff.payment.after.paidAmount.toFixed(2)}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Item-by-Item Changes List */}
                                    {parsed.diff.itemChanges && parsed.diff.itemChanges.length > 0 && (
                                        <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-dark-border">
                                            <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider block">
                                                Line Item Adjustments:
                                            </span>
                                            <div className="space-y-1.5">
                                                {parsed.diff.itemChanges.map((change, idx) => {
                                                    const isAdded = change.type === 'ADDED';
                                                    const isRemoved = change.type === 'REMOVED';
                                                    const isQty = change.type === 'QTY_CHANGED';
                                                    const isRate = change.type === 'RATE_CHANGED';

                                                    return (
                                                        <div
                                                            key={idx}
                                                            className={`p-2.5 rounded-lg border flex items-center justify-between text-xs ${
                                                                isAdded ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800' :
                                                                isRemoved ? 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800' :
                                                                isQty ? 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800' :
                                                                'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800'
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                                    isAdded ? 'bg-emerald-200 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-100' :
                                                                    isRemoved ? 'bg-rose-200 text-rose-800 dark:bg-rose-800 dark:text-rose-100' :
                                                                    isQty ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-100' :
                                                                    'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-100'
                                                                }`}>
                                                                    {isAdded ? '+ Added' : isRemoved ? '- Removed' : isQty ? 'Qty Changed' : 'Rate Changed'}
                                                                </span>
                                                                <span className="font-semibold">{change.name}</span>
                                                                {change.variant && (
                                                                    <span className="text-[10px] opacity-75">({change.variant})</span>
                                                                )}
                                                            </div>
                                                            <div className="font-mono text-right text-xs font-semibold">
                                                                {isAdded && `+${change.newQty || 1} (₹${change.rate || 0})`}
                                                                {isRemoved && `-${change.oldQty || 1}`}
                                                                {isQty && `Qty: ${change.oldQty} → ${change.newQty}`}
                                                                {isRate && `Rate: ₹${change.oldRate} → ₹${change.newRate}`}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {/* Exchange Details Section */}
                                    {(parsed.diff.type === 'EXCHANGE' || parsed.diff.returnedItems || parsed.diff.replacementItems) && (
                                        <div className="space-y-3 pt-1 border-t border-gray-100 dark:border-dark-border">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider block">
                                                    Item Exchange Breakdown:
                                                </span>
                                                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                                    {parsed.diff.originalBillNo && (
                                                        <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-dark-border text-gray-700 dark:text-gray-300">
                                                            Original: #{parsed.diff.originalBillNo}
                                                        </span>
                                                    )}
                                                    {parsed.diff.replacementBillNo && (
                                                        <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold">
                                                            Replacement: #{parsed.diff.replacementBillNo}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Returned Items */}
                                            {parsed.diff.returnedItems && parsed.diff.returnedItems.length > 0 && (
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center justify-between text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                                        <span className="flex items-center gap-1">
                                                            <ArrowDownRight className="w-3.5 h-3.5" /> Items Returned by Customer
                                                        </span>
                                                        <span className="font-mono">Total: ₹{(parsed.diff.returnedTotal || 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="space-y-1">
                                                        {parsed.diff.returnedItems.map((item, idx) => (
                                                            <div key={idx} className="p-2 rounded-lg bg-rose-50 border border-rose-200 dark:bg-rose-950/30 dark:border-rose-800 text-xs flex justify-between items-center text-rose-900 dark:text-rose-200">
                                                                <div>
                                                                    <span className="font-semibold">{item.name}</span>
                                                                    {item.variant && <span className="text-[10px] opacity-75 ml-1">({item.variant})</span>}
                                                                    <span className="ml-2 font-mono text-[11px] font-medium">x{item.qty}</span>
                                                                </div>
                                                                <span className="font-mono font-semibold">₹{(item.total || (item.rate || 0) * item.qty).toFixed(2)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Replacement Items */}
                                            {parsed.diff.replacementItems && parsed.diff.replacementItems.length > 0 && (
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                                        <span className="flex items-center gap-1">
                                                            <ArrowUpRight className="w-3.5 h-3.5" /> New Items Given in Exchange
                                                        </span>
                                                        <span className="font-mono">Total: ₹{(parsed.diff.replacementTotal || 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="space-y-1">
                                                        {parsed.diff.replacementItems.map((item, idx) => (
                                                            <div key={idx} className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800 text-xs flex justify-between items-center text-emerald-900 dark:text-emerald-200">
                                                                <div>
                                                                    <span className="font-semibold">{item.name}</span>
                                                                    {item.variant && <span className="text-[10px] opacity-75 ml-1">({item.variant})</span>}
                                                                    <span className="ml-2 font-mono text-[11px] font-medium">x{item.qty}</span>
                                                                </div>
                                                                <span className="font-mono font-semibold">₹{(item.total || (item.rate || 0) * item.qty).toFixed(2)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Financial Reconciliation Summary */}
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                                                <div className="p-2 rounded-lg bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border">
                                                    <span className="text-[10px] text-gray-500 block">Returned Credit</span>
                                                    <span className="font-mono font-semibold text-gray-700 dark:text-gray-300 text-xs">
                                                        ₹{(parsed.diff.returnedTotal || 0).toFixed(2)}
                                                    </span>
                                                </div>
                                                <div className="p-2 rounded-lg bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border">
                                                    <span className="text-[10px] text-gray-500 block">New Goods Value</span>
                                                    <span className="font-mono font-semibold text-gray-700 dark:text-gray-300 text-xs">
                                                        ₹{(parsed.diff.replacementTotal || 0).toFixed(2)}
                                                    </span>
                                                </div>
                                                <div className="p-2 rounded-lg bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border">
                                                    <span className="text-[10px] text-gray-500 block">Difference Settled</span>
                                                    <span className={`font-mono font-bold text-xs ${(parsed.diff.differenceAmount || 0) > 0 ? 'text-amber-600' : (parsed.diff.differenceAmount || 0) < 0 ? 'text-blue-600' : 'text-emerald-600'}`}>
                                                        {(parsed.diff.differenceAmount || 0) > 0 ? `+₹${parsed.diff.differenceAmount?.toFixed(2)} (Customer Paid)` :
                                                         (parsed.diff.differenceAmount || 0) < 0 ? `-₹${Math.abs(parsed.diff.differenceAmount || 0).toFixed(2)} (Refunded)` :
                                                         '₹0.00 (Equal Value)'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Refund Details Section */}
                                    {(parsed.diff.type === 'REFUND' || parsed.diff.refundedItems) && (
                                        <div className="space-y-3 pt-1 border-t border-gray-100 dark:border-dark-border">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider block">
                                                    Refund Items Breakdown:
                                                </span>
                                                {parsed.diff.billNo && (
                                                    <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-dark-border font-mono text-[11px] text-gray-700 dark:text-gray-300">
                                                        Bill #{parsed.diff.billNo}
                                                    </span>
                                                )}
                                            </div>

                                            {parsed.diff.refundedItems && parsed.diff.refundedItems.length > 0 && (
                                                <div className="space-y-1">
                                                    {parsed.diff.refundedItems.map((item, idx) => (
                                                        <div key={idx} className="p-2 rounded-lg bg-rose-50 border border-rose-200 dark:bg-rose-950/30 dark:border-rose-800 text-xs flex justify-between items-center text-rose-900 dark:text-rose-200">
                                                            <div>
                                                                <span className="font-semibold">{item.name}</span>
                                                                {item.variant && <span className="text-[10px] opacity-75 ml-1">({item.variant})</span>}
                                                                <span className="ml-2 font-mono text-[11px] font-medium">x{item.qty}</span>
                                                            </div>
                                                            <span className="font-mono font-semibold">₹{(item.amount || 0).toFixed(2)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border text-xs">
                                                <span className="text-gray-500">Total Refund Amount:</span>
                                                <span className="font-mono font-bold text-rose-600 text-sm">₹{(parsed.diff.refundAmount || 0).toFixed(2)}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* When & Who Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
                                    <div className="flex items-center gap-1.5 text-gray-500 font-semibold text-[11px]">
                                        <CalendarDays className="w-3.5 h-3.5 text-indigo-500" />
                                        When It Happened
                                    </div>
                                    <p className="font-bold text-gray-900 text-xs">
                                        {!isNaN(logDate.getTime()) 
                                            ? format(logDate, 'EEEE, dd MMMM yyyy')
                                            : selectedLog.createdAt}
                                    </p>
                                    <p className="font-mono text-gray-600 text-[11px]">
                                        {!isNaN(logDate.getTime()) 
                                            ? `${format(logDate, 'hh:mm:ss a')} (${formatDistanceToNow(logDate, { addSuffix: true })})`
                                            : ''}
                                    </p>
                                </div>

                                <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
                                    <div className="flex items-center gap-1.5 text-gray-500 font-semibold text-[11px]">
                                        <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
                                        Operator / Staff Member
                                    </div>
                                    <p className="font-bold text-gray-900 text-xs">
                                        {selectedLog.user?.name || 'System'}
                                    </p>
                                    <p className="text-gray-600 text-[11px]">
                                        Role: <span className="font-semibold uppercase">{selectedLog.user?.role || 'N/A'}</span>
                                    </p>
                                </div>
                            </div>

                            {/* Key Highlights */}
                            {(parsed.invoiceNo || parsed.amount || parsed.percentage || parsed.reason || parsed.targetUser) && (
                                <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
                                    <span className="font-bold text-gray-700 text-[11px] uppercase tracking-wider">
                                        Key Event Details
                                    </span>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                                        {parsed.invoiceNo && (
                                            <div className="p-2 bg-white rounded-lg border border-gray-200">
                                                <span className="text-[10px] text-gray-400 block font-medium">Bill Number</span>
                                                <span className="font-bold text-indigo-600 text-xs">#{parsed.invoiceNo}</span>
                                            </div>
                                        )}
                                        {parsed.amount && (
                                            <div className="p-2 bg-white rounded-lg border border-gray-200">
                                                <span className="text-[10px] text-gray-400 block font-medium">Amount</span>
                                                <span className="font-bold text-emerald-600 text-xs">₹{parsed.amount}</span>
                                            </div>
                                        )}
                                        {parsed.percentage && (
                                            <div className="p-2 bg-white rounded-lg border border-gray-200">
                                                <span className="text-[10px] text-gray-400 block font-medium">Discount Percent</span>
                                                <span className="font-bold text-amber-600 text-xs">{parsed.percentage}</span>
                                            </div>
                                        )}
                                        {parsed.targetUser && (
                                            <div className="p-2 bg-white rounded-lg border border-gray-200">
                                                <span className="text-[10px] text-gray-400 block font-medium">Target User</span>
                                                <span className="font-bold text-gray-800 text-xs">{parsed.targetUser}</span>
                                            </div>
                                        )}
                                    </div>

                                    {parsed.reason && (
                                        <div className="p-2.5 bg-white rounded-lg border border-gray-200 mt-2">
                                            <span className="text-[10px] text-gray-400 block font-medium">Stated Reason:</span>
                                            <span className="font-semibold text-gray-800 text-xs">{parsed.reason}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-between text-[11px] text-gray-400 font-mono">
                                <span>Event ID: {selectedLog.id}</span>
                                <span>Category: {getActionCategory(selectedLog.action)}</span>
                            </div>
                        </div>
                    );
                })()}
            </Modal>
        </div>
    );
};
