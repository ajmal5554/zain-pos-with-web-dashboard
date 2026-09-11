import * as React from 'react';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { 
    Activity, 
    Search, 
    ShoppingCart, 
    Trash2, 
    User, 
    Clock, 
    ShieldAlert, 
    AlertTriangle,
    RefreshCw, 
    Download, 
    Calendar, 
    ChevronLeft, 
    ChevronRight, 
    X, 
    DollarSign, 
    Tag, 
    Receipt,
    Eye,
    Percent,
    ShieldCheck,
    ArrowRight,
    ArrowDownRight,
    ArrowUpRight
} from 'lucide-react';
import api from '@/lib/api';
import { demoActivityLogs, isDemoModeEnabled } from '@/lib/demo';
import { 
    Card, 
    CardContent, 
    CardHeader, 
    CardTitle 
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { StatCard } from '@/components/shared/StatCard';
import { cn } from '@/lib/utils';
import { socket } from '@/lib/socket';
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
import { toast } from 'react-hot-toast';

export interface AuditLog {
    id: string;
    action: string;
    details: string;
    userId: string | null;
    createdAt: string;
    user?: {
        id?: string;
        name: string;
        role: string;
        username?: string;
    };
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
    billNo?: string;
    refundAmount?: number;
    reason?: string;
    refundPayments?: Array<{ paymentMode: string; amount: number }>;
    refundedItems?: RefundItemDetail[];
    remarks?: string;
}

export type DatePreset = 'ALL_TIME' | 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH' | 'CUSTOM';
export type CategoryFilter = 'ALL' | 'sales' | 'inventory' | 'auth' | 'financial' | 'system';

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
        'INVENTORY_ADJUSTMENT': 'Stock Recount',
        'STOCK_ADJUST': 'Stock Adjustment',
        'STOCK_ADD': 'Stock Added',
        'PRODUCT_DELETE': 'Product Deleted',
        'PRODUCT_UPDATE': 'Product Modified',
        'INVENTORY_ALERT': 'Low Stock Alert',
        'USER_LOGIN': 'User Login',
        'USER_LOGOUT': 'User Logout',
        'LOGIN_FAILED': 'Failed Login',
        'PASSWORD_CHANGE': 'Password Changed',
        'PERMISSION_CHANGE': 'Permissions Modified',
        'USER_CREATED': 'User Created',
        'USER_UPDATED': 'User Updated',
        'USER_UPDATE': 'User Updated',
        'REMOTE_USER_UPDATED': 'User Updated',
        'USER_DELETED': 'User Deleted',
        'CASH_DRAWER_OPEN': 'Drawer Opened',
        'CASH_DRAWER_CLOSE': 'Drawer Closed',
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
                narrative = `${operator} updated permissions, profile, or discount limits for user "${targetUser || 'staff member'}".`;
            }
        } else if (act === 'SALE_VOID') {
            narrative = invoiceNo
                ? `Bill #${invoiceNo} was voided by ${operator}${amount ? ` (₹${amount})` : ''}${reason ? ` · Reason: ${reason}` : ''}. Items returned to inventory.`
                : `Sale was cancelled and voided by ${operator}${reason ? ` · Reason: ${reason}` : ''}.`;
        } else if (act === 'SALE_REFUND' || act === 'REFUND') {
            narrative = invoiceNo
                ? `Refund of ${amount ? `₹${amount}` : 'items'} processed on Bill #${invoiceNo} by ${operator}${reason ? ` · Reason: ${reason}` : ''}.`
                : `Refund processed by ${operator}${amount ? ` for ₹${amount}` : ''}${reason ? ` · Reason: ${reason}` : ''}.`;
        } else if (act === 'DISCOUNT_APPLIED') {
            narrative = invoiceNo
                ? `Discount of ${amount ? `₹${amount}` : ''}${percentage ? ` (${percentage})` : ''} applied on Bill #${invoiceNo} by ${operator}.`
                : `Discount applied by ${operator}.`;
        } else if (act === 'PRICE_OVERRIDE') {
            narrative = invoiceNo
                ? `Price override applied on Bill #${invoiceNo} by ${operator}.`
                : `Price override approved and applied by ${operator}.`;
        } else if (act === 'EXCHANGE') {
            narrative = invoiceNo
                ? `Item exchange processed for Bill #${invoiceNo} by ${operator}.`
                : `Item exchange processed by ${operator}.`;
        } else if (act === 'INVENTORY_ADJUSTMENT' || act === 'STOCK_ADJUST') {
            narrative = `Inventory stock count adjusted by ${operator}: ${det}`;
        } else if (act === 'CASH_DRAWER_OPEN') {
            narrative = `Cash drawer manually opened by ${operator} outside a checkout sale.`;
        } else if (act === 'USER_LOGIN') {
            narrative = `${operator} logged in to POS terminal.`;
        } else if (act === 'USER_LOGOUT') {
            narrative = `${operator} logged out from terminal.`;
        } else if (act === 'LOGIN_FAILED') {
            narrative = `Failed login attempt blocked by system.`;
        } else if (act === 'PERMISSION_CHANGE') {
            narrative = `${operator} updated permissions or discount caps for user "${targetUser || 'staff'}".`;
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

export default function ActivityPage() {
    const [rawLogs, setRawLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [datePreset, setDatePreset] = useState<DatePreset>('ALL_TIME');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('ALL');
    const [pageSize, setPageSize] = useState<number>(20);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

    // Persistent toggle: Hide routine user logins (defaults to TRUE so page is clean)
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

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setCurrentPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Fetch logs
    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            if (isDemoModeEnabled()) {
                setRawLogs(demoActivityLogs as AuditLog[]);
                return;
            }

            const response = await api.get('/activity', {
                params: {
                    limit: 1000,
                    includeSystem: 'true'
                }
            });

            const data = Array.isArray(response.data) 
                ? response.data 
                : (response.data?.logs || []);

            setRawLogs(data);
        } catch (error) {
            console.error('Failed to fetch activity logs:', error);
            toast.error('Failed to load activity logs');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchLogs();
    }, [fetchLogs]);

    // Socket listener for live updates
    useEffect(() => {
        if (isDemoModeEnabled()) return;
        const handleNewAudit = (newLog: AuditLog) => {
            setRawLogs(prev => [newLog, ...prev]);
        };

        socket.on('audit:new', handleNewAudit);
        socket.on('sale:voided', () => void fetchLogs());
        socket.on('sale:updated', () => void fetchLogs());

        return () => {
            socket.off('audit:new', handleNewAudit);
            socket.off('sale:voided');
            socket.off('sale:updated');
        };
    }, [fetchLogs]);

    // Calculate active date interval
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

    // Filtered logs
    const filteredLogs = useMemo(() => {
        return rawLogs.filter(log => {
            const act = log.action;

            // Routine logins filter
            if (hideLogins && (act === 'USER_LOGIN' || act === 'USER_LOGOUT')) {
                if (selectedCategory !== 'auth') {
                    return false;
                }
            }

            // Date interval
            if (dateInterval) {
                const logDate = new Date(log.createdAt);
                if (isNaN(logDate.getTime()) || !isWithinInterval(logDate, dateInterval)) {
                    return false;
                }
            }

            // Category filter
            if (selectedCategory !== 'ALL') {
                const cat = getActionCategory(act);
                if (cat !== selectedCategory) return false;
            }

            // Search query
            if (debouncedSearch.trim()) {
                const term = debouncedSearch.toLowerCase().trim();
                const detailsMatch = (log.details || '').toLowerCase().includes(term);
                const actionMatch = (act || '').toLowerCase().includes(term);
                const userMatch = (log.user?.name || '').toLowerCase().includes(term);
                if (!detailsMatch && !actionMatch && !userMatch) {
                    return false;
                }
            }

            return true;
        });
    }, [rawLogs, hideLogins, dateInterval, selectedCategory, debouncedSearch]);

    // KPI Summary
    const kpiSummary = useMemo(() => {
        let critical = 0;
        let warning = 0;
        const actors = new Set<string>();

        filteredLogs.forEach(l => {
            const sev = getActionSeverity(l.action);
            if (sev === 'CRITICAL') critical++;
            else if (sev === 'WARNING') warning++;

            if (l.user?.name) actors.add(l.user.name);
        });

        return {
            total: filteredLogs.length,
            critical,
            warning,
            actors: actors.size
        };
    }, [filteredLogs]);

    // Pagination
    const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
    const paginatedLogs = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredLogs.slice(start, start + pageSize);
    }, [filteredLogs, currentPage, pageSize]);

    const handleResetFilters = () => {
        setSearch('');
        setDebouncedSearch('');
        setDatePreset('ALL_TIME');
        setCustomStartDate('');
        setCustomEndDate('');
        setSelectedCategory('ALL');
        setCurrentPage(1);
    };

    const hasActiveFilters = 
        datePreset !== 'ALL_TIME' || 
        selectedCategory !== 'ALL' || 
        debouncedSearch !== '';

    // Export CSV
    const handleExportCSV = () => {
        if (filteredLogs.length === 0) {
            toast.error('No logs to export');
            return;
        }

        const headers = ['ID', 'Date & Time', 'Action', 'Category', 'Severity', 'Staff', 'Role', 'Details'];
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

        const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `activity_log_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success(`Exported ${filteredLogs.length} activity records`);
    };

    return (
        <div className="flex-1 space-y-4 pt-4 pb-6 min-w-0">
            {/* Header: Fixed top actions, no wrapping */}
            <div className="flex items-center justify-between gap-4 w-full">
                <div>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Activity Log</h2>
                    <p className="text-muted-foreground text-xs hidden sm:block">
                        Audit trail of sales overrides, discounts, inventory, and staff actions.
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleExportCSV} 
                        className="h-9 px-3"
                    >
                        <Download className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                    <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={fetchLogs} 
                        disabled={loading} 
                        className="h-9 w-9"
                        title="Reload"
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </Button>
                </div>
            </div>

            {/* KPI Stat Cards matching Sales & Dashboard design */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard 
                    title="Total Events" 
                    value={kpiSummary.total} 
                    icon={<Activity className="h-4 w-4" />} 
                    loading={loading}
                    variant={kpiSummary.total > 0 ? 'default' : 'default'}
                />
                <StatCard 
                    title="Critical Actions" 
                    value={kpiSummary.critical} 
                    icon={<AlertTriangle className="h-4 w-4 text-rose-500" />} 
                    loading={loading}
                    variant={kpiSummary.critical > 0 ? 'warning' : 'default'}
                />
                <StatCard 
                    title="Discounts & Overrides" 
                    value={kpiSummary.warning} 
                    icon={<Percent className="h-4 w-4 text-amber-500" />} 
                    loading={loading}
                />
                <StatCard 
                    title="Active Staff" 
                    value={kpiSummary.actors} 
                    icon={<User className="h-4 w-4 text-sky-500" />} 
                    loading={loading}
                />
            </div>

            {/* Filter Bar: Clean, unified, single-card layout */}
            <Card className="border-slate-200/60 shadow-sm dark:border-slate-800">
                <CardContent className="p-4 space-y-3">
                    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                        {/* Search Input */}
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search by bill number, staff, or reason..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full h-9 rounded-md border border-input bg-background pl-9 pr-8 text-sm outline-none focus:ring-1 focus:ring-primary"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch('')}
                                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>

                        {/* Dropdowns & Checkbox */}
                        <div className="flex flex-wrap items-center gap-2.5">
                            {/* Category Filter */}
                            <select
                                value={selectedCategory}
                                onChange={(e) => {
                                    setSelectedCategory(e.target.value as CategoryFilter);
                                    setCurrentPage(1);
                                }}
                                className="h-9 px-3 rounded-md border border-input bg-background text-xs font-medium outline-none focus:ring-1 focus:ring-primary"
                            >
                                <option value="ALL">All Categories</option>
                                <option value="sales">Sales & Overrides</option>
                                <option value="inventory">Inventory & Stock</option>
                                <option value="auth">Security & Users</option>
                                <option value="financial">Cash & Shifts</option>
                                <option value="system">System & Sync</option>
                            </select>

                            {/* Date Filter */}
                            <select
                                value={datePreset}
                                onChange={(e) => {
                                    setDatePreset(e.target.value as DatePreset);
                                    setCurrentPage(1);
                                }}
                                className="h-9 px-3 rounded-md border border-input bg-background text-xs font-medium outline-none focus:ring-1 focus:ring-primary"
                            >
                                <option value="ALL_TIME">All Time</option>
                                <option value="TODAY">Today</option>
                                <option value="YESTERDAY">Yesterday</option>
                                <option value="LAST_7_DAYS">Last 7 Days</option>
                                <option value="LAST_30_DAYS">Last 30 Days</option>
                                <option value="THIS_MONTH">This Month</option>
                                <option value="CUSTOM">Custom Range</option>
                            </select>

                            {/* Hide Logins Checkbox */}
                            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer select-none px-2 py-1.5 rounded-md border border-input bg-background h-9">
                                <input
                                    type="checkbox"
                                    checked={hideLogins}
                                    onChange={toggleHideLogins}
                                    className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5"
                                />
                                <span>Hide Logins</span>
                            </label>

                            {hasActiveFilters && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleResetFilters}
                                    className="h-9 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    Reset
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Custom Range Picker */}
                    {datePreset === 'CUSTOM' && (
                        <div className="flex items-center gap-3 pt-2 border-t text-xs text-muted-foreground">
                            <span>From:</span>
                            <input
                                type="date"
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="h-8 px-2 rounded-md border border-input bg-background"
                            />
                            <span>To:</span>
                            <input
                                type="date"
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="h-8 px-2 rounded-md border border-input bg-background"
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Main Activity Table */}
            <Card className="border-slate-200/60 shadow-sm dark:border-slate-800">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[180px]">Action</TableHead>
                                <TableHead>Event Description</TableHead>
                                <TableHead className="w-[150px] hidden sm:table-cell">Staff</TableHead>
                                <TableHead className="w-[180px] hidden md:table-cell">Date & Time</TableHead>
                                <TableHead className="w-[80px] text-right">Details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={5} className="h-14 text-center">
                                            <div className="h-4 bg-muted animate-pulse rounded w-3/4 mx-auto" />
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : paginatedLogs.length > 0 ? (
                                paginatedLogs.map((log) => {
                                    const severity = getActionSeverity(log.action);
                                    const parsed = parseLogExplanation(log);
                                    const logDate = new Date(log.createdAt);

                                    return (
                                        <TableRow key={log.id} className="hover:bg-muted/40 transition-colors">
                                            {/* Action Badge */}
                                            <TableCell className="font-medium align-top py-3.5">
                                                <div className="space-y-1">
                                                    <span className={cn(
                                                        "inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold",
                                                        severity === 'CRITICAL' && "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
                                                        severity === 'WARNING' && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
                                                        severity === 'FINANCIAL' && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
                                                        severity === 'INFO' && "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                                    )}>
                                                        {formatActionTitle(log.action)}
                                                    </span>
                                                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono">
                                                        {getActionCategory(log.action)}
                                                    </p>
                                                </div>
                                            </TableCell>

                                            {/* Description / What Happened */}
                                            <TableCell className="align-top py-3.5">
                                                <div className="space-y-1">
                                                    <p className="text-sm text-slate-900 dark:text-slate-100 font-normal leading-relaxed">
                                                        {parsed.narrative}
                                                    </p>

                                                    {/* Key badges inline if any */}
                                                    {(parsed.invoiceNo || parsed.amount || parsed.percentage || parsed.reason) && (
                                                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                                            {parsed.invoiceNo && (
                                                                <Badge variant="outline" className="text-[11px] font-normal px-2 py-0">
                                                                    Bill #{parsed.invoiceNo}
                                                                </Badge>
                                                            )}
                                                            {parsed.amount && (
                                                                <Badge variant="secondary" className="text-[11px] font-semibold px-2 py-0">
                                                                    ₹{parsed.amount}
                                                                </Badge>
                                                            )}
                                                            {parsed.percentage && (
                                                                <Badge variant="secondary" className="text-[11px] font-semibold px-2 py-0">
                                                                    {parsed.percentage}
                                                                </Badge>
                                                            )}
                                                            {parsed.reason && (
                                                                <span className="text-xs text-muted-foreground italic">
                                                                    ({parsed.reason})
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>

                                            {/* Staff */}
                                            <TableCell className="align-top py-3.5 hidden sm:table-cell">
                                                <div className="text-xs">
                                                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                                                        {log.user?.name || 'System'}
                                                    </p>
                                                    {log.user?.role && (
                                                        <p className="text-muted-foreground text-[11px] uppercase font-mono">
                                                            {log.user.role}
                                                        </p>
                                                    )}
                                                </div>
                                            </TableCell>

                                            {/* Date & Time */}
                                            <TableCell className="align-top py-3.5 hidden md:table-cell">
                                                <div className="text-xs text-muted-foreground space-y-0.5 font-mono">
                                                    <p>
                                                        {!isNaN(logDate.getTime()) 
                                                            ? format(logDate, 'dd MMM yyyy, hh:mm a')
                                                            : log.createdAt}
                                                    </p>
                                                    {!isNaN(logDate.getTime()) && (
                                                        <p className="text-[11px] text-slate-400 font-sans">
                                                            {formatDistanceToNow(logDate, { addSuffix: true })}
                                                        </p>
                                                    )}
                                                </div>
                                            </TableCell>

                                            {/* Actions */}
                                            <TableCell className="align-top py-3.5 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setSelectedLog(log)}
                                                    className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                                                >
                                                    <Eye className="h-3.5 w-3.5 mr-1" />
                                                    View
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground text-sm">
                                        No activity records found matching active filters.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>

                    {/* Table Pagination Footer */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
                            <span>
                                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredLogs.length)} of {filteredLogs.length} records
                            </span>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    className="h-8 px-2"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="px-2 font-medium">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    className="h-8 px-2"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Clean Detail Inspector Dialog */}
            <Dialog open={Boolean(selectedLog)} onOpenChange={(open) => !open && setSelectedLog(null)}>
                <DialogContent className="max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-lg font-bold">
                            {selectedLog ? formatActionTitle(selectedLog.action) : ''}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            {selectedLog && !isNaN(new Date(selectedLog.createdAt).getTime())
                                ? format(new Date(selectedLog.createdAt), 'EEEE, dd MMMM yyyy, hh:mm:ss a')
                                : ''}
                        </DialogDescription>
                    </DialogHeader>

                    {selectedLog && (() => {
                        const parsed = parseLogExplanation(selectedLog);
                        const logDate = new Date(selectedLog.createdAt);

                        return (
                            <div className="space-y-3 py-2 text-sm">
                                {/* Narrative Explanation */}
                                <div className="p-3 bg-muted/50 rounded-lg text-slate-800 dark:text-slate-200 leading-relaxed text-sm">
                                    {parsed.narrative}
                                </div>

                                {/* Structured Diff View for Bill & Payment Modifications */}
                                {parsed.diff && (
                                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-700 dark:text-slate-300 text-xs uppercase tracking-wider">
                                                Modification History (Before vs. After)
                                            </span>
                                            {parsed.diff.invoiceNo && (
                                                <Badge variant="outline" className="text-[11px] font-mono">
                                                    Bill #{parsed.diff.invoiceNo}
                                                </Badge>
                                            )}
                                        </div>

                                        {/* Totals Comparison Table */}
                                        {parsed.diff.totals && (
                                            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden text-xs">
                                                <table className="w-full">
                                                    <thead className="bg-slate-100/75 dark:bg-slate-900/75 text-slate-500 text-[11px] border-b border-slate-200 dark:border-slate-800">
                                                        <tr>
                                                            <th className="text-left font-semibold py-1.5 px-3">Field</th>
                                                            <th className="text-left font-semibold py-1.5 px-3 text-slate-400">Before</th>
                                                            <th className="text-left font-semibold py-1.5 px-3">After</th>
                                                            <th className="text-right font-semibold py-1.5 px-3">Change</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                        {parsed.diff.totals.before.grandTotal !== undefined && parsed.diff.totals.after.grandTotal !== undefined && (
                                                            <tr className="font-medium bg-slate-50/50 dark:bg-slate-900/30">
                                                                <td className="py-2 px-3 text-slate-800 dark:text-slate-200 font-semibold">Grand Total</td>
                                                                <td className="py-2 px-3 text-slate-500 font-mono">₹{parsed.diff.totals.before.grandTotal.toFixed(2)}</td>
                                                                <td className="py-2 px-3 font-bold text-indigo-600 font-mono">₹{parsed.diff.totals.after.grandTotal.toFixed(2)}</td>
                                                                <td className="py-2 px-3 text-right font-mono font-semibold">
                                                                    {parsed.diff.totals.after.grandTotal !== parsed.diff.totals.before.grandTotal ? (
                                                                        <span className={parsed.diff.totals.after.grandTotal > parsed.diff.totals.before.grandTotal ? 'text-emerald-600' : 'text-rose-600'}>
                                                                            {parsed.diff.totals.after.grandTotal > parsed.diff.totals.before.grandTotal ? '+' : ''}
                                                                            ₹{(parsed.diff.totals.after.grandTotal - parsed.diff.totals.before.grandTotal).toFixed(2)}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-slate-400">No change</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        )}
                                                        {parsed.diff.totals.before.subtotal !== undefined && parsed.diff.totals.after.subtotal !== undefined && (
                                                            <tr>
                                                                <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400">Subtotal</td>
                                                                <td className="py-1.5 px-3 text-slate-500 font-mono">₹{parsed.diff.totals.before.subtotal.toFixed(2)}</td>
                                                                <td className="py-1.5 px-3 text-slate-700 dark:text-slate-300 font-mono">₹{parsed.diff.totals.after.subtotal.toFixed(2)}</td>
                                                                <td className="py-1.5 px-3 text-right text-slate-500 font-mono">
                                                                    {parsed.diff.totals.after.subtotal > parsed.diff.totals.before.subtotal ? '+' : ''}
                                                                    ₹{(parsed.diff.totals.after.subtotal - parsed.diff.totals.before.subtotal).toFixed(2)}
                                                                </td>
                                                            </tr>
                                                        )}
                                                        {(parsed.diff.totals.before.discount !== undefined || parsed.diff.totals.after.discount !== undefined) && (
                                                            <tr>
                                                                <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400">Discount Applied</td>
                                                                <td className="py-1.5 px-3 text-slate-500 font-mono">₹{(parsed.diff.totals.before.discount || 0).toFixed(2)}</td>
                                                                <td className="py-1.5 px-3 font-semibold text-amber-600 font-mono">₹{(parsed.diff.totals.after.discount || 0).toFixed(2)}</td>
                                                                <td className="py-1.5 px-3 text-right text-amber-600 font-mono">
                                                                    {(parsed.diff.totals.after.discount || 0) > (parsed.diff.totals.before.discount || 0) ? '+' : ''}
                                                                    ₹{((parsed.diff.totals.after.discount || 0) - (parsed.diff.totals.before.discount || 0)).toFixed(2)}
                                                                </td>
                                                            </tr>
                                                        )}
                                                        {parsed.diff.totals.before.paymentMethod && parsed.diff.totals.after.paymentMethod && (
                                                            parsed.diff.totals.before.paymentMethod !== parsed.diff.totals.after.paymentMethod
                                                        ) && (
                                                            <tr>
                                                                <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400">Payment Mode</td>
                                                                <td className="py-1.5 px-3 text-slate-500">{parsed.diff.totals.before.paymentMethod}</td>
                                                                <td className="py-1.5 px-3 font-semibold text-indigo-600" colSpan={2}>
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
                                            <div className="flex items-center gap-3 p-3 bg-white dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
                                                <span className="text-slate-500 text-xs">Payment Method:</span>
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">{parsed.diff.payment.before.method}</span>
                                                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
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
                                            <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800">
                                                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
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
                                            <div className="space-y-3 pt-1 border-t border-slate-200 dark:border-slate-800">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                                                        Item Exchange Breakdown:
                                                    </span>
                                                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                                        {parsed.diff.originalBillNo && (
                                                            <Badge variant="outline" className="text-[11px]">
                                                                Original: #{parsed.diff.originalBillNo}
                                                            </Badge>
                                                        )}
                                                        {parsed.diff.replacementBillNo && (
                                                            <Badge className="bg-indigo-600 text-white text-[11px]">
                                                                Replacement: #{parsed.diff.replacementBillNo}
                                                            </Badge>
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
                                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                                        <span className="text-[10px] text-muted-foreground block">Returned Credit</span>
                                                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 text-xs">
                                                            ₹{(parsed.diff.returnedTotal || 0).toFixed(2)}
                                                        </span>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                                        <span className="text-[10px] text-muted-foreground block">New Goods Value</span>
                                                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 text-xs">
                                                            ₹{(parsed.diff.replacementTotal || 0).toFixed(2)}
                                                        </span>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                                        <span className="text-[10px] text-muted-foreground block">Difference Settled</span>
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
                                            <div className="space-y-3 pt-1 border-t border-slate-200 dark:border-slate-800">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                                                        Refund Items Breakdown:
                                                    </span>
                                                    {parsed.diff.billNo && (
                                                        <Badge variant="outline" className="font-mono text-[11px]">
                                                            Bill #{parsed.diff.billNo}
                                                        </Badge>
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

                                                <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                                                    <span className="text-muted-foreground">Total Refund Amount:</span>
                                                    <span className="font-mono font-bold text-rose-600 text-sm">₹{(parsed.diff.refundAmount || 0).toFixed(2)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Key Attributes Grid */}
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="p-2.5 border rounded-lg">
                                        <span className="text-muted-foreground block text-[11px]">Staff</span>
                                        <span className="font-semibold">{selectedLog.user?.name || 'System'}</span>
                                        {selectedLog.user?.role && (
                                            <span className="text-muted-foreground text-[10px] ml-1 uppercase">
                                                ({selectedLog.user.role})
                                            </span>
                                        )}
                                    </div>
                                    <div className="p-2.5 border rounded-lg">
                                        <span className="text-muted-foreground block text-[11px]">Category</span>
                                        <span className="font-semibold capitalize">{getActionCategory(selectedLog.action)}</span>
                                    </div>

                                    {parsed.invoiceNo && (
                                        <div className="p-2.5 border rounded-lg">
                                            <span className="text-muted-foreground block text-[11px]">Invoice</span>
                                            <span className="font-semibold text-primary">#{parsed.invoiceNo}</span>
                                        </div>
                                    )}

                                    {parsed.amount && (
                                        <div className="p-2.5 border rounded-lg">
                                            <span className="text-muted-foreground block text-[11px]">Amount</span>
                                            <span className="font-semibold text-emerald-600">₹{parsed.amount}</span>
                                        </div>
                                    )}

                                    {parsed.percentage && (
                                        <div className="p-2.5 border rounded-lg">
                                            <span className="text-muted-foreground block text-[11px]">Discount</span>
                                            <span className="font-semibold text-amber-600">{parsed.percentage}</span>
                                        </div>
                                    )}

                                    {parsed.targetUser && (
                                        <div className="p-2.5 border rounded-lg">
                                            <span className="text-muted-foreground block text-[11px]">Target User</span>
                                            <span className="font-semibold">{parsed.targetUser}</span>
                                        </div>
                                    )}
                                </div>

                                {parsed.reason && (
                                    <div className="p-2.5 border rounded-lg text-xs">
                                        <span className="text-muted-foreground block text-[11px]">Reason</span>
                                        <span className="font-medium text-slate-800 dark:text-slate-200">{parsed.reason}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    <DialogFooter>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedLog(null)}
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
