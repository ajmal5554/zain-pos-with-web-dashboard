import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { CreditCard, Trash2, X, Plus, Minus, Scan, Save, Banknote, Smartphone, Printer, ArrowRight, CheckCircle, AlertTriangle, AlertCircle, User, UserPlus, Phone, Search, ChevronDown, Check } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { showToast } from '../components/ui/Toast';
import { useAuthStore } from '../store/authStore';
import { useCartStore } from '../store/cartStore';
import { db } from '../lib/db';
import { printService } from '../services/print.service';
import { auditService } from '../services/audit.service';
import { getSaleEditLockReason } from '../lib/saleEdit';
import { formatVariantDescription } from '../lib/catalogueDescription';

import { useLocation } from 'react-router-dom';

const GST_RATE = 5;
const GST_INCLUSIVE_FACTOR = 1 + GST_RATE / 100;
const roundCurrency = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const ACTIVE_SALE_SESSION_KEY = 'pos-active-sale-session';

interface ActiveSaleSession {
    saleId: string;
    billNo: string;
    originalSaleData: any;
    originalPaidAmount: number;
    paidAmount: string;
    discountAmount: string;
    paymentMethod: 'CASH' | 'CARD' | 'UPI' | 'SPLIT';
    splitAmounts: { CASH: number; CARD: number; UPI: number };
    customerName: string;
    customerPhone?: string;
    isEditMode: boolean;
    showPayment?: boolean;
    cartItems?: ReturnType<typeof useCartStore.getState>['items'];
}

const persistActiveSaleSession = (session: ActiveSaleSession) => {
    try {
        localStorage.setItem(ACTIVE_SALE_SESSION_KEY, JSON.stringify(session));
    } catch (e) {
        console.error('Failed to persist active sale session', e);
    }
};

const clearActiveSaleSession = () => {
    try {
        localStorage.removeItem(ACTIVE_SALE_SESSION_KEY);
    } catch (e) {
        console.error('Failed to clear active sale session', e);
    }
};

export const POS: React.FC = () => {
    const location = useLocation();
    const leaveWarningMessage = 'Navigating away will close the update option for this saved sale. You can still use refund/exchange later, but you will lose the direct update option now. Continue?';
    const [shopSettings, setShopSettings] = useState<any>(null);

    // Component State
    const [barcode, setBarcode] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [products, setProducts] = useState<any[]>([]);
    const [soldCounts, setSoldCounts] = useState<Map<string, number>>(new Map());
    const [billNo, setBillNo] = useState<string>('...');
    const [paidAmount, setPaidAmount] = useState('');
    const [discountAmount, setDiscountAmount] = useState('');
    const [showPayment, setShowPayment] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [saleSuccess, setSaleSuccess] = useState(false);
    const [printError, setPrintError] = useState(false);
    const [loadingSession, setLoadingSession] = useState(true);
    const [sessionError, setSessionError] = useState('');
    const sessionLoadId = useRef(0);

    // Discount sanity check confirmation modal
    const [showDiscountConfirm, setShowDiscountConfirm] = useState(false);
    const [showNoDiscountConfirm, setShowNoDiscountConfirm] = useState(false);
    const [pendingSalePrint, setPendingSalePrint] = useState(true);

    // Non-blocking notification toast (prevents window.alert app freezing in Electron)
    const [notification, setNotification] = useState<{ id: number; message: string; type: 'error' | 'warning' | 'success' } | null>(null);
    const notificationTimerRef = useRef<NodeJS.Timeout | null>(null);

    const showNotification = useCallback((message: string, type: 'error' | 'warning' | 'success' = 'warning') => {
        if (notificationTimerRef.current) {
            clearTimeout(notificationTimerRef.current);
        }
        setNotification({ id: Date.now(), message, type });
        notificationTimerRef.current = setTimeout(() => {
            setNotification(null);
        }, 3200);
    }, []);

    // Post-Sale Edit State
    const [currentSaleId, setCurrentSaleId] = useState<string | null>(null);
    const [originalPaidAmount, setOriginalPaidAmount] = useState(0);
    const [originalSaleData, setOriginalSaleData] = useState<any>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);

    // Split Payment States
    const [splitAmounts, setSplitAmounts] = useState({ CASH: 0, CARD: 0, UPI: 0 });

    // Which payment methods are enabled (loaded from PAYMENT_METHODS setting)
    const [enabledPaymentMethods, setEnabledPaymentMethods] = useState({
        CASH: true, UPI: true, CARD: true, SPLIT: true
    });

    // Customer Selection State (Walk-in Customer by default, searchable by Name or Phone)
    const [customerName, setCustomerName] = useState('Walk-in Customer');
    const [customerPhone, setCustomerPhone] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [customerSearchInput, setCustomerSearchInput] = useState('Walk-in Customer');
    const [customersList, setCustomersList] = useState<any[]>([]);
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [customerHighlightIndex, setCustomerHighlightIndex] = useState(-1);
    const [showQuickAddModal, setShowQuickAddModal] = useState(false);
    const [quickAddForm, setQuickAddForm] = useState({ name: '', phone: '', gstin: '' });
    const [isSavingCustomer, setIsSavingCustomer] = useState(false);

    const customerInputRef = useRef<HTMLInputElement>(null);
    const customerDropdownRef = useRef<HTMLDivElement>(null);
    const barcodeInputRef = useRef<HTMLInputElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const discountInputRef = useRef<HTMLInputElement>(null);
    const paidAmountInputRef = useRef<HTMLInputElement>(null);

    const user = useAuthStore((state) => state.user);

    const {
        items,
        paymentMethod,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        getSubtotal,
        getGrandTotal,
        setPaymentMethod,
    } = useCartStore();

    useEffect(() => {
        void loadData();
        return () => { sessionLoadId.current++; };
    }, []);

    useEffect(() => {
        return () => {
            if (notificationTimerRef.current) {
                clearTimeout(notificationTimerRef.current);
            }
            // Preserve cart items and active sale session across page navigation.
            // A fresh cart is started only when the cashier explicitly clicks "+ NEW".
        };
    }, []);

    // Auto-sync paidAmount for non-cash payments when discount changes
    // CASH: let it stay (customer may over-pay and receive change)
    // CARD / UPI: customer pays exact final amount, so keep paidAmount in sync
    useEffect(() => {
        if (!showPayment) return;
        if (paymentMethod === 'CASH' || paymentMethod === 'SPLIT') return;
        const discount = parseFloat(discountAmount) || 0;
        const finalTotal = Math.max(0, getGrandTotal() - discount);
        setPaidAmount(finalTotal.toFixed(2));
    }, [discountAmount, paymentMethod, showPayment]);

    // Keyboard focus shortcuts for reliable scanner/search switching.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'F1') {
                e.preventDefault();
                barcodeInputRef.current?.focus();
                barcodeInputRef.current?.select();
            } else if (e.key === 'F3') {
                e.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    // When payment panel closes, return focus to scanner.
    useEffect(() => {
        if (!showPayment) {
            setTimeout(() => barcodeInputRef.current?.focus(), 50);
        }
    }, [showPayment]);

    // Debounce search input for better performance
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 150);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Note: isEditMode and hasChanges are now set in loadData() to avoid race conditions

    // Mark as changed when user modifies anything in edit mode
    const markAsChanged = useCallback(() => {
        if (isEditMode) {
            setHasChanges(true);
        }
    }, [isEditMode]);

    const normalizedEditState = useMemo(() => {
        const normalizeItems = (saleItems: any[] = []) =>
            saleItems
                .map((item: any) => ({
                    variantId: item.variantId || '',
                    productName: item.productName || '',
                    variantInfo: item.variantInfo || '',
                    quantity: Number(item.quantity || 0),
                    mrp: Number(item.mrp || item.sellingPrice || 0),
                    sellingPrice: Number(item.sellingPrice || 0),
                    discount: Number(item.discount || 0),
                    taxRate: Number(item.taxRate || 0),
                }))
                .sort((a: any, b: any) => a.variantId.localeCompare(b.variantId));

        const normalizePayments = (payments: any[] = []) =>
            payments
                .map((payment: any) => ({
                    paymentMode: payment.paymentMode || '',
                    amount: Number(payment.amount || 0),
                }))
                .sort((a: any, b: any) => a.paymentMode.localeCompare(b.paymentMode));

        const currentState = {
            customerName: customerName || 'Walk-in Customer',
            customerPhone: customerPhone || '',
            discount: Number(parseFloat(discountAmount) || 0),
            paymentMethod,
            paidAmount: paymentMethod === 'SPLIT'
                ? Number(Object.values(splitAmounts).reduce((a, b) => a + b, 0))
                : Number(parseFloat(paidAmount) || 0),
            items: normalizeItems(items),
            payments: paymentMethod === 'SPLIT'
                ? normalizePayments(
                    Object.entries(splitAmounts)
                        .filter(([_, amount]) => amount > 0)
                        .map(([mode, amount]) => ({ paymentMode: mode, amount }))
                )
                : normalizePayments([{ paymentMode: paymentMethod, amount: Math.max(0, Number(parseFloat(paidAmount) || 0)) }]),
        };

        const originalState = !originalSaleData ? null : {
            customerName: originalSaleData.customerName || 'Walk-in Customer',
            customerPhone: originalSaleData.customerPhone || '',
            discount: Number(originalSaleData.discount || 0),
            paymentMethod: originalSaleData.paymentMethod || 'CASH',
            paidAmount: Number(originalSaleData.paidAmount || 0),
            items: normalizeItems(originalSaleData.items || []),
            payments: normalizePayments(
                (originalSaleData.paymentMethod === 'SPLIT' && originalSaleData.payments?.length)
                    ? originalSaleData.payments
                    : [{ paymentMode: originalSaleData.paymentMethod || 'CASH', amount: originalSaleData.paidAmount || 0 }]
            ),
        };

        return { currentState, originalState };
    }, [
        originalSaleData,
        items,
        customerName,
        customerPhone,
        discountAmount,
        paidAmount,
        paymentMethod,
        splitAmounts,
    ]);

    const hasDetectedChanges = useMemo(() => {
        if (!isEditMode || !normalizedEditState.originalState) {
            return false;
        }

        return JSON.stringify(normalizedEditState.currentState) !== JSON.stringify(normalizedEditState.originalState);
    }, [isEditMode, normalizedEditState]);

    const hasPostSaveUpdateWindow = useMemo(() => {
        return !!currentSaleId && isEditMode && !!originalSaleData;
    }, [currentSaleId, isEditMode, originalSaleData]);

    const releasePostSaveUpdateWindow = useCallback(() => {
        clearActiveSaleSession();
        clearCart();
        setPaidAmount('');
        setDiscountAmount('');
        setShowPayment(false);
        setCurrentSaleId(null);
        setOriginalPaidAmount(0);
        setCustomerName('Walk-in Customer');
        setCustomerPhone('');
        setSelectedCustomerId(null);
        setCustomerSearchInput('Walk-in Customer');
        setShowCustomerDropdown(false);
        setCustomerHighlightIndex(-1);
        setSaleSuccess(false);
        setPrintError(false);
        setIsEditMode(false);
        setHasChanges(false);
        setOriginalSaleData(null);
        setSplitAmounts({ CASH: 0, CARD: 0, UPI: 0 });
        setShowDiscountConfirm(false);
    }, [clearCart]);

    // Close customer suggestions when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                customerDropdownRef.current &&
                !customerDropdownRef.current.contains(e.target as Node)
            ) {
                setShowCustomerDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!loadingSession && !sessionError && isEditMode && currentSaleId && originalSaleData) {
            persistActiveSaleSession({
                saleId: currentSaleId,
                billNo,
                originalSaleData,
                originalPaidAmount,
                paidAmount,
                discountAmount,
                paymentMethod,
                splitAmounts,
                customerName,
                customerPhone,
                isEditMode: true,
                showPayment,
                cartItems: items,
            });
        }
    }, [
        isEditMode,
        currentSaleId,
        originalSaleData,
        billNo,
        originalPaidAmount,
        paidAmount,
        discountAmount,
        paymentMethod,
        splitAmounts,
        customerName,
        customerPhone,
        showPayment,
        items,
        loadingSession,
        sessionError,
    ]);

    useEffect(() => {
        window.posLeaveGuard = {
            isActive: () => hasDetectedChanges,
            confirmLeave: () => {
                if (hasDetectedChanges) {
                    return window.confirm('You have unsaved changes to this bill. Continue?');
                }
                return true;
            }
        };

        return () => {
            if (window.posLeaveGuard?.confirmLeave) {
                delete window.posLeaveGuard;
            }
        };
    }, [hasDetectedChanges]);

    useEffect(() => {
        if (!hasDetectedChanges) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = 'You have unsaved changes to this bill. Continue?';
            return 'You have unsaved changes to this bill. Continue?';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasDetectedChanges]);

    const loadData = async () => {
        const loadId = ++sessionLoadId.current;
        setLoadingSession(true);
        setSessionError('');
        try {
            const requestedSale = location.state?.sale;
            let session: ActiveSaleSession | null = null;
            const stored = localStorage.getItem(ACTIVE_SALE_SESSION_KEY);
            if (!requestedSale && stored) {
                try { session = JSON.parse(stored); }
                catch { clearActiveSaleSession(); }
            }
            const saleId = requestedSale?.id || session?.saleId;
            if (saleId) {
                // The database decides whether this saved cart may still be edited.
                // Local storage can predate a refund, exchange, void or payment correction.
                const result = await window.electronAPI.sales.getSaleById(saleId);
                if (loadId !== sessionLoadId.current) return;
                if (!result.success || !result.data) throw new Error(result.error || 'Could not check the saved bill.');
                const sale = result.data;
                const lockReason = getSaleEditLockReason(sale);
                if (lockReason) {
                    releasePostSaveUpdateWindow();
                    showNotification(lockReason + ' A new sale is ready.', 'warning');
                    await loadNextBillNo();
                } else {
                    const keepDraft = !!session && !!sale.updatedAt &&
                        new Date(sale.updatedAt).getTime() === new Date(session.originalSaleData?.updatedAt).getTime();
                    const split = { CASH: 0, CARD: 0, UPI: 0 };
                    for (const payment of sale.payments || []) {
                        if (payment.paymentMode in split) split[payment.paymentMode as keyof typeof split] += payment.amount;
                    }
                    // Persisted draft items may intentionally be empty. Never resurrect
                    // cleared items from the invoice merely because the cart is empty.
                    const draftItems = keepDraft ? (session!.cartItems ?? useCartStore.getState().items) : sale.items;
                    clearCart();
                    for (const item of draftItems || []) {
                        addItem({
                            variantId: item.variantId, productName: item.productName,
                            categoryName: item.categoryName,
                            variantInfo: item.variantInfo || '', barcode: item.barcode || '',
                            quantity: item.quantity, mrp: item.mrp ?? item.sellingPrice,
                            sellingPrice: item.sellingPrice, discount: item.discount || 0, taxRate: item.taxRate || 0
                        });
                    }
                    setBillNo(sale.billNo);
                    setCurrentSaleId(sale.id);
                    setOriginalSaleData(sale);
                    setOriginalPaidAmount(sale.paidAmount || 0);
                    setPaidAmount(keepDraft ? session!.paidAmount : String(sale.paidAmount ?? ''));
                    setDiscountAmount(keepDraft ? session!.discountAmount : String(sale.discount ?? ''));
                    setPaymentMethod(keepDraft ? session!.paymentMethod : sale.paymentMethod || 'CASH');
                    setSplitAmounts(keepDraft ? session!.splitAmounts : split);
                    const loadedCustName = keepDraft ? session!.customerName : sale.customerName || 'Walk-in Customer';
                    const loadedCustPhone = keepDraft ? (session!.customerPhone || '') : sale.customerPhone || '';
                    setCustomerName(loadedCustName);
                    setCustomerPhone(loadedCustPhone);
                    setCustomerSearchInput(loadedCustName);
                    setShowPayment(keepDraft ? session!.showPayment ?? true : true);
                    setIsEditMode(true);
                    setHasChanges(false);
                }
            } else {
                if (useCartStore.getState().items.length === 0) {
                    releasePostSaveUpdateWindow();
                }
                setIsEditMode(false);
                setHasChanges(false);
                const pendingCustomer = useCartStore.getState().customerName;
                const pendingPhone = useCartStore.getState().customerPhone;
                const pendingId = useCartStore.getState().customerId;
                if (pendingCustomer) {
                    setCustomerName(pendingCustomer);
                    setCustomerSearchInput(pendingCustomer);
                }
                if (pendingPhone) {
                    setCustomerPhone(pendingPhone);
                }
                if (pendingId) {
                    setSelectedCustomerId(pendingId);
                }
                await loadNextBillNo();
            }
            await loadProducts();
            await loadCustomers();
            await loadShopSettings();
        } catch (error) {
            // Keep the draft, but do not allow edits if its live status is unknown.
            console.error('Failed to restore active sale session', error);
            if (loadId === sessionLoadId.current) setSessionError('Could not verify the current bill. ' + (error as Error).message);
        } finally {
            if (loadId === sessionLoadId.current) setLoadingSession(false);
        }
    };

    const loadShopSettings = async () => {
        // Refresh User Permissions on Mount
        if (user?.id) {
            try {
                const freshUser = await db.users.findUnique({
                    where: { id: user.id },
                    select: {
                        id: true,
                        username: true,
                        name: true,
                        role: true,
                        isActive: true,
                        permPrintSticker: true,
                        permAddItem: true,
                        permDeleteProduct: true,
                        permVoidSale: true,
                        permViewReports: true,
                        permViewSales: true,
                        permViewGstReports: true,
                        permEditSettings: true,
                        permManageProducts: true,
                        permEditSales: true,
                        permManageInventory: true,
                        permManageUsers: true,
                        permViewCostPrice: true,
                        permChangePayment: true,
                        permDeleteAudit: true,
                        permBulkUpdate: true,
                        permBackDateSale: true,
                        permViewInsights: true,
                        maxDiscount: true,
                    }
                });
                if (freshUser) {
                    useAuthStore.getState().login(freshUser);
                }
            } catch (e) {
                console.error("Failed to refresh user permissions", e);
            }
        }

        try {
            const result = await db.settings.findUnique({ where: { key: 'SHOP_SETTINGS' } });
            if (result?.value) {
                setShopSettings(JSON.parse(result.value));
            }
        } catch (error) {
            console.error('Failed to load shop settings:', error);
        }

        try {
            const pmResult = await db.settings.findUnique({ where: { key: 'PAYMENT_METHODS' } });
            if (pmResult?.value) {
                const loaded = JSON.parse(pmResult.value);
                setEnabledPaymentMethods(prev => ({ ...prev, ...loaded }));
                // If the active payment method was disabled in settings, reset to first enabled
                const current = useCartStore.getState().paymentMethod;
                if (loaded[current] === false) {
                    const first = (['CASH', 'UPI', 'CARD', 'SPLIT'] as const).find(m => loaded[m] !== false);
                    if (first) setPaymentMethod(first);
                }
            }
        } catch (error) {
            console.error('Failed to load payment methods setting:', error);
        }
    };

    const loadNextBillNo = async () => {
        try {
            const result = await window.electronAPI.sales.getNextBillNo();
            if (result.success) {
                setBillNo(result.data);
            }
        } catch (error) {
            console.error('Failed to load bill number:', error);
        }
    };

    const loadSalesPopularity = useCallback(async () => {
        try {
            if (typeof db !== 'undefined' && db?.saleItems?.findMany) {
                const saleItems = await db.saleItems.findMany({
                    where: { sale: { status: 'COMPLETED' } },
                    select: { variantId: true, quantity: true }
                });
                if (Array.isArray(saleItems)) {
                    const counts = new Map<string, number>();
                    for (const item of saleItems) {
                        if (item.variantId) {
                            counts.set(item.variantId, (counts.get(item.variantId) || 0) + (item.quantity || 1));
                        }
                    }
                    setSoldCounts(counts);
                }
            }
        } catch (e) {
            console.warn('Could not load sale popularity stats:', e);
        }
    }, []);

    const loadProducts = async () => {
        try {
            if (!window.electronAPI?.catalogue?.listVariants) throw new Error('Catalogue service is unavailable. Restart the app.');
            const result = await window.electronAPI.catalogue.listVariants({
                where: { isActive: true },
                userId: user?.id,
                include: {
                    product: {
                        include: { category: true }
                    }
                },
            });
            if (!result?.success || !Array.isArray(result.data)) throw new Error(result?.error || 'Could not load the catalogue.');
            setProducts(result.data);
            if (typeof loadSalesPopularity === 'function') {
                void loadSalesPopularity();
            }
        } catch (error) {
            console.error('Failed to load products:', error);
            setProducts([]);
            showNotification((error as Error).message || 'Could not load the catalogue.', 'error');
        }
    };

    const loadCustomers = async () => {
        try {
            const result = await db.customers.findMany({
                orderBy: { createdAt: 'desc' }
            });
            if (Array.isArray(result)) {
                setCustomersList(result);
            }
        } catch (error) {
            console.error('Failed to load customers:', error);
        }
    };

    // Filtered customers matching search by name or phone
    const filteredCustomers = useMemo(() => {
        const query = customerSearchInput.trim().toLowerCase();
        if (!query || query === 'walk-in customer') {
            return customersList.slice(0, 15);
        }

        const cleanDigits = query.replace(/\D/g, '');

        return customersList.filter(c => {
            const nameMatch = (c.name || '').toLowerCase().includes(query);
            const phoneStr = (c.phone || '').replace(/\D/g, '');
            const phoneMatch = cleanDigits ? phoneStr.includes(cleanDigits) : false;
            const gstinMatch = (c.gstin || '').toLowerCase().includes(query);
            return nameMatch || phoneMatch || gstinMatch;
        }).slice(0, 20);
    }, [customersList, customerSearchInput]);

    const handleSelectCustomer = (customer: any) => {
        if (!customer) {
            handleResetToWalkIn();
            return;
        }

        const name = customer.name || 'Walk-in Customer';
        const phone = customer.phone || '';
        const id = customer.id || null;

        setCustomerName(name);
        setCustomerPhone(phone);
        setSelectedCustomerId(id);
        setCustomerSearchInput(name);
        setShowCustomerDropdown(false);
        setCustomerHighlightIndex(-1);

        useCartStore.getState().setCustomer(id, name, phone);
        markAsChanged();
        setTimeout(() => barcodeInputRef.current?.focus(), 50);
    };

    const handleResetToWalkIn = () => {
        setCustomerName('Walk-in Customer');
        setCustomerPhone('');
        setSelectedCustomerId(null);
        setCustomerSearchInput('Walk-in Customer');
        setShowCustomerDropdown(false);
        setCustomerHighlightIndex(-1);

        useCartStore.getState().setCustomer(null, 'Walk-in Customer', null);
        markAsChanged();
        setTimeout(() => barcodeInputRef.current?.focus(), 50);
    };

    const handleOpenQuickAdd = (prefill?: string) => {
        const text = (prefill ?? customerSearchInput).trim();
        const isNumeric = /^\+?[\d\s-]+$/.test(text);
        const cleanDigits = text.replace(/\D/g, '');
        const maxDigits = text.startsWith('+') ? 13 : 10;
        const sanitizedPhone = isNumeric ? (text.startsWith('+') ? `+${cleanDigits.slice(0, 13)}` : cleanDigits.slice(0, 10)) : '';

        setQuickAddForm({
            name: isNumeric ? '' : (text.toLowerCase() === 'walk-in customer' ? '' : text.slice(0, 50)),
            phone: sanitizedPhone,
            gstin: ''
        });
        setShowCustomerDropdown(false);
        setShowQuickAddModal(true);
    };

    const handleSaveQuickCustomer = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedPhone = quickAddForm.phone.trim();
        let trimmedName = quickAddForm.name.trim();

        if (!trimmedName && !trimmedPhone) {
            showNotification('Please enter at least a name or phone number', 'warning');
            return;
        }

        if (!trimmedName) {
            trimmedName = trimmedPhone ? `Customer ${trimmedPhone}` : 'Walk-in Customer';
        }

        setIsSavingCustomer(true);
        try {
            const created = await db.customers.create({
                data: {
                    name: trimmedName,
                    phone: trimmedPhone || null,
                    gstin: quickAddForm.gstin.trim() || null,
                }
            });

            if (created) {
                setCustomersList(prev => [created, ...prev]);
                handleSelectCustomer(created);
                setShowQuickAddModal(false);
                showNotification(`Customer "${created.name}" registered and selected!`, 'success');
            }
        } catch (error: any) {
            console.error('Failed to create customer:', error);
            showNotification(error.message || 'Failed to create customer', 'error');
        } finally {
            setIsSavingCustomer(false);
        }
    };

    const handleCustomerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Instant clear: If Backspace or Delete is pressed while holding "Walk-in Customer", clear it completely to empty
        if (
            (e.key === 'Backspace' || e.key === 'Delete') &&
            customerSearchInput.trim().toLowerCase() === 'walk-in customer'
        ) {
            e.preventDefault();
            setCustomerSearchInput('');
            setCustomerName('Walk-in Customer');
            setCustomerPhone('');
            setSelectedCustomerId(null);
            useCartStore.getState().setCustomer(null, 'Walk-in Customer', null);
            setShowCustomerDropdown(true);
            setCustomerHighlightIndex(-1);
            return;
        }

        if (!showCustomerDropdown) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                setShowCustomerDropdown(true);
            }
            return;
        }

        const query = customerSearchInput.trim().toLowerCase();
        const hasAddOption = query && query !== 'walk-in customer';
        const totalItems = 1 + filteredCustomers.length + (hasAddOption ? 1 : 0);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCustomerHighlightIndex(prev => (prev + 1) % totalItems);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCustomerHighlightIndex(prev => (prev <= 0 ? totalItems - 1 : prev - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const trimmed = customerSearchInput.trim();

            if (customerHighlightIndex === 0) {
                handleResetToWalkIn();
            } else if (customerHighlightIndex > 0 && customerHighlightIndex <= filteredCustomers.length) {
                handleSelectCustomer(filteredCustomers[customerHighlightIndex - 1]);
            } else if (hasAddOption && customerHighlightIndex === filteredCustomers.length + 1) {
                handleOpenQuickAdd(customerSearchInput);
            } else {
                // If user didn't arrow down, but filtered suggestions exist, select top match
                if (filteredCustomers.length >= 1) {
                    handleSelectCustomer(filteredCustomers[0]);
                } else if (!trimmed || trimmed.toLowerCase() === 'walk-in customer') {
                    handleResetToWalkIn();
                } else {
                    // Check if input has phone number alone, name alone, or both name and phone
                    const phoneMatch = trimmed.match(/(?:\+?\d[\d\s-]{6,14}\d|\d{7,15})/);
                    const extractedDigits = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : '';
                    const hasValidPhone = extractedDigits.length >= 7 && extractedDigits.length <= 15;
                    const extractedName = hasValidPhone
                        ? trimmed.replace(phoneMatch![0], '').replace(/^[-–—,:|/]+|[-–—,:|/]+$/g, '').trim()
                        : trimmed;

                    const finalPhone = hasValidPhone ? extractedDigits : '';
                    const finalName = extractedName || (hasValidPhone ? `Customer ${extractedDigits}` : 'Walk-in Customer');

                    setCustomerName(finalName);
                    setCustomerPhone(finalPhone);
                    setCustomerSearchInput(finalName);
                    markAsChanged();
                    setShowCustomerDropdown(false);

                    // Auto-register immediately into db.customers so it is saved in the Customer directory page
                    (async () => {
                        try {
                            if (finalPhone) {
                                const existing = await db.customers.findUnique({ where: { phone: finalPhone } });
                                if (!existing) {
                                    const created = await db.customers.create({
                                        data: { name: finalName, phone: finalPhone }
                                    });
                                    if (created) {
                                        setCustomersList(prev => [created, ...prev]);
                                        setSelectedCustomerId(created.id);
                                        useCartStore.getState().setCustomer(created.id, finalName, finalPhone);
                                    }
                                } else {
                                    setSelectedCustomerId(existing.id);
                                    useCartStore.getState().setCustomer(existing.id, existing.name, finalPhone);
                                }
                            } else if (finalName && finalName.toLowerCase() !== 'walk-in customer') {
                                const existing = (await db.customers.findMany({ where: { name: finalName }, take: 1 }))[0];
                                if (!existing) {
                                    const created = await db.customers.create({
                                        data: { name: finalName, phone: null }
                                    });
                                    if (created) {
                                        setCustomersList(prev => [created, ...prev]);
                                        setSelectedCustomerId(created.id);
                                        useCartStore.getState().setCustomer(created.id, finalName, null);
                                    }
                                } else {
                                    setSelectedCustomerId(existing.id);
                                    useCartStore.getState().setCustomer(existing.id, existing.name, existing.phone);
                                }
                            }
                        } catch (err) {
                            console.warn('Auto-save customer to directory failed:', err);
                            useCartStore.getState().setCustomer(null, finalName, finalPhone || null);
                        }
                    })();

                    setTimeout(() => barcodeInputRef.current?.focus(), 50);
                }
            }
        } else if (e.key === 'Escape') {
            setShowCustomerDropdown(false);
        }
    };

    // Create barcode lookup map for O(1) performance
    const barcodeMap = useMemo(() => {
        const map = new Map();
        products.forEach(p => {
            if (p.barcode) map.set(p.barcode, p);
            if (p.sku) map.set(p.sku, p);
        });
        return map;
    }, [products]);

    const handleBarcodeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // If barcode is empty and we have items, go to checkout
        if (!barcode.trim()) {
            if (items.length > 0) {
                handleCheckout();
            }
            return;
        }

        try {
            const trimmedBarcode = barcode.trim();
            const variant = barcodeMap.get(trimmedBarcode);

            if (variant) {
                if (variant.isPrepared) {
                    showNotification('Stock conversion pending for this item. Cannot be sold until converted.', 'warning');
                    setBarcode('');
                    setTimeout(() => barcodeInputRef.current?.focus(), 20);
                    return;
                }
                if (user?.role !== 'ADMIN' && !user?.permAddItem) {
                    showNotification('Permission Denied: You are not allowed to add items to sales.', 'warning');
                    return;
                }
                addItem({
                    variantId: variant.id,
                    productName: formatVariantDescription(variant.product?.name || 'Unknown Item', variant),
                    categoryName: variant.product?.category?.name || '',
                    variantInfo: '',
                    barcode: variant.barcode,
                    quantity: 1,
                    mrp: variant.mrp,
                    sellingPrice: variant.sellingPrice,
                    discount: 0,
                    taxRate: variant.product?.taxRate || 0,
                });
                markAsChanged();
                setBarcode('');
                setTimeout(() => barcodeInputRef.current?.focus(), 20);
            } else {
                showNotification(`Product not found! Scanned: "${trimmedBarcode}"`, 'error');
                setBarcode('');
                setTimeout(() => barcodeInputRef.current?.focus(), 20);
            }
        } catch (error) {
            console.error('Error adding product:', error);
            showNotification('Error adding product to sale.', 'error');
            setTimeout(() => barcodeInputRef.current?.focus(), 20);
        }
    };

    const handleProductClick = (variant: any) => {
        if (variant.isPrepared) {
            showNotification('Stock conversion pending for this item. Cannot be sold until converted.', 'warning');
            return;
        }
        if (user?.role !== 'ADMIN' && !user?.permAddItem) {
            showNotification('Permission Denied: You are not allowed to add items to sales.', 'warning');
            return;
        }
        addItem({
            variantId: variant.id,
            productName: formatVariantDescription(variant.product.name, variant),
            categoryName: variant.product?.category?.name || '',
            variantInfo: '',
            barcode: variant.barcode,
            quantity: 1,
            mrp: variant.mrp,
            sellingPrice: variant.sellingPrice,
            discount: 0,
            taxRate: variant.product.taxRate,
        });
        markAsChanged();
        setTimeout(() => barcodeInputRef.current?.focus(), 20);
    };

    const handleCheckout = () => {
        if (items.length === 0) {
            showNotification('Cart is empty!', 'warning');
            return;
        }
        
        // Validate discount doesn't exceed total
        const discountValue = parseFloat(discountAmount) || 0;
        const total = getGrandTotal();
        
        if (discountValue > total) {
            showNotification(
                `Invalid discount! Discount (₹${discountValue.toFixed(2)}) cannot exceed bill total (₹${total.toFixed(2)}).`,
                'error'
            );
            discountInputRef.current?.focus();
            return;
        }
        
        setPaidAmount(getGrandTotal().toFixed(2));
        setDiscountAmount('');
        setShowPayment(true);
        // Focus Discount for everyone
        setTimeout(() => {
            discountInputRef.current?.focus();
        }, 100);
    };

    // Calculate Totals helper
    const calculateTotals = () => {
        const subtotal = roundCurrency(getSubtotal());
        const discount = roundCurrency(parseFloat(discountAmount) || 0);
        const finalTotal = roundCurrency(Math.max(0, subtotal - discount));
        const taxable = roundCurrency(finalTotal / GST_INCLUSIVE_FACTOR);
        const tax = roundCurrency(finalTotal - taxable);

        const paid = paymentMethod === 'SPLIT'
            ? roundCurrency(Object.values(splitAmounts).reduce((a, b) => a + b, 0))
            : roundCurrency(parseFloat(paidAmount) || 0);

        const change = roundCurrency(paid - finalTotal);
        const balanceDue = roundCurrency(finalTotal - originalPaidAmount);

        return { subtotal, taxable, tax, discount, finalTotal, paid, change, balanceDue };
    };


    // const handlePrintDraft = async () => {
    //     const { subtotal, tax, discount, finalTotal, paid, change } = calculateTotals();

    //     try {
    //         // Prepare Receipt Data (Mock Sale Object)
    //         const receiptData = {
    //             billNo: 'DRAFT', // Indicator
    //             date: new Date(),
    //             shopName: 'ZAIN GENTS PALACE',
    //             shopAddress: 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR',
    //             shopPhone: '9037106449, 7907026827',
    //             gstin: '32PVGPS0686J1ZV',
    //             customerName: customerName || 'Walk-in Customer (Draft)',
    //             items: items.map((item: any) => ({
    //                 name: item.productName,
    //                 variantInfo: item.variantInfo,
    //                 quantity: item.quantity,
    //                 mrp: item.mrp,
    //                 rate: item.sellingPrice,
    //                 total: item.sellingPrice * item.quantity - item.discount,
    //             })),
    //             subtotal,
    //             discount, // Global discount
    //             cgst: tax / 2,
    //             sgst: tax / 2,
    //             grandTotal: finalTotal,
    //             paymentMethod: 'CASH',
    //             paidAmount: paid,
    //             changeAmount: change,
    //             userName: user!.name,
    //         };

    //         await printService.printReceipt(receiptData);
    //     } catch (error) {
    //         console.error("Draft print failed", error);
    //         alert("Draft print failed");
    //     }
    // };

    const handleNewSale = () => {
        clearActiveSaleSession();
        clearCart();
        setPaidAmount('');
        setDiscountAmount('');
        setShowPayment(false);
        setCurrentSaleId(null);
        setOriginalPaidAmount(0);
        setCustomerName('Walk-in Customer');
        setCustomerPhone('');
        setSelectedCustomerId(null);
        setCustomerSearchInput('Walk-in Customer');
        setShowCustomerDropdown(false);
        setCustomerHighlightIndex(-1);
        setSaleSuccess(false);
        setPrintError(false);
        setIsEditMode(false);
        setHasChanges(false);
        setOriginalSaleData(null);
        setShowDiscountConfirm(false);
        loadNextBillNo();
        loadProducts(); // Refresh stock
        // Focus barcode
        setTimeout(() => barcodeInputRef.current?.focus(), 100);
    };

    const handleCompleteSale = async (shouldPrint = true) => {
        if (items.length === 0) return;

        const { tax, discount, finalTotal, paid, change } = calculateTotals();

        // Validate split payment amounts sum to total
        if (paymentMethod === 'SPLIT') {
            const splitTotal = Object.values(splitAmounts).reduce((a, b) => a + b, 0);
            const difference = Math.abs(splitTotal - finalTotal);
            
            if (difference > 0.01) {  // Allow 1 paisa rounding difference
                showNotification(
                    `Split payment error: Split Total (₹${splitTotal.toFixed(2)}) does not match Bill Total (₹${finalTotal.toFixed(2)}). Difference: ₹${difference.toFixed(2)}`,
                    'error'
                );
                return;
            }
        }

        // Permission: Max Discount Check (percentage-based)
        const subtotalForCheck = getSubtotal();
        const discountPercent = subtotalForCheck > 0 ? roundCurrency((discount / subtotalForCheck) * 100) : 0;
        const maxDiscountPercent = user?.maxDiscount || 0; // now stored as percentage

        if (user?.role !== 'ADMIN' && discountPercent > maxDiscountPercent) {
            const maxAllowedAmount = roundCurrency((subtotalForCheck * maxDiscountPercent) / 100);
            if (maxDiscountPercent === 0) {
                showNotification(
                    'Permission Denied: You do not have permission to apply discounts to bills.',
                    'warning'
                );
            } else {
                showNotification(
                    `Permission Denied: Your max discount is ${maxDiscountPercent}% (₹${maxAllowedAmount.toFixed(0)} on this bill). You tried ${discountPercent.toFixed(1)}% (₹${discount.toFixed(0)}).`,
                    'warning'
                );
            }
            return;
        }

        // Sanity check: warn for high discounts (>10% of bill) — requires explicit confirmation
        const SANITY_THRESHOLD = 10; // percentage
        if (discountPercent > SANITY_THRESHOLD && !showDiscountConfirm) {
            setPendingSalePrint(shouldPrint);
            setShowDiscountConfirm(true);
            return;
        }
        // If we get here from the confirmation modal, close it
        setShowDiscountConfirm(false);

        // Warn if discount is zero — requires explicit confirmation
        if (discount <= 0 && !showNoDiscountConfirm) {
            setPendingSalePrint(shouldPrint);
            setShowNoDiscountConfirm(true);
            return;
        }
        setShowNoDiscountConfirm(false);

        if (paid < finalTotal) {
            showNotification('Paid amount is less than total!', 'warning');
            return;
        }

        setProcessing(true);

        try {
            const subtotal = roundCurrency(getSubtotal());
            const cgst = roundCurrency(tax / 2);
            const sgst = roundCurrency(tax / 2);

            if (currentSaleId) {
                // If Sale ID is present, we are in UPDATE mode
                // Step 1: Check Permissions
                if (user?.role !== 'ADMIN' && !user?.permEditSales) {
                    showNotification("Unauthorized: You do not have permission to edit finalized invoices.", 'warning');
                    setProcessing(false);
                    return;
                }

                // Step 2: Prepare full sale update data (items + totals + payments)
                const saleUpdateData = {
                    customerName: customerName || 'Walk-in Customer',
                    customerPhone: customerPhone || null,
                    subtotal,
                    discount,
                    taxAmount: tax,
                    cgst,
                    sgst,
                    grandTotal: finalTotal,
                    paymentMethod: paymentMethod === 'SPLIT' ? 'SPLIT' : paymentMethod,
                    paidAmount: paymentMethod === 'SPLIT'
                        ? Object.values(splitAmounts).reduce((a, b) => a + b, 0)
                        : paid,
                    changeAmount: change,
                    items: items.map((item: any) => ({
                        variantId: item.variantId,
                        productName: item.productName,
                        categoryName: item.categoryName,
                        variantInfo: item.variantInfo,
                        quantity: item.quantity,
                        mrp: item.mrp,
                        sellingPrice: item.sellingPrice,
                        discount: item.discount,
                        taxRate: item.taxRate,
                        taxAmount: roundCurrency(((item.sellingPrice * item.quantity - item.discount) * item.taxRate) / (100 + item.taxRate)),
                        total: roundCurrency(item.sellingPrice * item.quantity - item.discount),
                    })),
                    payments: paymentMethod === 'SPLIT'
                        ? Object.entries(splitAmounts)
                            .filter(([_, amt]) => amt > 0)
                            .map(([mode, amt]) => ({ paymentMode: mode, amount: amt }))
                        : [{
                            paymentMode: paymentMethod,
                            amount: finalTotal
                        }]
                };

                // NOTE: Change detection is now handled by useEffect and button disable state
                // No need to validate here - button is already disabled if no changes

                const updateResult = await (window.electronAPI as any).sales.updateSale({
                    saleId: currentSaleId,
                    saleData: saleUpdateData,
                    userId: user!.id
                });

                if (updateResult.success) {
                    const sale = updateResult.data;
                    setCurrentSaleId(sale.id);
                    setOriginalSaleData(sale);
                    setOriginalPaidAmount(sale.paidAmount || 0);
                    setIsEditMode(true);
                    setHasChanges(false);
                    persistActiveSaleSession({
                        saleId: sale.id,
                        billNo: sale.billNo,
                        originalSaleData: sale,
                        originalPaidAmount: sale.paidAmount || 0,
                        paidAmount: (sale.paidAmount ?? '').toString(),
                        discountAmount: (sale.discount ?? '').toString(),
                        paymentMethod: sale.paymentMethod || 'CASH',
                        splitAmounts: paymentMethod === 'SPLIT' ? splitAmounts : { CASH: 0, CARD: 0, UPI: 0 },
                        customerName: sale.customerName || 'Walk-in Customer',
                        customerPhone: sale.customerPhone || customerPhone || '',
                        isEditMode: true,
                        showPayment: true,
                    });
                    if (shouldPrint) {
                        await printReceipt(sale);
                    }
                    setSaleSuccess(true);
                    setTimeout(() => setSaleSuccess(false), 2500);
                    setProcessing(false);
                    return;
                } else {
                    throw new Error(updateResult.error);
                }
            }

            // Prepare Checkout Data (New Sale)
            const checkoutData = {
                billNo,
                userId: user!.id,
                customerName: customerName || 'Walk-in Customer',
                customerPhone: customerPhone || null,
                subtotal,
                discount,
                taxAmount: tax,
                cgst,
                sgst,
                grandTotal: finalTotal,
                paymentMethod: paymentMethod === 'SPLIT' ? 'SPLIT' : paymentMethod,
                paidAmount: paymentMethod === 'SPLIT'
                    ? Object.values(splitAmounts).reduce((a, b) => a + b, 0)
                    : paid,
                changeAmount: change,
                items: items.map((item: any) => ({
                    variantId: item.variantId,
                    productName: item.productName,
                    variantInfo: item.variantInfo,
                    quantity: item.quantity,
                    mrp: item.mrp,
                    sellingPrice: item.sellingPrice,
                    discount: item.discount,
                    taxRate: item.taxRate,
                    taxAmount: roundCurrency(((item.sellingPrice * item.quantity - item.discount) * item.taxRate) / (100 + item.taxRate)),
                    total: roundCurrency(item.sellingPrice * item.quantity - item.discount),
                })),
                payments: paymentMethod === 'SPLIT'
                    ? Object.entries(splitAmounts)
                        .filter(([_, amt]) => amt > 0)
                        .map(([mode, amt]) => ({ paymentMode: mode, amount: amt }))
                    : [{
                        paymentMode: paymentMethod,
                        amount: finalTotal
                    }]
            };

            const result = await window.electronAPI.sales.checkout(checkoutData);

            if (result.success) {
                const sale = result.data;
                setBillNo(sale.billNo); // Sync with server-assigned bill number
                setCurrentSaleId(sale.id);
                setOriginalSaleData(sale);
                setOriginalPaidAmount(sale.paidAmount || 0);
                setIsEditMode(true);
                setHasChanges(false);
                persistActiveSaleSession({
                    saleId: sale.id,
                    billNo: sale.billNo,
                    originalSaleData: sale,
                    originalPaidAmount: sale.paidAmount || 0,
                    paidAmount: (sale.paidAmount ?? '').toString(),
                    discountAmount: (sale.discount ?? '').toString(),
                    paymentMethod: sale.paymentMethod || 'CASH',
                    splitAmounts: paymentMethod === 'SPLIT' ? splitAmounts : { CASH: 0, CARD: 0, UPI: 0 },
                    customerName: sale.customerName || 'Walk-in Customer',
                    customerPhone: sale.customerPhone || customerPhone || '',
                    isEditMode: true,
                    showPayment: true,
                });
                // Print receipt
                if (shouldPrint) {
                    await printReceipt(sale);
                }

                setSaleSuccess(true);
                setTimeout(() => setSaleSuccess(false), 2500);
                if (typeof loadSalesPopularity === 'function') {
                    void loadSalesPopularity();
                }
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            console.error('Failed to complete sale:', error);
            showNotification(`Failed to complete sale: ${error.message || error}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    const printReceipt = async (sale: any) => {
        try {
            // Detect replacement bill and extract exchange credit
            const isReplBill = sale.paymentMethod === 'EXCHANGE' || (sale.remarks || '').includes('Replacement sale for Invoice');
            const exchCreditPmt = (sale.payments || []).find((p: any) => p.paymentMode === 'EXCHANGE_CREDIT');
            const exchCreditAmt = exchCreditPmt ? Number(exchCreditPmt.amount || 0) : 0;
            const origBillMatch = sale.remarks?.match(/Invoice #(\d+)/);
            const origBillNo = origBillMatch?.[1] || '';

            const receiptData = {
                billNo: sale.billNo,
                date: new Date(sale.createdAt),
                shopName: shopSettings?.shopName || 'ZAIN GENTS PALACE',
                shopAddress: shopSettings?.address || 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR',
                shopPhone: shopSettings?.phone || '9037106449, 7907026827',
                gstin: shopSettings?.gstin || '32PVGPS0686J1ZV',
                logo: shopSettings?.logo,
                customerName: sale.customerName || customerName,
                customerPhone: sale.customerPhone || customerPhone || undefined,
                items: sale.items.map((item: any) => ({
                    variantId: item.variantId,
                    name: item.productName,
                    variantInfo: item.variantInfo,
                    quantity: item.quantity,
                    mrp: item.mrp || 0,
                    rate: item.sellingPrice,
                    discount: item.discount || 0,
                    taxRate: item.taxRate || 0,
                    total: item.total || 0,
                })),
                subtotal: sale.subtotal,
                discount: sale.discount,
                cgst: sale.cgst,
                sgst: sale.sgst,
                grandTotal: sale.grandTotal,
                paymentMethod: sale.paymentMethod,
                paidAmount: sale.paidAmount,
                changeAmount: sale.changeAmount,
                payments: (sale.payments || []).map((p: any) => ({
                    paymentMode: p.paymentMode,
                    amount: Number(p.amount || 0),
                })),
                userName: user?.name || 'Staff',
                // Exchange/replacement bill fields
                isReplacementBill: isReplBill && exchCreditAmt > 0,
                originalBillNo: origBillNo,
                exchangeCreditAmount: exchCreditAmt,
            };

            await printService.printReceipt(receiptData);
        } catch (error) {
            console.error('Failed to print receipt:', error);
            showToast(error instanceof Error ? error.message : 'Receipt printing failed. Your sale remains saved.', 'error');
            setPrintError(true);
            setTimeout(() => setPrintError(false), 5000);
        }
    };

    // Fast category lookup map by variant ID
    const categoryMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const p of products) {
            if (p.id && p.product?.category?.name) {
                map.set(p.id, p.product.category.name);
            }
        }
        return map;
    }, [products]);

    // Memoized filtered products ranked by sales popularity (most sold items first)
    const filteredProducts = useMemo(() => {
        let list = products;

        if (debouncedSearch) {
            const rawTrimmed = debouncedSearch.trim().toLowerCase();
            const tokens = rawTrimmed.split(/\s+/).filter(Boolean);
            const compactQuery = rawTrimmed.replace(/[\s\-_]+/g, '');

            list = products.filter((p) => {
                const name = p.product?.name || '';
                const barcode = p.barcode || '';
                const sku = p.sku || '';
                const category = p.product?.category?.name || '';
                const size = p.size || '';
                const color = p.color || '';
                const price = p.sellingPrice != null ? String(p.sellingPrice) : '';
                const mrp = p.mrp != null ? String(p.mrp) : '';

                const description = formatVariantDescription(name, p);
                const searchTarget = `${description} ${barcode} ${sku} ${category} ${size} ${color} ${price} ${mrp}`.toLowerCase();

                // 1. Order-independent matching: every word entered must match somewhere in the product attributes
                if (tokens.every((token) => searchTarget.includes(token))) {
                    return true;
                }

                // 2. Compact matching fallback: allows typing without spaces or hyphens (e.g. "shirt700" or "ts01")
                if (compactQuery) {
                    const compactTarget = searchTarget.replace(/[\s\-_]+/g, '');
                    if (compactTarget.includes(compactQuery)) {
                        return true;
                    }
                }

                return false;
            });
        }

        // Sort by sales popularity (most sold items first)
        return [...list].sort((a, b) => {
            // Conversion pending items always go to the bottom
            if (Boolean(a.isPrepared) !== Boolean(b.isPrepared)) {
                return a.isPrepared ? 1 : -1;
            }

            // 1. Sort by sales velocity (sold count desc) — top sold items ALWAYS come first!
            const aSold = soldCounts.get(a.id) || 0;
            const bSold = soldCounts.get(b.id) || 0;
            if (aSold !== bSold) {
                return bSold - aSold;
            }

            // 2. For items with equal sales (e.g. 0 sales), prioritize in-stock over out-of-stock
            const aInStock = (a.stock || 0) > 0;
            const bInStock = (b.stock || 0) > 0;
            if (aInStock !== bInStock) {
                return aInStock ? -1 : 1;
            }

            // 3. Tie breaker: higher stock first, then name
            if ((b.stock || 0) !== (a.stock || 0)) {
                return (b.stock || 0) - (a.stock || 0);
            }
            return (a.product?.name || '').localeCompare(b.product?.name || '');
        });
    }, [products, debouncedSearch, soldCounts]);

    const visibleProducts = useMemo(() => filteredProducts.slice(0, 200), [filteredProducts]);

    // Display helpers for Footer
    // Display helpers for Footer
    const { subtotal, tax, finalTotal, change } = calculateTotals();

    if (loadingSession || sessionError) {
        return <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
            <p role="status">{loadingSession ? 'Checking the current bill…' : sessionError}</p>
            {!loadingSession && <Button onClick={() => void loadData()}>Retry loading bill</Button>}
        </div>;
    }

    return (
        <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 relative" >
            {/* Non-blocking notification toast (prevents window.alert app freezing in Electron) */}
            {notification && (
                <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[70] pointer-events-auto transition-all animate-in fade-in slide-in-from-top-3 duration-200">
                    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-2xl border text-xs sm:text-sm font-semibold max-w-lg ${
                        notification.type === 'error'
                            ? 'bg-red-600 text-white border-red-700 shadow-red-500/30 ring-2 ring-red-400/30'
                            : notification.type === 'success'
                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-emerald-500/30 ring-2 ring-emerald-400/30'
                            : 'bg-amber-500 text-white border-amber-600 shadow-amber-500/30 ring-2 ring-amber-400/30'
                    }`}>
                        {notification.type === 'error' && <AlertCircle className="w-5 h-5 flex-shrink-0 animate-pulse" />}
                        {notification.type === 'warning' && <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
                        {notification.type === 'success' && <CheckCircle className="w-5 h-5 flex-shrink-0" />}
                        <span className="leading-snug">{notification.message}</span>
                        <button
                            type="button"
                            onClick={() => setNotification(null)}
                            className="p-1 hover:bg-white/20 rounded-lg transition-colors ml-1 text-white/80 hover:text-white"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            )}
            {/* High Discount Sanity Check Confirmation Modal */}
            {showDiscountConfirm && (() => {
                const discVal = parseFloat(discountAmount) || 0;
                const billTotal = getSubtotal();
                const discPct = billTotal > 0 ? roundCurrency((discVal / billTotal) * 100) : 0;
                const netPayable = roundCurrency(Math.max(0, billTotal - discVal));
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
                            {/* Header */}
                            <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-5 py-4 flex items-center gap-3">
                                <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-full">
                                    <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white text-base">High Discount Warning</h3>
                                    <p className="text-xs text-amber-700 dark:text-amber-400">This discount exceeds 10% of the bill total</p>
                                </div>
                            </div>

                            {/* Body */}
                            <div className="px-5 py-4 space-y-3">
                                <div className="flex justify-between items-center bg-red-50 dark:bg-red-900/20 rounded-lg p-3 border border-red-200 dark:border-red-800">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Discount</span>
                                    <span className="font-black text-red-600 dark:text-red-400 text-lg">₹{discVal.toFixed(0)} ({discPct.toFixed(1)}%)</span>
                                </div>

                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                                    <div className="text-xs font-bold uppercase text-gray-400 mb-2">Bill Breakdown</div>
                                    <div className="space-y-1 max-h-32 overflow-y-auto">
                                        {items.map((item: any, i: number) => (
                                            <div key={item.variantId} className="flex justify-between text-sm">
                                                <span className="text-gray-600 dark:text-gray-400 truncate mr-2">
                                                    {item.productName} {item.variantInfo && <span className="text-gray-400">({item.variantInfo})</span>} × {item.quantity}
                                                </span>
                                                <span className="font-mono font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">₹{(item.sellingPrice * item.quantity).toFixed(0)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2 flex justify-between">
                                        <span className="text-xs font-bold text-gray-500 uppercase">Bill Total</span>
                                        <span className="font-bold text-gray-800 dark:text-gray-200">₹{billTotal.toFixed(2)}</span>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Net Payable After Discount</span>
                                    <span className="font-black text-green-600 dark:text-green-400 text-lg">₹{netPayable.toFixed(0)}</span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
                                <button
                                    onClick={() => setShowDiscountConfirm(false)}
                                    className="flex-1 px-4 py-2.5 rounded-lg border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-bold text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => handleCompleteSale(pendingSalePrint)}
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-md transition-all active:scale-[0.98]"
                                >
                                    Yes, Apply ₹{discVal.toFixed(0)} Discount
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
            {showNoDiscountConfirm && (() => {
                const billTotal = getSubtotal();
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
                            <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-5 py-4 flex items-center gap-3">
                                <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-full">
                                    <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white text-base">No Discount Applied</h3>
                                    <p className="text-xs text-amber-700 dark:text-amber-400">Bill total: ₹{billTotal.toFixed(0)}</p>
                                </div>
                            </div>
                            <div className="px-5 py-4">
                                <p className="text-sm text-gray-600 dark:text-gray-400">You're about to finalize this sale <strong>without any discount</strong>. Are you sure?</p>
                            </div>
                            <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
                                <button
                                    onClick={() => setShowNoDiscountConfirm(false)}
                                    className="flex-1 px-4 py-2.5 rounded-lg border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-bold text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
                                >
                                    Go Back
                                </button>
                                <button
                                    onClick={() => handleCompleteSale(pendingSalePrint)}
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-md transition-all active:scale-[0.98]"
                                >
                                    Yes, No Discount
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
            {/* 1. TOP HEADER: Invoice Details */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center text-sm shadow-sm">
                {/* Left: invoice fields — fills remaining space */}
                <div className="flex items-center gap-2 flex-1 min-w-0 p-2">
                    <div className="flex flex-col flex-shrink-0">
                        <label className="text-gray-500 font-bold text-xs uppercase">Bill No</label>
                        <div className="font-mono font-bold text-lg bg-gray-100 dark:bg-gray-900 px-2 py-1 rounded border border-gray-300">
                            {billNo}
                        </div>
                    </div>
                    <div className="flex flex-col flex-shrink-0">
                        <label className="text-gray-500 font-bold text-xs uppercase">Invoice Date</label>
                        <div className="font-mono text-sm bg-gray-100 dark:bg-gray-900 px-2 py-1 rounded border border-gray-300 text-gray-500">
                            {new Date().toLocaleDateString('en-GB')}
                        </div>
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 relative" ref={customerDropdownRef}>
                        <div className="flex items-center justify-between">
                            <label className="text-gray-500 font-bold text-xs uppercase flex items-center gap-1.5 truncate">
                                <span>Customer</span>
                                {customerPhone && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800">
                                        <Phone className="w-2.5 h-2.5" />
                                        {customerPhone}
                                    </span>
                                )}
                            </label>
                            <button
                                type="button"
                                onClick={() => handleOpenQuickAdd()}
                                className="text-[11px] font-bold text-primary-600 hover:text-primary-700 dark:text-primary-400 flex items-center gap-0.5 hover:underline flex-shrink-0"
                                title="Register new customer"
                            >
                                <UserPlus className="w-3 h-3" />
                                <span>+ New</span>
                            </button>
                        </div>

                        <div className="relative mt-0.5">
                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
                                <User className="w-4 h-4" />
                            </div>
                            <input
                                ref={customerInputRef}
                                type="text"
                                value={customerSearchInput}
                                onClick={(e) => {
                                    if (customerSearchInput.trim().toLowerCase() === 'walk-in customer') {
                                        e.currentTarget.select();
                                    }
                                    setShowCustomerDropdown(true);
                                }}
                                onChange={(e) => {
                                    let val = e.target.value;

                                    // Smart length guard:
                                    // If input is purely numeric or phone characters (+, space, hyphen)
                                    const isNumericInput = /^[\d\s+-]+$/.test(val);
                                    if (isNumericInput) {
                                        const cleanDigits = val.replace(/\D/g, '');
                                        const maxDigits = val.startsWith('+') ? 13 : 10;
                                        if (cleanDigits.length > maxDigits) {
                                            // Enforce hard cap of 10 digits (or 13 if starting with +)
                                            val = val.startsWith('+') ? `+${cleanDigits.slice(0, 13)}` : cleanDigits.slice(0, 10);
                                        }
                                    } else {
                                        // Customer name: cap at 50 characters
                                        if (val.length > 50) {
                                            val = val.slice(0, 50);
                                        }
                                    }

                                    setCustomerSearchInput(val);
                                    if (!val) {
                                        setCustomerName('Walk-in Customer');
                                        setCustomerPhone('');
                                        setSelectedCustomerId(null);
                                        useCartStore.getState().setCustomer(null, 'Walk-in Customer', null);
                                    }
                                    setShowCustomerDropdown(true);
                                    setCustomerHighlightIndex(-1);
                                    markAsChanged();
                                }}
                                onFocus={(e) => {
                                    e.target.select();
                                    setShowCustomerDropdown(true);
                                }}
                                onKeyDown={handleCustomerKeyDown}
                                placeholder="Type Name or Phone number..."
                                maxLength={50}
                                className="w-full h-9 pl-8 pr-16 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all shadow-sm"
                            />

                            {/* Right side actions inside input */}
                            <div className="absolute inset-y-0 right-0 pr-1.5 flex items-center gap-1">
                                {(customerName !== 'Walk-in Customer' || customerPhone || selectedCustomerId) && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleResetToWalkIn();
                                        }}
                                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 rounded transition-colors"
                                        title="Reset to Walk-in Customer"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setShowCustomerDropdown(prev => !prev)}
                                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 rounded transition-colors"
                                    title="Toggle suggestions"
                                >
                                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showCustomerDropdown ? 'rotate-180' : ''}`} />
                                </button>
                            </div>
                        </div>

                        {/* Autocomplete Dropdown */}
                        {showCustomerDropdown && (
                            <div
                                className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-80 flex flex-col"
                                style={{ minWidth: '320px' }}
                            >
                                <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between text-[11px] text-gray-500">
                                    <span className="font-semibold uppercase tracking-wider text-[10px]">Select Customer</span>
                                    <span className="text-[10px] text-gray-400">↑↓ to navigate · ↵ to select</span>
                                </div>

                                <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-800">
                                    {/* Walk-in Customer Option */}
                                    <button
                                        type="button"
                                        onClick={() => handleResetToWalkIn()}
                                        onMouseEnter={() => setCustomerHighlightIndex(0)}
                                        className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                                            customerHighlightIndex === 0
                                                ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300'
                                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-sm flex-shrink-0">
                                                🚶
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="font-semibold text-sm leading-tight flex items-center gap-1.5">
                                                    Walk-in Customer
                                                    <span className="text-[10px] font-normal px-1.5 py-0.2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">Default</span>
                                                </span>
                                                <span className="text-xs text-gray-400">Regular walk-in retail sales</span>
                                            </div>
                                        </div>
                                        {customerName === 'Walk-in Customer' && !customerPhone && (
                                            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                                        )}
                                    </button>

                                    {/* Registered Customers */}
                                    {filteredCustomers.length > 0 ? (
                                        filteredCustomers.map((customer, index) => {
                                            const isHighlighted = customerHighlightIndex === index + 1;
                                            const isSelected = selectedCustomerId === customer.id || (customerName.toLowerCase() === customer.name.toLowerCase() && customerPhone === (customer.phone || ''));

                                            return (
                                                <button
                                                    key={customer.id}
                                                    type="button"
                                                    onClick={() => handleSelectCustomer(customer)}
                                                    onMouseEnter={() => setCustomerHighlightIndex(index + 1)}
                                                    className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                                                        isHighlighted
                                                            ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300'
                                                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-primary-600 to-indigo-500 text-white font-bold text-xs flex items-center justify-center flex-shrink-0 shadow-sm">
                                                            {(customer.name || 'C').charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <div className="font-semibold text-sm leading-tight truncate flex items-center gap-1.5">
                                                                <span>{customer.name}</span>
                                                                {customer.gstin && (
                                                                    <span className="text-[9px] font-mono px-1 py-0.2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded border border-blue-200 dark:border-blue-800">
                                                                        GST
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 font-mono">
                                                                {customer.phone ? (
                                                                    <>
                                                                        <Phone className="w-3 h-3 text-gray-400" />
                                                                        <span>{customer.phone}</span>
                                                                    </>
                                                                ) : (
                                                                    <span className="text-gray-400 italic">No phone registered</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {isSelected && (
                                                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                                                    )}
                                                </button>
                                            );
                                        })
                                    ) : (
                                        customerSearchInput.trim() && customerSearchInput.trim().toLowerCase() !== 'walk-in customer' && (
                                            <div className="px-4 py-3 text-center text-xs text-gray-500">
                                                No existing customers matching "<span className="font-semibold text-gray-700 dark:text-gray-300">{customerSearchInput}</span>"
                                            </div>
                                        )
                                    )}

                                    {/* Register as New Customer Option */}
                                    {customerSearchInput.trim() && customerSearchInput.trim().toLowerCase() !== 'walk-in customer' && (
                                        <button
                                            type="button"
                                            onClick={() => handleOpenQuickAdd(customerSearchInput)}
                                            onMouseEnter={() => setCustomerHighlightIndex(filteredCustomers.length + 1)}
                                            className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors bg-gray-50/50 dark:bg-gray-800/80 ${
                                                customerHighlightIndex === filteredCustomers.length + 1
                                                    ? 'bg-primary-100/70 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                                                    : 'hover:bg-primary-50 dark:hover:bg-primary-950/30 text-primary-600 dark:text-primary-400'
                                            }`}
                                        >
                                            <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400 flex items-center justify-center flex-shrink-0">
                                                <UserPlus className="w-4 h-4" />
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="font-bold text-xs">
                                                    + Register "{customerSearchInput}"
                                                </span>
                                                <span className="text-[10px] text-gray-500">
                                                    Quick save new customer and link to this bill
                                                </span>
                                            </div>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                {/* Right: Scan Barcode — exactly w-64 to align above product sidebar */}
                <div className="w-64 flex-shrink-0 flex flex-col p-2 border-l border-gray-200 dark:border-gray-700">
                    <label className="text-primary-600 font-bold text-xs uppercase flex items-center gap-1">
                        <Scan className="w-3 h-3" /> Scan Barcode (F1)
                    </label>
                    <form onSubmit={handleBarcodeSubmit} className="flex">
                        <input
                            ref={barcodeInputRef}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={barcode}
                            onChange={(e) => {
                                // Strictly reject non-numeric characters (digits only)
                                const digitsOnly = e.target.value.replace(/\D/g, '');
                                setBarcode(digitsOnly);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') return;
                                // Allow navigation & edit keys
                                if (['Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                                // Allow copy/paste/select-all combos
                                if (e.ctrlKey || e.metaKey || e.altKey) return;
                                // Allow function keys (F1, F2, etc.)
                                if (e.key.startsWith('F') && e.key.length <= 3) return;
                                // Block any non-digit character
                                if (!/^\d$/.test(e.key)) {
                                    e.preventDefault();
                                }
                            }}
                            placeholder="Scan..."
                            className="input h-9 text-lg font-mono border-primary-500 ring-1 ring-primary-200"
                            autoFocus
                        />
                    </form>
                </div>
            </div>

            {/* 2. MAIN CONTENT SPLIT */}
            <div className="flex-1 flex overflow-hidden min-h-0">

                {/* LEFT: Billing Table (75%) */}
                <div className="flex-[3] flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 min-h-0 overflow-x-auto">

                    {/* Table Container - no overflow-hidden so delete icon and footer buttons aren't clipped */}
                    <div className="flex flex-col flex-1 min-h-0">
                        {/* Table Header */}
                        <div className="grid grid-cols-[32px_120px_1fr_70px_90px_50px_90px_36px] gap-2 bg-gray-100 dark:bg-gray-900 border-b border-gray-300 dark:border-gray-700 text-xs font-bold uppercase text-gray-600 dark:text-gray-400 py-2 px-2 min-w-[600px]">
                            <div className="text-center">#</div>
                            <div className="">Barcode</div>
                            <div className="">Item Name</div>
                            <div className="text-right">Rate</div>
                            <div className="text-center">Qty</div>
                            <div className="text-right">Tax%</div>
                            <div className="text-right">Total</div>
                            <div className="text-center"></div>
                        </div>

                        {/* Table Body (Scrollable) */}
                        <div className="flex-1 overflow-y-auto content-start min-w-[600px]">
                        {
                            items.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-gray-300">
                                    <Scan className="w-16 h-16 mb-4" />
                                    <p className="text-lg">No items in cart</p>
                                    <p className="text-sm">Scan barcode or search products</p>
                                </div>
                            ) : (
                                items.map((item: any, index: number) => {
                                    const cleanName = item.productName?.includes(' | ')
                                        ? item.productName.split(' | ')[0]
                                        : (item.productName || 'Item');
                                    const category = item.categoryName || categoryMap.get(item.variantId);

                                    return (
                                        <div key={item.variantId} className="grid grid-cols-[32px_120px_1fr_70px_90px_50px_90px_36px] gap-2 border-b border-gray-100 dark:border-gray-700 text-sm py-1.5 px-2 hover:bg-blue-50 dark:hover:bg-gray-700 items-center group">
                                            <div className="text-center text-gray-500">{index + 1}</div>
                                            <div className="font-mono text-xs text-gray-500 truncate" title={item.barcode}>{item.barcode}</div>
                                            <div className="font-medium truncate flex items-center gap-2" title={`${item.productName} ${item.variantInfo || ''}`}>
                                                <span className="truncate">{cleanName}</span>
                                                {category && (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 flex-shrink-0">
                                                        {category}
                                                    </span>
                                                )}
                                                {item.variantInfo && (
                                                    <span className="text-xs text-gray-400 ml-1">{item.variantInfo}</span>
                                                )}
                                            </div>
                                            <div className="text-right">₹{item.sellingPrice}</div>

                                        {/* Qty Controls */}
                                        <div className="flex items-center justify-center gap-1">
                                            <button onClick={() => { updateQuantity(item.variantId, Math.max(1, item.quantity - 1)); markAsChanged(); }} className="p-0.5 hover:bg-gray-200 rounded text-gray-500">
                                                <Minus className="w-3 h-3" />
                                            </button>
                                            <span className="font-bold w-6 text-center">{item.quantity}</span>
                                            <button onClick={() => { updateQuantity(item.variantId, item.quantity + 1); markAsChanged(); }} className="p-0.5 hover:bg-gray-200 rounded text-gray-500">
                                                <Plus className="w-3 h-3" />
                                            </button>
                                        </div>

                                        <div className="text-right text-xs text-gray-500">{item.taxRate}%</div>
                                        <div className="text-right font-bold text-gray-800 dark:text-gray-200">
                                            ₹{(item.sellingPrice * item.quantity).toFixed(2)}
                                        </div>

                                        {/* Delete Button */}
                                        <div className="text-center">
                                            <button
                                                onClick={() => {
                                                    if (showPayment && items.length === 1) {
                                                        showNotification('You cannot remove the last item from this sale here. Use New to cancel this bill or add another item first.', 'warning');
                                                        return;
                                                    }
                                                    removeItem(item.variantId);
                                                    markAsChanged();
                                                }}
                                                className="p-1 text-red-500 hover:bg-red-50 rounded"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                            )
                        }
                    </div>
                    </div>{/* end overflow-x-auto wrapper */}

                    {/* Footer Totals */}
                    < div className="bg-gray-100 dark:bg-gray-900 border-t border-gray-300 dark:border-gray-700 p-2 shadow-inner" >
                        {!showPayment ? (
                            // DEFAULT FOOTER VIEW
                            <div className="flex justify-between items-end h-full">
                                <div className="flex gap-6 text-sm text-gray-500 font-medium pb-4">
                                    <div>Items: <span className="font-bold text-gray-800 dark:text-white">{items.length}</span></div>
                                    <div>Qty: <span className="font-bold text-gray-800 dark:text-white">{items.reduce((s: number, i: any) => s + i.quantity, 0)}</span></div>
                                    <div>Tax: <span className="font-bold text-gray-800 dark:text-white">₹{tax.toFixed(2)}</span></div>
                                </div>

                                <div className="flex gap-4 items-end">
                                    <div className="text-right mb-4">
                                        <div className="text-xs uppercase text-gray-500">Grand Total</div>
                                        <div className="text-2xl xl:text-3xl font-bold text-primary-600 leading-none">
                                            ₹{finalTotal.toFixed(2)}
                                        </div>
                                    </div>

                                    <div className="flex gap-2 h-14">
                                        <Button variant="danger" className="h-full px-6 flex items-center justify-center font-bold" onClick={clearCart} disabled={items.length === 0 || !!currentSaleId}
                                            title={currentSaleId ? 'Use New to start another bill. Edit individual items to correct this saved bill.' : 'Clear unsaved cart'}>
                                            Clear (F4)
                                        </Button>
                                        <Button
                                            variant="success"
                                            className="h-full px-8 text-xl font-bold flex items-center justify-center tracking-wide"
                                            onClick={handleCheckout}
                                            disabled={items.length === 0}
                                        >
                                            <CreditCard className="w-6 h-6" /> Checkout <ArrowRight className="w-5 h-5" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            // PAYMENT MODE FOOTER (REDESIGNED)
                            <div className="flex flex-col gap-3 animate-in slide-in-from-bottom-2 p-1">
                                {/* Row 1: Unified Summary Bar (Premium Design) */}
                                <div className="flex justify-between items-center bg-white dark:bg-gray-800 rounded-lg p-2 px-4 shadow-sm border border-gray-200 dark:border-gray-700">
                                    <div className="flex gap-6 items-center">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase font-bold text-gray-400">Subtotal</span>
                                            <span className="font-bold text-gray-700 dark:text-gray-200">₹{subtotal.toFixed(2)}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase font-bold text-gray-400">Total Tax</span>
                                            <span className="font-bold text-gray-700 dark:text-gray-200">₹{tax.toFixed(2)}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase font-bold text-gray-400">Discount Applied</span>
                                            <span className="font-bold text-orange-600">₹{parseFloat(discountAmount || '0').toFixed(2)}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase font-bold text-gray-400">Total Qty</span>
                                            <span className="font-bold text-gray-700 dark:text-gray-200">
                                                {items.reduce((s: number, i: any) => s + i.quantity, 0)}{' '}
                                                <span className="text-[11px] font-normal text-gray-400 dark:text-gray-500">
                                                    ({items.length} {items.length === 1 ? 'item' : 'items'})
                                                </span>
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        {currentSaleId && originalPaidAmount > 0 && (
                                            <div className="flex flex-col items-end pr-4 border-r border-gray-200">
                                                <span className="text-[10px] uppercase font-bold text-gray-400">Previously Paid</span>
                                                <span className="font-bold text-gray-600">₹{originalPaidAmount.toFixed(2)}</span>
                                            </div>
                                        )}
                                        <div className="flex flex-col items-end">
                                            <span className="text-[10px] uppercase font-bold text-primary-500">Net Payable</span>
                                            <span className="text-3xl font-black text-primary-600 tracking-tight leading-none">₹{finalTotal.toFixed(0)}</span>
                                        </div>
                                        <button
                                            onClick={() => setShowPayment(false)}
                                            className="ml-2 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-all border border-gray-200 dark:border-gray-700"
                                            disabled={processing}
                                            title={currentSaleId ? 'Back to items — this bill is already saved' : 'Back to items'}
                                            aria-label="Back to items"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Inline feedback banners */}
                                {saleSuccess && (
                                    <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300 rounded-lg px-4 py-2.5 text-sm font-medium animate-in fade-in">
                                        <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                        Sale saved successfully!
                                    </div>
                                )}
                                {printError && (
                                    <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded-lg px-4 py-2.5 text-sm font-medium animate-in fade-in">
                                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                        Sale saved — receipt print failed. Check printer and retry.
                                    </div>
                                )}

                                {/* Row 2: Interaction Controls */}
                                <div className="flex flex-wrap lg:flex-nowrap gap-3 items-end">

                                    {/* Left: Settings (Discount & Payment Method) */}
                                    <div className="flex gap-2 bg-gray-50 dark:bg-gray-800/50 p-2 rounded-lg border border-gray-200 dark:border-gray-700 shadow-inner">
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] uppercase font-bold text-gray-500 pl-1">Discount</label>
                                            <Input
                                                ref={discountInputRef}
                                                type="number"
                                                value={discountAmount}
                                                onChange={(e) => { setDiscountAmount(e.target.value); markAsChanged(); }}
                                                className="w-24 h-11 font-bold border-orange-200 focus:border-orange-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                placeholder="0"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] uppercase font-bold text-gray-500 pl-1">Payment Method</label>
                                            <div className="flex bg-white dark:bg-gray-700 rounded-md p-1 gap-1 border border-gray-200 dark:border-gray-600 ring-1 ring-gray-100 h-11">
                                                {(['CASH', 'UPI', 'CARD', 'SPLIT'] as const).filter(m => enabledPaymentMethods[m]).map((m) => {
                                                    const isActive = paymentMethod === m;
                                                    const colorClasses = {
                                                        CASH: isActive ? 'bg-green-600 text-white shadow-md ring-2 ring-green-100' : 'text-green-600 hover:bg-green-50',
                                                        UPI: isActive ? 'bg-purple-600 text-white shadow-md ring-2 ring-purple-100' : 'text-purple-600 hover:bg-purple-50',
                                                        CARD: isActive ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-100' : 'text-blue-600 hover:bg-blue-50',
                                                        SPLIT: isActive ? 'bg-orange-600 text-white shadow-md ring-2 ring-orange-100' : 'text-orange-600 hover:bg-orange-50'
                                                    } as any;

                                                    return (
                                                        <button
                                                            key={m}
                                                            onClick={() => {
                                                                setPaymentMethod(m as any);
                                                                markAsChanged();
                                                                if (m === 'SPLIT') setSplitAmounts({ CASH: 0, CARD: 0, UPI: 0 });
                                                            }}
                                                            className={`px-3 h-full rounded text-[11px] font-bold uppercase transition-all ${colorClasses[m]}`}
                                                        >
                                                            {m === 'SPLIT' ? 'Split' : m}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Middle: Active Payment Inputs */}
                                    <div className="flex-1 min-w-[280px] flex items-end">
                                        {paymentMethod === 'SPLIT' ? (
                                            <div className="w-full flex gap-2 h-full items-end pb-1">
                                                {(['CASH', 'CARD', 'UPI'] as const).filter(m => enabledPaymentMethods[m]).map((mode) => (
                                                    <div key={mode} className="flex-1 flex flex-col gap-1">
                                                        <label className="text-[9px] uppercase font-bold text-orange-500 pl-1">{mode}</label>
                                                        <Input
                                                            type="number"
                                                            value={(splitAmounts as any)[mode] || ''}
                                                            onChange={(e) => { setSplitAmounts(prev => ({ ...prev, [mode]: parseFloat(e.target.value) || 0 })); markAsChanged(); }}
                                                            className="h-11 text-center font-bold border-orange-300 bg-orange-50/30 px-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                            placeholder="0"
                                                        />
                                                    </div>
                                                ))}
                                                <div className="flex flex-col gap-1 items-center px-1 pb-1">
                                                    <span className="text-[9px] uppercase font-bold text-gray-400">
                                                        {Object.values(splitAmounts).reduce((a, b) => a + b, 0) < finalTotal ? 'Need' : 'Status'}
                                                    </span>
                                                    <div className={`text-sm font-black p-1.5 rounded-md border min-w-[70px] text-center ${Object.values(splitAmounts).reduce((a, b) => a + b, 0) >= finalTotal
                                                        ? 'text-green-600 bg-green-50 border-green-200'
                                                        : 'text-red-600 bg-red-50 border-red-200 shadow-sm'
                                                        }`}>
                                                        {Object.values(splitAmounts).reduce((a, b) => a + b, 0) < finalTotal
                                                            ? `₹${(finalTotal - Object.values(splitAmounts).reduce((a, b) => a + b, 0)).toFixed(0)}`
                                                            : `₹${Object.values(splitAmounts).reduce((a, b) => a + b, 0).toFixed(0)}`
                                                        }
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="w-full flex gap-3 items-end">
                                                <div className="flex-1 flex flex-col gap-1">
                                                    <label className="text-[10px] uppercase font-bold text-primary-500 pl-1">Amount Paid ({paymentMethod})</label>
                                                    <Input
                                                        ref={paidAmountInputRef}
                                                        type="number"
                                                        value={paidAmount}
                                                        onChange={(e) => { setPaidAmount(e.target.value); markAsChanged(); }}
                                                        className="h-11 text-lg font-bold border-2 border-primary-500 px-3 selection:bg-primary-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        placeholder="0"
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] uppercase font-bold text-transparent select-none pl-1">·</span>
                                                    <div className={`flex flex-col justify-center items-end h-11 min-w-[110px] px-3 rounded-lg border-2 ${change >= 0 ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-300'}`}>
                                                        <span className="text-[9px] uppercase font-bold text-gray-500 leading-none">{change >= 0 ? 'Change Due' : 'Need'}</span>
                                                        <span className={`text-base font-black leading-tight ${change >= 0 ? 'text-green-600' : 'text-red-500'}`}>₹{Math.abs(change).toFixed(0)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Right: Actions */}
                                    <div className="flex flex-col gap-1">
                                        {/* invisible label spacer — matches height of labeled sections above */}
                                        <span className="text-[10px] uppercase font-bold text-transparent select-none pl-1">Actions</span>
                                        <div className="flex gap-2 items-center">
                                            <Button
                                                variant="outline"
                                                className="h-11 px-4 flex items-center gap-2 font-bold border-2 border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg transition-all whitespace-nowrap"
                                                onClick={handleNewSale}
                                            >
                                                <Plus className="w-4 h-4" />
                                                <span className="text-sm uppercase">New</span>
                                            </Button>

                                            <Button
                                                variant="outline"
                                                className="h-11 px-4 flex items-center gap-2 font-bold border-2 border-blue-200 text-blue-600 hover:bg-blue-50 rounded-lg transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                                onClick={() => handleCompleteSale(false)}
                                                disabled={processing || (!!currentSaleId && !hasDetectedChanges)}
                                                title={currentSaleId && !hasDetectedChanges ? "No changes to update" : ""}
                                            >
                                                <Save className="w-4 h-4" />
                                                <span className="text-sm uppercase">
                                                    {currentSaleId ? 'Update' : 'Save'}
                                                </span>
                                            </Button>

                                            <Button
                                                variant="success"
                                                className="h-11 px-5 flex items-center gap-2 font-bold bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 text-white rounded-lg shadow-md transition-all active:scale-[0.98] border-0 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-green-600 disabled:hover:to-green-500"
                                                onClick={() => handleCompleteSale(true)}
                                                disabled={processing || (!!currentSaleId && !hasDetectedChanges)}
                                                title={currentSaleId && !hasDetectedChanges ? "No changes to update" : ""}
                                            >
                                                <Printer className="w-4 h-4" />
                                                <span className="text-sm font-black uppercase">
                                                    {processing ? 'Processing...' : (currentSaleId ? 'Update & Print' : 'Save & Print')}
                                                </span>
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div >
                </div >

                {/* RIGHT: Product Sidebar (Fixed Width to prevent overflow) - Only show when NOT in payment mode */}
                {!showPayment && (
                    <div className="w-64 bg-gray-50 dark:bg-gray-900 flex flex-col border-l border-gray-200 dark:border-gray-700 min-h-0 flex-shrink-0">
                        <div className="p-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                            <Input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search Item (F3)..."
                                className="h-10 text-sm"
                                autoFocus={false}
                            />
                        </div>

                        <div className="px-3 py-1 bg-gray-100 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 text-[10px] font-bold uppercase tracking-wider text-gray-500 flex justify-between items-center">
                            <span>Top Selling & Suggestions</span>
                            <span>{filteredProducts.length} items</span>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {visibleProducts.map((variant) => {
                                const sold = soldCounts.get(variant.id) || 0;
                                const category = variant.product?.category?.name;
                                const cleanName = variant.product?.name || variant.barcode;
                                const fullDesc = formatVariantDescription(cleanName, variant);

                                return (
                                    <button
                                        key={variant.id}
                                        onClick={() => handleProductClick(variant)}
                                        className="w-full text-left p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:border-primary-500 hover:shadow transition-all flex justify-between items-center group"
                                        title={fullDesc}
                                    >
                                        <div className="min-w-0 flex-1 pr-2">
                                            <div className="font-semibold text-xs sm:text-sm text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                                                <span className="truncate">{cleanName}</span>
                                                {variant.isPrepared && (
                                                    <span className="px-1.5 py-0.5 text-[9px] bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 rounded font-normal flex-shrink-0">
                                                        Pending
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                {category && (
                                                    <span className="text-[10px] font-medium px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                                                        {category}
                                                    </span>
                                                )}
                                                {sold > 0 && (
                                                    <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/40">
                                                        ★ {sold} sold
                                                    </span>
                                                )}
                                                <span className="text-[10px] text-gray-400 font-mono truncate">{variant.sku || variant.barcode}</span>
                                            </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="font-bold text-primary-600 dark:text-primary-400">₹{variant.sellingPrice}</div>
                                            <div className={`text-[10px] font-medium ${variant.isPrepared ? 'text-amber-600 dark:text-amber-400' : variant.stock > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                                                {variant.isPrepared ? 'Unconverted (0)' : `Stock: ${variant.stock}`}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                            {filteredProducts.length === 0 && (
                                <div className="text-center text-gray-400 text-sm mt-10">No items found</div>
                            )}
                            {filteredProducts.length > visibleProducts.length && (
                                <div className="text-center text-[11px] text-gray-400 py-2">
                                    Showing first {visibleProducts.length} results. Type more to narrow search.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div >

            {/* Quick Add Customer Modal */}
            <Modal
                isOpen={showQuickAddModal}
                onClose={() => setShowQuickAddModal(false)}
                title="Register New Customer"
                size="sm"
            >
                <form onSubmit={handleSaveQuickCustomer} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">
                            Customer Name <span className="text-gray-400 font-normal text-[11px]">(Optional, max 50 chars)</span>
                        </label>
                        <Input
                            type="text"
                            maxLength={50}
                            value={quickAddForm.name}
                            onChange={(e) => setQuickAddForm(prev => ({ ...prev, name: e.target.value.slice(0, 50) }))}
                            placeholder="e.g. Rahul Sharma (optional)"
                            autoFocus
                            className="h-10 text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">
                            Phone Number <span className="text-gray-400 font-normal text-[11px]">(10 digits)</span>
                        </label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                <Phone className="w-4 h-4" />
                            </div>
                            <Input
                                type="tel"
                                maxLength={14}
                                value={quickAddForm.phone}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    const digits = raw.replace(/\D/g, '');
                                    const maxDigits = raw.startsWith('+') ? 13 : 10;
                                    const capped = raw.startsWith('+') ? `+${digits.slice(0, 13)}` : digits.slice(0, 10);
                                    setQuickAddForm(prev => ({ ...prev, phone: capped }));
                                }}
                                placeholder="e.g. 9847123456"
                                className="h-10 pl-9 text-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">
                            GSTIN / Tax ID <span className="text-gray-400 font-normal">(15 characters)</span>
                        </label>
                        <Input
                            type="text"
                            maxLength={15}
                            value={quickAddForm.gstin}
                            onChange={(e) => setQuickAddForm(prev => ({ ...prev, gstin: e.target.value.toUpperCase().slice(0, 15) }))}
                            placeholder="e.g. 32AAAAA0000A1Z5"
                            className="h-10 text-sm font-mono uppercase"
                        />
                    </div>

                    <div className="pt-2 flex gap-3 border-t border-gray-100 dark:border-gray-700">
                        <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => setShowQuickAddModal(false)}
                            disabled={isSavingCustomer}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="success"
                            className="flex-1 font-bold"
                            disabled={isSavingCustomer || (!quickAddForm.name.trim() && !quickAddForm.phone.trim())}
                        >
                            {isSavingCustomer ? 'Saving...' : 'Save & Select'}
                        </Button>
                    </div>
                </form>
            </Modal>
        </div >
    );
};
