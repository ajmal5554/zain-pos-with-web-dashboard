import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Search, Trash2, Filter, Calendar as CalendarIcon, ChevronDown, ChevronUp, Tag, Banknote, CreditCard, QrCode } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ReplacementProductPicker } from '../components/sales/ReplacementProductPicker';
import { Skeleton } from '../components/ui/Skeleton';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { db } from '../lib/db';
import { printService } from '../services/print.service';
import { format, isSameDay, isSameWeek, isSameMonth, isSameYear, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, addDays, addWeeks, addMonths, addYears } from 'date-fns';
import { formatIndianCurrency } from '../lib/format';
import { useAuthStore } from '../store/authStore';
import { useCartStore } from '../store/cartStore';
import { useNavigate } from 'react-router-dom';
import { showToast } from '../components/ui/Toast';
import { AlertCircle, ArrowLeftRight, ArrowDownRight, ArrowUpRight, History, Minus, Plus, Undo2 } from 'lucide-react';

type TimePeriod = 'day' | 'week' | 'month' | 'year' | 'all';

const formatDateInputValue = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value: string): Date => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
};

const toValidDate = (value: unknown): Date | null => {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value as any);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateSafe = (value: unknown, pattern: string, fallback = 'Invalid date'): string => {
    const parsed = toValidDate(value);
    return parsed ? format(parsed, pattern) : fallback;
};

const extractReplacementBillNo = (remarks: string | undefined): string | null => {
    if (!remarks) return null;
    const match = remarks.match(/Replacement Bill #(\d+)/);
    return match?.[1] || null;
};

const isReplacementSale = (sale: any): boolean =>
    sale?.paymentMethod === 'EXCHANGE' || (sale?.remarks || '').includes('Replacement sale for Invoice');

export const Sales: React.FC = () => {
    const [sales, setSales] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('day');
    const [selectedDate, setSelectedDate] = useState(formatDateInputValue(new Date()));
    const [paymentFilter, setPaymentFilter] = useState<string>('all');
    const [staffFilter, setStaffFilter] = useState<string>('all');
    const [staffOptions, setStaffOptions] = useState<Array<{ id: string; name: string }>>([]);
    const [showFilters, setShowFilters] = useState(false);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [totalRecords, setTotalRecords] = useState(0);
    const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
    const [exchangeDetailsMap, setExchangeDetailsMap] = useState<Record<string, any>>({});

    const isExchangeRelatedSale = (sale: any): boolean =>
        isReplacementSale(sale) ||
        Boolean(sale?.exchanges && sale.exchanges.length > 0) ||
        (sale?.remarks || '').includes('[EXCHANGE') ||
        (sale?.remarks || '').includes('Replacement sale for Invoice');

    const handleToggleExpand = async (sale: any) => {
        if (expandedSaleId === sale.id) {
            setExpandedSaleId(null);
            return;
        }
        setExpandedSaleId(sale.id);

        if (isExchangeRelatedSale(sale) && !exchangeDetailsMap[sale.id]) {
            try {
                const res = await window.electronAPI.sales.getExchangeDetails({
                    billNo: sale.billNo,
                    saleId: sale.id,
                    remarks: sale.remarks
                });
                if (res.success && res.data) {
                    setExchangeDetailsMap(prev => ({ ...prev, [sale.id]: res.data }));
                }
            } catch (err) {
                console.error('Failed to load exchange details for bill #' + sale.billNo, err);
            }
        }
    };
    const [shopSettings, setShopSettings] = useState<any>(null);
    const { user } = useAuthStore();
    const navigate = useNavigate();
    const { addItem, clearCart } = useCartStore();

    // Void Modal State
    const [voidSaleId, setVoidSaleId] = useState<string | null>(null);
    const [voidReason, setVoidReason] = useState('');
    const [isVoiding, setIsVoiding] = useState(false);
    const [updatingPayment, setUpdatingPayment] = useState<string | null>(null);

    // New Professional Redesign State
    const [isExchangeModalOpen, setIsExchangeModalOpen] = useState(false);
    const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
    const [selectedSaleForAction, setSelectedSaleForAction] = useState<any>(null);
    const [returnItems, setReturnItems] = useState<any[]>([]); // Items being returned
    const [exchangeNewItems, setExchangeNewItems] = useState<any[]>([]); // New items being taken
    const [allProducts, setAllProducts] = useState<any[]>([]);
    const [refundReason, setRefundReason] = useState('');
    const [replacementPaymentMethod, setReplacementPaymentMethod] = useState<'CASH' | 'CARD' | 'UPI'>('CASH');
    const [diffAmount, setDiffAmount] = useState(0);

    const getEffectiveLineTotal = (item: any) => {
        const explicitTotal = Number(item?.total ?? 0);
        if (explicitTotal > 0) return explicitTotal;
        return Number(item?.sellingPrice || 0) * Number(item?.quantity || 0);
    };

    const getEffectiveUnitAmount = (item: any) => {
        const baseQty = Number(item?.quantity || 0);
        if (baseQty <= 0) return Number(item?.sellingPrice || 0);
        return getEffectiveLineTotal(item) / baseQty;
    };

    const getReturnValue = (item: any, qtyKey: 'returnQty' | 'refundQty') =>
        getEffectiveUnitAmount(item) * Number(item?.[qtyKey] || 0);

    // New stats states for entire filtered range
    const [totalMatchedRevenue, setTotalMatchedRevenue] = useState(0);
    const [totalMatchedBills, setTotalMatchedBills] = useState(0);

    // Payment Update Modal State
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedSaleForPaymentUpdate, setSelectedSaleForPaymentUpdate] = useState<any>(null);
    const [paymentEditData, setPaymentEditData] = useState({
        method: 'CASH' as 'CASH' | 'CARD' | 'UPI' | 'SPLIT',
        cashAmount: '',
        upiAmount: '',
        cardAmount: ''
    });
    const [isSavingPayment, setIsSavingPayment] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            loadSales();
        }, 250);
        return () => clearTimeout(timer);
    }, [timePeriod, selectedDate, searchQuery, paymentFilter, staffFilter, page, pageSize]);

    useEffect(() => {
        loadShopSettings();
        loadStaffOptions();
    }, []);

    useEffect(() => {
        setPage(1);
    }, [timePeriod, selectedDate, searchQuery, paymentFilter, staffFilter, pageSize]);

    const loadShopSettings = async () => {
        try {
            const result = await db.settings.findUnique({ where: { key: 'SHOP_SETTINGS' } });
            if (result?.value) {
                setShopSettings(JSON.parse(result.value));
            }
        } catch (error) {
            console.error('Failed to load shop settings:', error);
        }
    };

    const loadStaffOptions = async () => {
        try {
            const result = await window.electronAPI.users.listForLogin();
            if (result.success) {
                setStaffOptions((result.data || []).map((user: any) => ({
                    id: user.id,
                    name: user.name
                })));
            }
        } catch (error) {
            console.error('Failed to load staff options:', error);
        }
    };

    const loadSales = async () => {
        try {
            setLoading(true);

            let where: any = {};

            const baseDate = parseDateInputValue(selectedDate);

            if (timePeriod === 'day') {
                const start = startOfDay(baseDate);
                const end = endOfDay(baseDate);
                where.createdAt = { gte: start, lte: end };
            } else if (timePeriod === 'week') {
                where.createdAt = { gte: startOfWeek(baseDate, { weekStartsOn: 1 }), lte: endOfWeek(baseDate, { weekStartsOn: 1 }) };
            } else if (timePeriod === 'month') {
                where.createdAt = { gte: startOfMonth(baseDate), lte: endOfMonth(baseDate) };
            } else if (timePeriod === 'year') {
                where.createdAt = { gte: startOfYear(baseDate), lte: endOfYear(baseDate) };
            }

            // Add payment filter
            if (paymentFilter !== 'all') {
                where.paymentMethod = paymentFilter;
            }

            if (staffFilter !== 'all') {
                where.userId = staffFilter;
            }

            // Add search filter
            if (searchQuery) {
                where.OR = [
                    { billNo: { contains: searchQuery } },
                    { customerName: { contains: searchQuery } },
                    { customerPhone: { contains: searchQuery } },
                    { items: { some: { productName: { contains: searchQuery } } } },
                    { user: { name: { contains: searchQuery } } }
                ];
            }

            const [data, totalStats, totalCount] = await Promise.all([
                db.sales.findMany({
                    where,
                    include: {
                        items: true,
                        payments: true,
                        user: { select: { name: true } },
                        exchanges: { include: { items: true } },
                        refunds: { include: { items: true } }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: pageSize,
                    skip: (page - 1) * pageSize,
                }),
                db.sales.aggregate({
                    where: { ...where, status: { not: 'VOIDED' } },
                    _sum: { grandTotal: true },
                    _count: { id: true }
                }),
                db.sales.aggregate({
                    where,
                    _count: { id: true }
                })
            ]);

            const exchangeVariantIds = Array.from(new Set(
                (data || []).flatMap((sale: any) =>
                    (sale.exchanges || []).flatMap((exchange: any) =>
                        (exchange.items || []).flatMap((item: any) => [item.returnedItemId, item.newItemId].filter(Boolean))
                    )
                )
            ));

            let enrichedSales = data;
            if (exchangeVariantIds.length > 0) {
                const variants = await db.productVariants.findMany({
                    where: { id: { in: exchangeVariantIds as string[] } },
                    include: { product: true }
                });

                const variantMap = new Map<string, { productName: string; variantInfo: string; sellingPrice: number }>(
                    (variants || []).map((variant: any) => [
                        variant.id,
                        {
                            productName: variant.product?.name || 'Unknown Item',
                            variantInfo: `${variant.size || ''} ${variant.color || ''}`.trim(),
                            sellingPrice: Number(variant.sellingPrice || 0)
                        }
                    ])
                );

                enrichedSales = (data || []).map((sale: any) => ({
                    ...sale,
                    exchanges: (sale.exchanges || []).map((exchange: any) => ({
                        ...exchange,
                        items: (exchange.items || []).map((item: any) => {
                            const retVariant = item.returnedItemId ? variantMap.get(item.returnedItemId) : null;
                            const newVariant = item.newItemId ? variantMap.get(item.newItemId) : null;
                            return {
                                ...item,
                                returnedItemName: retVariant ? retVariant.productName : (item.returnedItemId ? 'Returned Item' : null),
                                returnedVariantInfo: retVariant ? retVariant.variantInfo : '',
                                returnedSellingPrice: retVariant ? retVariant.sellingPrice : null,
                                newItemName: newVariant ? newVariant.productName : (item.newItemId ? 'Added Item' : null),
                                newVariantInfo: newVariant ? newVariant.variantInfo : '',
                                newSellingPrice: newVariant ? newVariant.sellingPrice : null,
                            };
                        })
                    }))
                }));
            }

            setTotalMatchedRevenue(totalStats._sum.grandTotal || 0);
            setTotalMatchedBills(totalStats._count.id || 0);
            setTotalRecords(totalCount._count.id || 0);
            setSales(enrichedSales);
        } catch (error) {
            console.error('Failed to load sales:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!user) return <div className="p-8 text-center text-gray-500">Authenticating...</div>;

    if (user.role !== 'ADMIN' && !user.permViewSales) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4">
                <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full">
                    <Trash2 className="w-12 h-12" />
                </div>
                <h1 className="text-2xl font-bold">Access Denied</h1>
                <p className="text-gray-500 max-w-md">
                    You do not have permission to view sales history.
                    Please contact your administrator to request access.
                </p>
            </div>
        );
    }

    const handleVoidClick = (id: string) => {
        setVoidSaleId(id);
        setVoidReason('');
    };

    const handleExchangeClick = async (sale: any) => {
        const preparedReturnItems = sale.items
            .map((item: any) => {
                const returnedQty = (sale.exchanges || []).reduce((sum: number, ex: any) =>
                    sum + (ex.items || [])
                        .filter((ei: any) => ei.returnedItemId === item.variantId)
                        .reduce((s: number, ei: any) => s + (ei.returnedQty || 0), 0), 0);
                const refundedQty = (sale.refunds || []).reduce((sum: number, ref: any) =>
                    sum + (ref.items || [])
                        .filter((ri: any) => ri.variantId === item.variantId)
                        .reduce((s: number, ri: any) => s + (ri.quantity || 0), 0), 0);
                const availableQty = Math.max(0, item.quantity - returnedQty - refundedQty);
                return { ...item, quantity: availableQty, returnQty: 0 };
            })
            .filter((item: any) => item.quantity > 0);

        if (preparedReturnItems.length === 0) {
            showToast('No returnable items left for this bill.', 'warning');
            return;
        }

        if (preparedReturnItems.length === 1) {
            preparedReturnItems[0].returnQty = preparedReturnItems[0].quantity;
        }

        try {
            const variants = await db.productVariants.findMany({
                where: { isActive: true },
                include: { product: true }
            });

            const normalizedVariants = (variants || []).filter((variant: any) => variant?.product?.name).map((variant: any) => ({
                ...variant,
                stock: Number(variant.stock ?? 0),
                sellingPrice: Number(variant.sellingPrice ?? 0),
                size: variant.size || '',
                color: variant.color || '',
            }));

            setAllProducts(normalizedVariants);
        } catch (e) {
            console.error("Failed to load products for exchange", e);
            setAllProducts([]);
        }

        setSelectedSaleForAction(sale);
        setReturnItems(preparedReturnItems);
        setExchangeNewItems([]);
        setReplacementPaymentMethod((sale.paymentMethod === 'CARD' || sale.paymentMethod === 'UPI') ? sale.paymentMethod : 'CASH');
        setDiffAmount(0);
        setIsExchangeModalOpen(true);
    };

    const handleRefundClick = (sale: any) => {
        const preparedReturnItems = sale.items
            .map((item: any) => {
                const returnedQty = (sale.exchanges || []).reduce((sum: number, ex: any) =>
                    sum + (ex.items || [])
                        .filter((ei: any) => ei.returnedItemId === item.variantId)
                        .reduce((s: number, ei: any) => s + (ei.returnedQty || 0), 0), 0);
                const refundedQty = (sale.refunds || []).reduce((sum: number, ref: any) =>
                    sum + (ref.items || [])
                        .filter((ri: any) => ri.variantId === item.variantId)
                        .reduce((s: number, ri: any) => s + (ri.quantity || 0), 0), 0);
                const availableQty = Math.max(0, item.quantity - returnedQty - refundedQty);
                return { ...item, quantity: availableQty, refundQty: 0 };
            })
            .filter((item: any) => item.quantity > 0);

        if (preparedReturnItems.length === 0) {
            showToast('No refundable items left for this bill.', 'warning');
            return;
        }

        if (preparedReturnItems.length === 1) {
            preparedReturnItems[0].refundQty = preparedReturnItems[0].quantity;
        }

        setSelectedSaleForAction(sale);
        setReturnItems(preparedReturnItems);
        setRefundReason('');
        setIsRefundModalOpen(true);
    };

    const submitExchange = async () => {
        if (!selectedSaleForAction) return;

        const returns = returnItems.filter(ri => (ri.returnQty || 0) > 0);
        if (returns.length === 0) {
            showToast("Exchange requires at least one returned item. Please set return quantity in Step 1.", 'error');
            return;
        }

        if (exchangeNewItems.length === 0) {
            showToast("Exchange requires at least one replacement item. Please select replacement items in Step 2.", 'error');
            return;
        }

        const totalReturnedValue = returnItems.reduce((sum, it) => sum + getReturnValue(it, 'returnQty'), 0);
        const totalNewValue = exchangeNewItems.reduce((sum, it) => sum + (it.sellingPrice * it.quantity), 0);
        const difference = totalNewValue - totalReturnedValue;

        try {
            const returns = returnItems.filter(ri => ri.returnQty > 0).map(ri => ({
                returnedId: ri.variantId,
                returnedQty: ri.returnQty,
                newId: null,
                newQty: 0,
                priceDiff: -getReturnValue(ri, 'returnQty')
            }));

            const news = exchangeNewItems.map(ni => ({
                returnedId: null,
                returnedQty: 0,
                newId: ni.variantId,
                newQty: ni.quantity,
                priceDiff: ni.sellingPrice * ni.quantity
            }));

            const exchangeData = {
                originalInvoiceId: selectedSaleForAction.id,
                userId: user?.id,
                differenceAmount: difference,
                notes: `Exchange for Bill #${selectedSaleForAction.billNo}`,
                replacementPaymentMethod,
                items: [...returns, ...news],
                payments: [{
                    paymentMode: replacementPaymentMethod,
                    amount: difference
                }]
            };

            const result = await window.electronAPI.sales.exchange(exchangeData);
            if (result.success) {
                showToast("Exchange Processed Successfully!", 'success');
                setIsExchangeModalOpen(false);
                loadSales();
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            showToast(`Exchange Failed: ${error.message}`, 'error');
        }
    };

    const submitRefund = async () => {
        if (!selectedSaleForAction || !refundReason.trim()) {
            showToast("Reason is mandatory for refunds.", 'warning');
            return;
        }

        const itemsToRefund = returnItems.filter(it => it.refundQty > 0);
        if (itemsToRefund.length === 0) {
            showToast("Select at least one item to refund.", 'warning');
            return;
        }

        try {
            const refundAmount = itemsToRefund.reduce((sum, it) => sum + getReturnValue(it, 'refundQty'), 0);
            const refundData = {
                originalInvoiceId: selectedSaleForAction.id,
                userId: user?.id,
                totalAmount: refundAmount,
                reason: refundReason,
                items: itemsToRefund.map(it => ({
                    id: it.variantId,
                    qty: it.refundQty,
                    amount: getReturnValue(it, 'refundQty')
                })),
                payments: [{
                    paymentMode: selectedSaleForAction.paymentMethod || 'CASH',
                    amount: refundAmount
                }]
            };

            const result = await window.electronAPI.sales.refund(refundData);
            if (result.success) {
                showToast("Refund Processed!", 'success');
                setIsRefundModalOpen(false);
                loadSales();
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            showToast(`Refund Failed: ${error.message}`, 'error');
        }
    };

    const isSingleReturnItem = returnItems.length === 1;
    const exchangeSelectableProducts = allProducts.filter((p: any) => !!p?.product?.name);

    const handleAddReplacementProduct = (variant: any) => {
        setExchangeNewItems(prev => {
            const existingIdx = prev.findIndex(ni => ni.variantId === variant.id);
            if (existingIdx >= 0) {
                return prev.map((item, idx) =>
                    idx === existingIdx ? { ...item, quantity: item.quantity + 1 } : item
                );
            }
            return [...prev, {
                variantId: variant.id,
                productName: variant.product.name,
                variantInfo: `${variant.size || ''} ${variant.color || ''}`.trim(),
                sellingPrice: variant.sellingPrice,
                quantity: 1
            }];
        });
    };

    const replacementItemQuantities = useMemo(() => {
        const map: Record<string, number> = {};
        for (const item of exchangeNewItems) {
            map[item.variantId] = item.quantity;
        }
        return map;
    }, [exchangeNewItems]);

    const confirmVoid = async () => {
        if (!voidSaleId || !voidReason.trim()) return;

        setIsVoiding(true);
        try {
            const result = await (window.electronAPI as any).sales.voidSale({
                saleId: voidSaleId,
                reason: voidReason,
                userId: user?.id
            });

            if (!result.success) throw new Error(result.error);

            loadSales();
            setVoidSaleId(null);
            showToast('Sale voided successfully', 'success');
        } catch (error: any) {
            console.error('Failed to void sale:', error);
            showToast(`Failed to void sale: ${error.message || error}`, 'error');
        } finally {
            setIsVoiding(false);
        }
    };

    const handleUpdatePayment = async (saleId: string, currentMethod: string) => {
        const sale = sales.find(s => s.id === saleId);
        if (!sale) return;

        setSelectedSaleForPaymentUpdate(sale);

        // Pre-fill modal based on current state
        if (currentMethod === 'SPLIT') {
            const cash = sale.payments?.find((p: any) => p.paymentMode === 'CASH')?.amount || 0;
            const upi = sale.payments?.find((p: any) => p.paymentMode === 'UPI')?.amount || 0;
            const card = sale.payments?.find((p: any) => p.paymentMode === 'CARD')?.amount || 0;
            setPaymentEditData({
                method: 'SPLIT',
                cashAmount: cash > 0 ? cash.toString() : '',
                upiAmount: upi > 0 ? upi.toString() : '',
                cardAmount: card > 0 ? card.toString() : ''
            });
        } else {
            const preferredMode = ['CASH', 'UPI', 'CARD'].includes(currentMethod)
                ? currentMethod
                : (['CASH', 'UPI', 'CARD'].includes(sale.payments?.[0]?.paymentMode) ? sale.payments[0].paymentMode : 'CASH');
            setPaymentEditData({
                method: preferredMode as any,
                cashAmount: '',
                upiAmount: '',
                cardAmount: ''
            });
        }

        setIsPaymentModalOpen(true);
    };

    const submitPaymentUpdate = async () => {
        if (!selectedSaleForPaymentUpdate) return;

        const { method, cashAmount, upiAmount, cardAmount } = paymentEditData;
        const sale = selectedSaleForPaymentUpdate;

        // For replacement bills, preserve the EXCHANGE_CREDIT payment record
        const existingExchangeCredit = (sale.payments || []).find(
            (p: any) => p.paymentMode === 'EXCHANGE_CREDIT'
        );
        const exchangeCreditAmount = existingExchangeCredit ? Number(existingExchangeCredit.amount || 0) : 0;
        const isReplacement = isReplacementSale(sale) && exchangeCreditAmount > 0;

        // The amount the user is assigning across cash/upi/card is only the fresh portion
        const freshAmount = isReplacement ? (sale.grandTotal - exchangeCreditAmount) : sale.grandTotal;

        let freshPayments: any[] = [];
        let nextPaidAmount = freshAmount;
        let nextChangeAmount = 0;

        if (method === 'SPLIT') {
            const sum = (parseFloat(cashAmount) || 0) + (parseFloat(upiAmount) || 0) + (parseFloat(cardAmount) || 0);
            if (Math.abs(sum - freshAmount) > 0.01) {
                showToast(`Total must equal ${formatIndianCurrency(freshAmount)}. Current sum: ${formatIndianCurrency(sum)}`, 'warning');
                return;
            }
            nextPaidAmount = sum;
            if (parseFloat(cashAmount) > 0) freshPayments.push({ paymentMode: 'CASH', amount: parseFloat(cashAmount) });
            if (parseFloat(upiAmount) > 0) freshPayments.push({ paymentMode: 'UPI', amount: parseFloat(upiAmount) });
            if (parseFloat(cardAmount) > 0) freshPayments.push({ paymentMode: 'CARD', amount: parseFloat(cardAmount) });
        } else {
            freshPayments = [{ paymentMode: method, amount: freshAmount }];
        }

        // Final payments array: EXCHANGE_CREDIT (if replacement) + fresh payments
        const finalPayments = [
            ...(isReplacement ? [{ paymentMode: 'EXCHANGE_CREDIT', amount: exchangeCreditAmount }] : []),
            ...freshPayments
        ];

        try {
            setIsSavingPayment(true);
            const result = await window.electronAPI.sales.updatePayment({
                saleId: sale.id,
                userId: user?.id,
                paymentData: {
                    paymentMethod: isReplacement ? method : method,
                    paidAmount: nextPaidAmount,
                    changeAmount: nextChangeAmount,
                    payments: finalPayments
                }
            });

            if (!result.success) throw new Error(result.error);

            setSales(prev => prev.map(s => s.id === sale.id ? {
                ...s,
                paymentMethod: result.data.paymentMethod,
                paidAmount: result.data.paidAmount,
                changeAmount: result.data.changeAmount,
                payments: result.data.payments
            } : s));
            setIsPaymentModalOpen(false);
            showToast('Payment method updated successfully', 'success');
        } catch (error: any) {
            showToast(`Failed: ${error.message}`, 'error');
        } finally {
            setIsSavingPayment(false);
        }
    };

    const handlePrintReceipt = async (sale: any) => {
        try {
            const receiptDate = toValidDate(sale.actualSaleDate) || toValidDate(sale.createdAt) || new Date();

            // Detect replacement bill and extract exchange credit
            const isReplBill = isReplacementSale(sale);
            const exchCreditPmt = (sale.payments || []).find((p: any) => p.paymentMode === 'EXCHANGE_CREDIT');
            const exchCreditAmt = exchCreditPmt ? Number(exchCreditPmt.amount || 0) : 0;
            // Extract original bill number from remarks like "Replacement sale for Invoice #1234"
            const origBillMatch = sale.remarks?.match(/Invoice #(\d+)/);
            const origBillNo = origBillMatch?.[1] || '';

            const receiptData = {
                billNo: sale.billNo,
                date: receiptDate,
                shopName: shopSettings?.shopName || 'ZAIN GENTS PALACE',
                shopAddress: shopSettings?.address || 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR',
                shopPhone: shopSettings?.phone || '9037106449, 7907026827',
                gstin: shopSettings?.gstin || '32PVGPS0686J1ZV',
                logo: shopSettings?.logo,
                customerName: sale.customerName,
                items: sale.items.map((item: any) => ({
                    name: item.productName,
                    variantInfo: item.variantInfo,
                    quantity: item.quantity,
                    mrp: item.mrp || 0,
                    rate: item.sellingPrice,
                    discount: item.discount || 0,
                    taxRate: item.taxRate || 0,
                    total: item.total || (item.sellingPrice * item.quantity - (item.discount || 0)),
                })),
                subtotal: sale.subtotal,
                discount: sale.discount,
                cgst: sale.cgst || (sale.taxAmount / 2),
                sgst: sale.sgst || (sale.taxAmount / 2),
                grandTotal: sale.grandTotal,
                paymentMethod: sale.paymentMethod,
                paidAmount: sale.paidAmount,
                changeAmount: sale.changeAmount,
                payments: (sale.payments || []).map((p: any) => ({
                    paymentMode: p.paymentMode,
                    amount: Number(p.amount || 0),
                })),
                userName: sale.user?.name || 'Staff',
                // Exchange/replacement bill fields
                isReplacementBill: isReplBill && exchCreditAmt > 0,
                originalBillNo: origBillNo,
                exchangeCreditAmount: exchCreditAmt,
            };

            await printService.printReceipt(receiptData);
        } catch (error) {
            console.error('Failed to print receipt:', error);
            showToast('Failed to print receipt', 'error');
        }
    };

    const shiftPeriod = (direction: -1 | 1) => {
        const current = parseDateInputValue(selectedDate);
        let next = current;
        if (timePeriod === 'day') next = addDays(current, direction);
        else if (timePeriod === 'week') next = addWeeks(current, direction);
        else if (timePeriod === 'month') next = addMonths(current, direction);
        else if (timePeriod === 'year') next = addYears(current, direction);
        setSelectedDate(formatDateInputValue(next));
    };

    const getRangeLabel = () => {
        const base = parseDateInputValue(selectedDate);
        if (timePeriod === 'day') return format(base, 'dd MMM yyyy');
        if (timePeriod === 'week') return `${format(startOfWeek(base, { weekStartsOn: 1 }), 'dd MMM yyyy')} – ${format(endOfWeek(base, { weekStartsOn: 1 }), 'dd MMM yyyy')}`;
        if (timePeriod === 'month') return format(base, 'MMMM yyyy');
        if (timePeriod === 'year') return format(base, 'yyyy');
        return 'All Time';
    };

    const isCurrentPeriod = () => {
        const base = parseDateInputValue(selectedDate);
        const now = new Date();
        if (timePeriod === 'day')   return isSameDay(now, base);
        if (timePeriod === 'week')  return isSameWeek(now, base, { weekStartsOn: 1 });
        if (timePeriod === 'month') return isSameMonth(now, base);
        if (timePeriod === 'year')  return isSameYear(now, base);
        return true;
    };

    const periodName = () => {
        if (timePeriod === 'day')   return 'Day';
        if (timePeriod === 'week')  return 'Week';
        if (timePeriod === 'month') return 'Month';
        if (timePeriod === 'year')  return 'Year';
        return '';
    };

    const currentLabel = () => {
        if (timePeriod === 'day')   return 'Today';
        if (timePeriod === 'week')  return 'This Week';
        if (timePeriod === 'month') return 'This Month';
        if (timePeriod === 'year')  return 'This Year';
        return '';
    };

    const filteredSales = sales;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const showingFrom = totalRecords === 0 ? 0 : (page - 1) * pageSize + 1;
    const showingTo = Math.min(page * pageSize, totalRecords);

    // Summary display logic
    const totalRevenue = totalMatchedRevenue;
    const totalBillsCountSnapshot = totalMatchedBills;
    const averageBill = totalBillsCountSnapshot > 0 ? totalRevenue / totalBillsCountSnapshot : 0;

    return (
        <div className="space-y-6">
            {/* Header with Search and Filters */}
            <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center gap-4">
                    <div className="flex items-center gap-2 flex-1 max-w-2xl">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                            <Input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by Bill No, Customer, Items..."
                                className="pl-10"
                            />
                        </div>

                        {timePeriod !== 'all' && (
                            <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-lg px-3 py-1.5 shadow-sm">
                                <CalendarIcon className="w-5 h-5 text-primary-500" />
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="bg-transparent border-none outline-none text-sm font-medium"
                                />
                                <span className="text-xs text-gray-400 border-l border-gray-200 dark:border-gray-600 pl-2">{getRangeLabel()}</span>
                            </div>
                        )}
                    </div>
                    <Button
                        variant="secondary"
                        onClick={() => setShowFilters(!showFilters)}
                    >
                        <Filter className="w-4 h-4" />
                        Filters
                    </Button>
                </div>

                {/* Advanced Filters */}
                {showFilters && (
                    <div className="card p-4">
                        <div className="flex flex-wrap gap-4 items-center">
                            <label className="text-sm font-medium">Payment Method:</label>
                            <select
                                value={paymentFilter}
                                onChange={(e) => setPaymentFilter(e.target.value)}
                                className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800"
                            >
                                <option value="all">All Methods</option>
                                <option value="CASH">Cash</option>
                                <option value="CARD">Card</option>
                                <option value="UPI">UPI</option>
                            </select>
                            <label className="text-sm font-medium">Staff:</label>
                            <select
                                value={staffFilter}
                                onChange={(e) => setStaffFilter(e.target.value)}
                                className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800"
                            >
                                <option value="all">All Staff</option>
                                {staffOptions.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setSearchQuery('');
                                    setPaymentFilter('all');
                                    setStaffFilter('all');
                                    setSelectedDate(formatDateInputValue(new Date()));
                                    setTimePeriod('day');
                                    setPage(1);
                                }}
                            >
                                Clear Filters
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Time Period Tabs */}
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => setTimePeriod('day')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${timePeriod === 'day' ? 'bg-primary-600 text-white shadow-lg shadow-primary-200' : 'bg-white dark:bg-gray-800 text-gray-600 hover:bg-gray-50 border border-gray-100 dark:border-gray-700'}`}
                >
                    Day
                </button>
                <button
                    onClick={() => setTimePeriod('week')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${timePeriod === 'week' ? 'bg-primary-600 text-white shadow-lg shadow-primary-200' : 'bg-white dark:bg-gray-800 text-gray-600 hover:bg-gray-50 border border-gray-100 dark:border-gray-700'}`}
                >
                    Week
                </button>
                <button
                    onClick={() => setTimePeriod('month')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${timePeriod === 'month' ? 'bg-primary-600 text-white shadow-lg shadow-primary-200' : 'bg-white dark:bg-gray-800 text-gray-600 hover:bg-gray-50 border border-gray-100 dark:border-gray-700'}`}
                >
                    Month
                </button>
                <button
                    onClick={() => setTimePeriod('year')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${timePeriod === 'year' ? 'bg-primary-600 text-white shadow-lg shadow-primary-200' : 'bg-white dark:bg-gray-800 text-gray-600 hover:bg-gray-50 border border-gray-100 dark:border-gray-700'}`}
                >
                    Year
                </button>
                <button
                    onClick={() => {
                        setTimePeriod('all');
                    }}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${timePeriod === 'all' ? 'bg-primary-600 text-white shadow-lg shadow-primary-200' : 'bg-white dark:bg-gray-800 text-gray-600 hover:bg-gray-50 border border-gray-100 dark:border-gray-700'}`}
                >
                    All Time
                </button>
                {timePeriod !== 'all' && (
                    <>
                        {/* Visual divider between period tabs and navigation */}
                        <div className="w-px bg-gray-200 dark:bg-gray-700 self-stretch mx-1" />

                        {/* Prev */}
                        <button
                            onClick={() => shiftPeriod(-1)}
                            className="px-3 py-2 text-sm font-medium rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 flex items-center gap-1"
                        >
                            ◀ Prev {periodName()}
                        </button>

                        {/* Today / This Week / This Month / This Year — highlighted when on current period */}
                        <button
                            onClick={() => setSelectedDate(formatDateInputValue(new Date()))}
                            className={`px-3 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-1 ${
                                isCurrentPeriod()
                                    ? 'bg-primary-600 text-white shadow-sm'
                                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700'
                            }`}
                        >
                            {currentLabel()}
                        </button>

                        {/* Next — disabled when already on current period */}
                        <button
                            onClick={() => shiftPeriod(1)}
                            disabled={isCurrentPeriod()}
                            className={`px-3 py-2 text-sm font-medium rounded-lg border border-gray-100 dark:border-gray-700 flex items-center gap-1 transition-all ${
                                isCurrentPeriod()
                                    ? 'opacity-40 cursor-not-allowed bg-white dark:bg-gray-800 text-gray-400'
                                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                        >
                            Next {periodName()} ▶
                        </button>
                    </>
                )}
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card">
                    <p className="text-sm text-gray-600 dark:text-gray-400">Total Bills</p>
                    <p className="text-2xl font-bold mt-1">{totalBillsCountSnapshot}</p>
                </div>
                <div className="card">
                    <p className="text-sm text-gray-600 dark:text-gray-400">Total Revenue</p>
                    <p className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">
                        {formatIndianCurrency(totalRevenue)}
                    </p>
                </div>
                <div className="card">
                    <p className="text-sm text-gray-600 dark:text-gray-400">Average Bill</p>
                    <p className="text-2xl font-bold mt-1">
                        {formatIndianCurrency(averageBill)}
                    </p>
                </div>
            </div>

            {/* Sales Table — full-width, edge-to-edge (no side padding/radius) */}
            <div className="bg-white dark:bg-gray-800 overflow-x-auto -mx-6 border-y border-gray-200 dark:border-gray-700">
                <table className="table">
                    <thead>
                        <tr>
                            <th>Show</th>
                            <th>Bill No</th>
                            <th>Date</th>
                            <th>Customer</th>
                            <th>Items</th>
                            <th>Total</th>
                            <th>Payment</th>
                            <th>Staff</th>
                            <th className="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 5 }).map((_, index) => (
                                <tr key={index}>
                                    <td><Skeleton className="h-4 w-6" /></td>
                                    <td><Skeleton className="h-4 w-24" /></td>
                                    <td><Skeleton className="h-4 w-32" /></td>
                                    <td><Skeleton className="h-4 w-32" /></td>
                                    <td><Skeleton className="h-4 w-12" /></td>
                                    <td><Skeleton className="h-4 w-20" /></td>
                                    <td><Skeleton className="h-6 w-16" /></td>
                                    <td><Skeleton className="h-4 w-24" /></td>
                                    <td><Skeleton className="h-8 w-24" /></td>
                                </tr>
                            ))
                        ) : filteredSales.length > 0 ? (
                            filteredSales.map((sale, index) => {
                                const prevSale = index > 0 ? filteredSales[index - 1] : null;
                                const currDate = toValidDate(sale.actualSaleDate) || toValidDate(sale.createdAt);
                                const prevDate = prevSale ? (toValidDate(prevSale.actualSaleDate) || toValidDate(prevSale.createdAt)) : null;

                                let showDivider = false;
                                let dividerLabel = "";
                                let dividerColor = "";

                                if (currDate && prevDate) {
                                    // Year Change
                                    if (currDate.getFullYear() !== prevDate.getFullYear()) {
                                        showDivider = true;
                                        dividerLabel = `Start of ${currDate.getFullYear()}`;
                                        dividerColor = "bg-rose-500";
                                    }
                                    // Month Change (same year)
                                    else if (currDate.getMonth() !== prevDate.getMonth()) {
                                        showDivider = true;
                                        dividerLabel = format(currDate, 'MMMM yyyy');
                                        dividerColor = "bg-amber-500";
                                    }
                                    // Week Change (same month)
                                    else if (!isSameWeek(currDate, prevDate, { weekStartsOn: 1 })) {
                                        showDivider = true;
                                        const startOfCurrWeek = startOfWeek(currDate, { weekStartsOn: 1 });
                                        const endOfCurrWeek = endOfWeek(currDate, { weekStartsOn: 1 });
                                        dividerLabel = `Week: ${format(startOfCurrWeek, 'dd MMM')} - ${format(endOfCurrWeek, 'dd MMM')}`;
                                        dividerColor = "bg-emerald-500";
                                    }
                                }

                                return (
                                    <React.Fragment key={sale.id}>
                                        {showDivider && (
                                            <tr>
                                                <td colSpan={9} className="p-0">
                                                    <div className="flex items-center gap-4 py-3 px-4 bg-gray-50/50 dark:bg-gray-800/50">
                                                        <div className={`h-1 w-12 rounded-full ${dividerColor}`}></div>
                                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                                                            Time Horizon: {dividerLabel}
                                                        </span>
                                                        <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        <tr className={`group ${sale.status === 'VOIDED' ? 'bg-red-50 dark:bg-red-900/10' : ''} ${expandedSaleId === sale.id ? 'bg-primary-50/30' : ''}`}>
                                            <td>
                                                <button
                                                    onClick={() => handleToggleExpand(sale)}
                                                    className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                                >
                                                    {expandedSaleId === sale.id ? (
                                                        <ChevronUp className="w-4 h-4 text-primary-600" />
                                                    ) : (
                                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                                    )}
                                                </button>
                                            </td>
                                            <td className="font-bold whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-primary-600">#{sale.billNo}</span>
                                                    {isReplacementSale(sale) && (
                                                        <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded border border-green-200 font-black uppercase">
                                                            Replacement Bill
                                                        </span>
                                                    )}
                                                    {sale.status === 'VOIDED' && (
                                                        <span className="text-[10px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded border border-red-200 font-black uppercase">
                                                            VOID
                                                        </span>
                                                    )}
                                                    {sale.exchanges?.length > 0 && (
                                                        <span className="text-[10px] bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded border border-orange-200 font-black uppercase">
                                                            Exchanged
                                                        </span>
                                                    )}
                                                    {sale.refunds?.length > 0 && (
                                                        <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200 font-black uppercase">
                                                            Refunded
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className={`whitespace-nowrap text-xs ${sale.status === 'VOIDED' ? 'line-through text-gray-400' : 'text-gray-600'}`}>
                                                {formatDateSafe(sale.actualSaleDate || sale.createdAt, 'dd MMM yyyy, HH:mm')}
                                            </td>
                                            <td className={`font-medium ${sale.status === 'VOIDED' ? 'line-through text-gray-400' : ''}`}>
                                                {sale.customerName || <span className="text-gray-300 italic text-xs">Walk-in</span>}
                                            </td>
                                            <td>
                                                <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs font-bold">
                                                    {sale.items.length}
                                                </span>
                                            </td>
                                            <td className={`font-black text-gray-900 dark:text-gray-100 ${sale.status === 'VOIDED' ? 'line-through text-gray-400' : ''}`}>
                                                {formatIndianCurrency(sale.grandTotal)}
                                            </td>
                                            <td>
                                                {(() => {
                                                    const isExchangeGeneratedSale = sale.paymentMethod === 'EXCHANGE' || (sale.remarks || '').includes('Replacement sale for Invoice');
                                                    const canUpdatePayment =
                                                        sale.status !== 'VOIDED' && (
                                                            user?.role === 'ADMIN' ||
                                                            user?.permChangePayment ||
                                                            (isExchangeGeneratedSale && user?.permEditSales)
                                                        );

                                                    // For replacement bills, show compound badge with the fresh payment method
                                                    let displayMethod = sale.paymentMethod;
                                                    if (isExchangeGeneratedSale && sale.payments && sale.payments.length > 0) {
                                                        const freshPayments = sale.payments.filter((p: any) => p.paymentMode !== 'EXCHANGE_CREDIT' && p.paymentMode !== 'EXCHANGE');
                                                        if (freshPayments.length > 0) {
                                                            displayMethod = `EXCH + ${freshPayments.map((p: any) => p.paymentMode).join('+')}`;
                                                        } else {
                                                            displayMethod = 'EXCHANGE';
                                                        }
                                                    }

                                                    return (
                                                        <button
                                                            onClick={() => canUpdatePayment && handleUpdatePayment(sale.id, sale.paymentMethod)}
                                                            disabled={updatingPayment === sale.id || !canUpdatePayment}
                                                            className={`transition-all ${canUpdatePayment ? 'cursor-pointer hover:scale-110 active:scale-90' : 'cursor-not-allowed opacity-70'}`}
                                                            title={canUpdatePayment ? 'Click to update payment method' : 'No permission to update payment method'}
                                                        >
                                                            <span className={`badge py-1 px-3 ${sale.status === 'VOIDED' ? 'bg-red-100 text-red-800' : 'badge-info shadow-sm'} ${updatingPayment === sale.id ? 'opacity-50' : ''}`}>
                                                                {updatingPayment === sale.id ? '...' : (sale.status === 'VOIDED' ? 'VOIDED' : displayMethod)}
                                                            </span>
                                                        </button>
                                                    );
                                                })()}
                                            </td>
                                            <td className="text-sm text-gray-500 whitespace-nowrap">{sale.user?.name || 'Staff'}</td>
                                            <td>
                                                <div className="flex gap-2 justify-end">
                                                    <Button variant="secondary" size="sm" onClick={() => handlePrintReceipt(sale)} className="shadow-sm">
                                                        <Printer className="w-4 h-4" />
                                                    </Button>

                                                    {(user?.role === 'ADMIN' || user?.permEditSales) && sale.status !== 'VOIDED' && (
                                                        <div className="flex gap-1">
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                title="Process Exchange"
                                                                onClick={() => handleExchangeClick(sale)}
                                                                className="shadow-sm bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100"
                                                            >
                                                                <ArrowLeftRight className="w-4 h-4" />
                                                            </Button>
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                title="Process Refund"
                                                                onClick={() => handleRefundClick(sale)}
                                                                className="shadow-sm bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                                                            >
                                                                <Undo2 className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                    {(user?.role === 'ADMIN' || user?.permVoidSale) && sale.status !== 'VOIDED' && sale.exchanges?.length === 0 && sale.refunds?.length === 0 && (
                                                        <Button
                                                            variant="danger"
                                                            size="sm"
                                                            title="Void Bill"
                                                            onClick={() => handleVoidClick(sale.id)}
                                                            className="shadow-sm"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Expanded Detail Row */}
                                        {expandedSaleId === sale.id && (
                                            <tr className="bg-gray-50/50 dark:bg-gray-900/20 animate-in fade-in slide-in-from-top-2 duration-200">
                                                <td colSpan={9} className="p-0 border-b border-gray-200 dark:border-gray-700">
                                                    <div className="px-14 py-4 bg-white dark:bg-gray-800/40 m-2 rounded-xl border border-gray-100 dark:border-gray-700 shadow-inner">
                                                        {(() => {
                                                            const exData = exchangeDetailsMap[sale.id];
                                                            const isExchange = isExchangeRelatedSale(sale);
                                                            if (!isExchange && !exData) return null;

                                                            const origBillNo = exData?.originalBillNo || (isReplacementSale(sale) ? sale.remarks?.match(/Invoice #(\d+)/)?.[1] : sale.billNo);
                                                            const replBillNo = exData?.replacementBillNo || extractReplacementBillNo(sale.remarks) || (isReplacementSale(sale) ? sale.billNo : null);

                                                            const returnedItems = (exData?.returnedItems && exData.returnedItems.length > 0)
                                                                ? exData.returnedItems
                                                                : (sale.exchanges || []).flatMap((ex: any) =>
                                                                    (ex.items || []).filter((ei: any) => ei.returnedItemId).map((ei: any) => {
                                                                        const qty = ei.returnedQty || 1;
                                                                        // Use enriched sellingPrice first, then fall back to priceDiff
                                                                        const unitPrice = ei.returnedSellingPrice || (ei.priceDiff != null ? Math.abs(Number(ei.priceDiff)) / qty : 0);
                                                                        return {
                                                                            name: ei.returnedItemName || 'Returned Item',
                                                                            variant: ei.returnedVariantInfo || '',
                                                                            qty,
                                                                            amount: Math.round(unitPrice * qty * 100) / 100
                                                                        };
                                                                    })
                                                                );

                                                            const replacementItems = (exData?.replacementItems && exData.replacementItems.length > 0)
                                                                ? exData.replacementItems
                                                                : (isReplacementSale(sale)
                                                                    ? sale.items.map((it: any) => ({
                                                                        name: it.productName,
                                                                        variant: it.variantInfo || '',
                                                                        qty: it.quantity,
                                                                        amount: Number(it.total) || (Number(it.sellingPrice) * it.quantity) || 0
                                                                    }))
                                                                    : (sale.exchanges || []).flatMap((ex: any) =>
                                                                        (ex.items || []).filter((ei: any) => ei.newItemId).map((ei: any) => {
                                                                            const qty = ei.newQty || 1;
                                                                            const unitPrice = ei.newSellingPrice || (ei.priceDiff != null ? Number(ei.priceDiff) / qty : 0);
                                                                            return {
                                                                                name: ei.newItemName || 'Added Item',
                                                                                variant: ei.newVariantInfo || '',
                                                                                qty,
                                                                                amount: Math.round(unitPrice * qty * 100) / 100
                                                                            };
                                                                        })
                                                                    )
                                                                );

                                                            const returnedTotal = exData?.returnedTotal ?? returnedItems.reduce((s: number, i: any) => s + (i.amount || 0), 0);
                                                            const replacementTotal = exData?.replacementTotal ?? replacementItems.reduce((s: number, i: any) => s + (i.amount || 0), 0);
                                                            const diffAmount = exData?.differenceAmount ?? (replacementTotal - returnedTotal);

                                                            if (returnedItems.length === 0 && replacementItems.length === 0) return null;

                                                            return (
                                                                <div className="mb-6 rounded-xl border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/40 dark:bg-indigo-950/10 p-4 space-y-4">
                                                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100/80 dark:border-indigo-900/40 pb-3">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="p-1 rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
                                                                                <ArrowLeftRight className="w-3.5 h-3.5" />
                                                                            </span>
                                                                            <span className="text-[11px] font-black uppercase tracking-wider text-indigo-900 dark:text-indigo-300">
                                                                                Item Exchange Breakdown
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex items-center gap-2 font-mono text-xs">
                                                                            {origBillNo && (
                                                                                <span className="px-2 py-0.5 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold">
                                                                                    Original: #{origBillNo}
                                                                                </span>
                                                                            )}
                                                                            {replBillNo && (
                                                                                <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white font-semibold">
                                                                                    Replacement: #{replBillNo}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* Returned Items Section */}
                                                                    {returnedItems.length > 0 && (
                                                                        <div className="space-y-1.5">
                                                                            <div className="flex items-center justify-between text-xs font-bold text-rose-600 dark:text-rose-400">
                                                                                <span className="flex items-center gap-1.5">
                                                                                    <ArrowDownRight className="w-4 h-4" /> Items Returned by Customer
                                                                                </span>
                                                                                <span className="font-mono">Total: {formatIndianCurrency(returnedTotal)}</span>
                                                                            </div>
                                                                            <div className="space-y-1">
                                                                                {returnedItems.map((item: any, idx: number) => (
                                                                                    <div
                                                                                        key={`ret-${idx}`}
                                                                                        className="p-2.5 rounded-lg bg-rose-50/80 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-900/40 text-xs flex justify-between items-center text-rose-950 dark:text-rose-200"
                                                                                    >
                                                                                        <div>
                                                                                            <span className="font-bold">{item.name}</span>
                                                                                            {item.variant && <span className="text-[10px] opacity-75 ml-1.5">({item.variant})</span>}
                                                                                            <span className="ml-2 font-mono text-[11px] font-semibold bg-rose-100 dark:bg-rose-900/50 px-1.5 py-0.5 rounded">
                                                                                                x{item.qty}
                                                                                            </span>
                                                                                        </div>
                                                                                        <span className="font-mono font-bold text-rose-700 dark:text-rose-300">
                                                                                            {formatIndianCurrency(item.total ?? item.amount ?? (item.rate ? item.rate * (item.qty || 1) : 0))}
                                                                                        </span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* Replacement Items Given Section */}
                                                                    {replacementItems.length > 0 && (
                                                                        <div className="space-y-1.5">
                                                                            <div className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                                                                <span className="flex items-center gap-1.5">
                                                                                    <ArrowUpRight className="w-4 h-4" /> New Items Given in Exchange
                                                                                </span>
                                                                                <span className="font-mono">Total: {formatIndianCurrency(replacementTotal)}</span>
                                                                            </div>
                                                                            <div className="space-y-1">
                                                                                {replacementItems.map((item: any, idx: number) => (
                                                                                    <div
                                                                                        key={`repl-${idx}`}
                                                                                        className="p-2.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-900/40 text-xs flex justify-between items-center text-emerald-950 dark:text-emerald-200"
                                                                                    >
                                                                                        <div>
                                                                                            <span className="font-bold">{item.name}</span>
                                                                                            {item.variant && <span className="text-[10px] opacity-75 ml-1.5">({item.variant})</span>}
                                                                                            <span className="ml-2 font-mono text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-900/50 px-1.5 py-0.5 rounded">
                                                                                                x{item.qty}
                                                                                            </span>
                                                                                        </div>
                                                                                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                                                                                            {formatIndianCurrency(item.total ?? item.amount ?? (item.rate ? item.rate * (item.qty || 1) : 0))}
                                                                                        </span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* Financial Summary */}
                                                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                                                                        <div className="p-3 rounded-xl bg-white dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700/80 shadow-sm">
                                                                            <span className="text-[10px] uppercase font-bold text-gray-400 block tracking-wider mb-1">
                                                                                Returned Credit
                                                                            </span>
                                                                            <span className="font-mono font-bold text-gray-800 dark:text-gray-200 text-sm">
                                                                                {formatIndianCurrency(returnedTotal)}
                                                                            </span>
                                                                        </div>
                                                                        <div className="p-3 rounded-xl bg-white dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700/80 shadow-sm">
                                                                            <span className="text-[10px] uppercase font-bold text-gray-400 block tracking-wider mb-1">
                                                                                New Goods Value
                                                                            </span>
                                                                            <span className="font-mono font-bold text-gray-800 dark:text-gray-200 text-sm">
                                                                                {formatIndianCurrency(replacementTotal)}
                                                                            </span>
                                                                        </div>
                                                                        <div className="p-3 rounded-xl bg-white dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700/80 shadow-sm">
                                                                            <span className="text-[10px] uppercase font-bold text-gray-400 block tracking-wider mb-1">
                                                                                Difference Settled
                                                                            </span>
                                                                            <span className={`font-mono font-black text-sm ${
                                                                                diffAmount > 0 ? 'text-emerald-600' :
                                                                                diffAmount < 0 ? 'text-blue-600' : 'text-gray-600'
                                                                            }`}>
                                                                                {diffAmount > 0 ? `+${formatIndianCurrency(diffAmount)} (Paid)` :
                                                                                 diffAmount < 0 ? `-${formatIndianCurrency(Math.abs(diffAmount))} (Refunded)` :
                                                                                 '₹0.00 (Equal Value)'}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}

                                                        <h4 className="text-xs font-black uppercase text-gray-400 mb-3 tracking-widest flex items-center gap-2">
                                                            <Tag className="w-3 h-3" />
                                                            Items Purchased
                                                        </h4>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                            {sale.items.map((item: any, idx: number) => {
                                                                const returnedQty = (sale.exchanges || []).reduce((sum: number, ex: any) =>
                                                                    sum + (ex.items || []).filter((ei: any) => ei.returnedItemId === item.variantId).reduce((s: number, ei: any) => s + ei.returnedQty, 0), 0);
                                                                const refundedQty = (sale.refunds || []).reduce((sum: number, ref: any) =>
                                                                    sum + (ref.items || []).filter((ri: any) => ri.variantId === item.variantId).reduce((s: number, ri: any) => s + ri.quantity, 0), 0);
                                                                const activeQty = item.quantity - returnedQty - refundedQty;

                                                                return (
                                                                    <div key={idx} className={`flex justify-between items-center p-3 rounded-lg border ${activeQty <= 0 ? 'bg-gray-100 dark:bg-gray-800 opacity-50 border-dashed' : 'bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
                                                                        <div className="min-w-0">
                                                                            <div className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
                                                                                {item.productName}
                                                                                {returnedQty > 0 && returnedQty >= item.quantity && <span className="text-[8px] bg-amber-100 text-amber-700 px-1 rounded">EXCHANGED</span>}
                                                                                {refundedQty > 0 && refundedQty >= item.quantity && returnedQty === 0 && <span className="text-[8px] bg-gray-200 text-gray-600 px-1 rounded">REFUNDED</span>}
                                                                            </div>
                                                                            <div className="text-[10px] text-gray-500 font-medium">
                                                                                {item.variantInfo}
                                                                            </div>
                                                                        </div>
                                                                        <div className="text-right flex-shrink-0 ml-4">
                                                                            <div className={`text-xs font-black ${activeQty <= 0 ? 'text-gray-400' : 'text-primary-600'}`}>
                                                                                {item.quantity} × {formatIndianCurrency(item.sellingPrice)}
                                                                            </div>
                                                                            {(returnedQty > 0 || refundedQty > 0) && (
                                                                                <div className="text-[9px] text-red-500 font-bold uppercase">
                                                                                    {returnedQty > 0 ? `${returnedQty} Exchanged ` : ''}
                                                                                    {refundedQty > 0 ? `${refundedQty} Refunded` : ''}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>

                                                        {(() => {
                                                            if (!sale.remarks) return null;
                                                            const cleanRemarks = sale.remarks
                                                                .split('\n')
                                                                .filter((line: string) => !line.trim().startsWith('Replacement sale for Invoice') && !line.trim().startsWith('[EXCHANGE'))
                                                                .join('\n')
                                                                .trim();

                                                            if (!cleanRemarks) return null;

                                                            return (
                                                                <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800">
                                                                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
                                                                        Invoice Flag
                                                                    </div>
                                                                    <div className="mt-1 text-xs text-amber-800 dark:text-amber-300 whitespace-pre-line">
                                                                        {cleanRemarks}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* Payment Breakdown (Especially for SPLIT) */}
                                                        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                                                            <h5 className="text-[10px] font-black uppercase text-gray-400 mb-3 tracking-widest flex items-center gap-2">
                                                                <CreditCard className="w-3 h-3" />
                                                                Payment Breakdown
                                                            </h5>
                                                            <div className="flex flex-wrap gap-3">
                                                                {(sale.payments && sale.payments.length > 0 ? sale.payments : [
                                                                    { paymentMode: sale.paymentMethod, amount: sale.grandTotal }
                                                                ]).map((p: any, i: number) => {
                                                                    let Icon = Banknote;
                                                                    let colorClass = "bg-green-50 text-green-700 border-green-200";
                                                                    let label = p.paymentMode;

                                                                    if (p.paymentMode === 'CARD') {
                                                                        Icon = CreditCard;
                                                                        colorClass = "bg-blue-50 text-blue-700 border-blue-200";
                                                                    } else if (p.paymentMode === 'UPI') {
                                                                        Icon = QrCode;
                                                                        colorClass = "bg-purple-50 text-purple-700 border-purple-200";
                                                                    } else if (p.paymentMode === 'EXCHANGE_CREDIT') {
                                                                        Icon = ArrowLeftRight;
                                                                        colorClass = "bg-amber-50 text-amber-700 border-amber-200";
                                                                        label = 'EXCHANGE CREDIT';
                                                                    } else if (p.paymentMode === 'EXCHANGE') {
                                                                        Icon = ArrowLeftRight;
                                                                        colorClass = "bg-amber-50 text-amber-700 border-amber-200";
                                                                    }

                                                                    return (
                                                                        <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border shadow-sm ${colorClass}`}>
                                                                            <Icon className="w-3.5 h-3.5" />
                                                                            <span className="text-xs font-black uppercase tracking-wider">{label}</span>
                                                                            <span className="text-sm font-black text-gray-900 dark:text-gray-100">{formatIndianCurrency(p.amount)}</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        {/* Transaction History Timeline */}
                                                        {((sale.exchanges || []).length > 0 || (sale.refunds || []).length > 0 || (sale.remarks || '').split('\n').some((line: string) => line.startsWith('[UPDATE '))) && (
                                                            <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                                                                <h5 className="text-[10px] font-black uppercase text-gray-400 mb-3 tracking-widest flex items-center gap-2">
                                                                    <History className="w-3 h-3" />
                                                                    Adjustment History
                                                                </h5>
                                                                <div className="space-y-2">
                                                                    {(sale.exchanges || []).map((ex: any, i: number) => (
                                                                        <div key={i} className="flex items-center gap-3 text-xs">
                                                                            <div className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.5)]"></div>
                                                                            <span className="text-gray-500 font-medium">{formatDateSafe(ex.exchangeDate, 'dd MMM, HH:mm', 'Updated')}:</span>
                                                                            <span className="font-bold text-orange-600">Exchange Processed</span>
                                                                            <span className="text-gray-400">({ex.notes})</span>
                                                                            <span className="ml-auto font-black">{ex.differenceAmount > 0 ? '+' : ''}{formatIndianCurrency(ex.differenceAmount)}</span>
                                                                        </div>
                                                                    ))}
                                                                    {(sale.refunds || []).map((ref: any, i: number) => (
                                                                        <div key={i} className="flex items-center gap-3 text-xs">
                                                                            <div className="w-2 h-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]"></div>
                                                                            <span className="text-gray-500 font-medium">{formatDateSafe(ref.refundDate, 'dd MMM, HH:mm', 'Updated')}:</span>
                                                                            <span className="font-bold text-red-600">Refunded</span>
                                                                            <span className="text-gray-400">({ref.reason})</span>
                                                                            <span className="ml-auto font-black">-{formatIndianCurrency(ref.totalRefundAmount)}</span>
                                                                        </div>
                                                                    ))}
                                                                    {(sale.remarks || '')
                                                                        .split('\n')
                                                                        .filter((line: string) => line.startsWith('[UPDATE '))
                                                                        .map((line: string, i: number) => {
                                                                            const closeBracket = line.indexOf(']');
                                                                            const rawDate = closeBracket > 8 ? line.slice(8, closeBracket) : '';
                                                                            const message = closeBracket >= 0 ? line.slice(closeBracket + 1).trim() : line;
                                                                            const parsedDate = rawDate ? new Date(rawDate) : null;
                                                                            const isValidDate = parsedDate && !Number.isNaN(parsedDate.getTime());

                                                                            return (
                                                                                <div key={`upd-${i}`} className="flex items-center gap-3 text-xs">
                                                                                    <div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]"></div>
                                                                                    <span className="text-gray-500 font-medium">{isValidDate ? format(parsedDate as Date, 'dd MMM, HH:mm') : 'Updated'}:</span>
                                                                                    <span className="font-bold text-blue-600">Invoice Updated</span>
                                                                                    <span className="text-gray-400">({message})</span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {(() => {
                                                            const isReplacement = isReplacementSale(sale);
                                                            const exchangeCreditPayment = (sale.payments || []).find((p: any) => p.paymentMode === 'EXCHANGE_CREDIT');
                                                            const exchangeCreditAmount = exchangeCreditPayment ? Number(exchangeCreditPayment.amount || 0) : 0;
                                                            const storeCreditMatch = (sale.remarks || '').match(/STORE CREDIT NOTE: Rs\.([\.\d]+)/i);
                                                            const storeCreditAmount = storeCreditMatch ? parseFloat(storeCreditMatch[1]) : 0;
                                                            const freshPaid = (sale.payments || []).filter((p: any) => p.paymentMode !== 'EXCHANGE_CREDIT' && p.paymentMode !== 'EXCHANGE').reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

                                                            return (
                                                                <div className="mt-4 pt-3 border-t border-dashed border-gray-200 dark:border-gray-700 flex flex-col gap-2">
                                                                    <div className="flex justify-end items-center gap-8">
                                                                        <div className="text-right">
                                                                            <div className="text-[10px] font-bold text-gray-400 uppercase">Subtotal</div>
                                                                            <div className="text-sm font-bold">{formatIndianCurrency(sale.subtotal)}</div>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <div className="text-[10px] font-bold text-gray-400 uppercase">Discount</div>
                                                                            <div className="text-sm font-bold text-orange-600">{formatIndianCurrency(sale.discount)}</div>
                                                                        </div>
                                                                        {isReplacement && exchangeCreditAmount > 0 && (
                                                                            <div className="text-right">
                                                                                <div className="text-[10px] font-bold text-amber-600 uppercase">Exchange Credit Applied</div>
                                                                                <div className="text-sm font-bold text-amber-600">-{formatIndianCurrency(exchangeCreditAmount)}</div>
                                                                            </div>
                                                                        )}
                                                                        <div className="text-right">
                                                                            <div className={`text-[10px] font-bold uppercase ${isReplacement ? 'text-emerald-600' : 'text-primary-600'}`}>
                                                                                {isReplacement ? 'Net Paid Today' : 'Total Paid'}
                                                                            </div>
                                                                            <div className={`text-lg font-black ${isReplacement ? 'text-emerald-600' : 'text-primary-600'}`}>
                                                                                {formatIndianCurrency(isReplacement && exchangeCreditAmount > 0 ? freshPaid : sale.grandTotal)}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    {storeCreditAmount > 0 && (
                                                                        <div className="flex justify-end">
                                                                            <div className="px-3 py-1.5 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs font-bold flex items-center gap-2">
                                                                                <AlertCircle className="w-3.5 h-3.5" />
                                                                                Store Credit Note Issued: {formatIndianCurrency(storeCreditAmount)} (for future use)
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })
                        ) : (
                            <tr>
                                <td colSpan={9} className="text-center py-12 text-gray-400">
                                    <div className="flex flex-col items-center gap-2">
                                        <Search className="w-8 h-8 opacity-20" />
                                        <span className="text-lg font-medium">No transactions match your filters</span>
                                        <span className="text-xs">Try selecting a different date or search term</span>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mt-6 mb-8">
                <div className="text-sm text-gray-500">
                    Showing {showingFrom}-{showingTo} of {totalRecords} invoices
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-500">Rows:</label>
                    <select
                        value={pageSize}
                        onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
                        className="px-2 py-1 border rounded-md bg-white dark:bg-gray-800 text-sm"
                    >
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                    <Button
                        variant="secondary"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1 || loading}
                    >
                        Prev
                    </Button>
                    <span className="text-sm px-2">Page {page} of {totalPages}</span>
                    <Button
                        variant="secondary"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages || loading}
                    >
                        Next
                    </Button>
                </div>
            </div>

            {/* Void Modal */}
            <Modal
                isOpen={!!voidSaleId}
                onClose={() => setVoidSaleId(null)}
                title="Void Sale"
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-gray-600 dark:text-gray-400">
                        Are you sure you want to void this sale? This action cannot be undone.
                    </p>
                    <Input
                        label="Reason"
                        value={voidReason}
                        onChange={(e) => setVoidReason(e.target.value)}
                        placeholder="Enter reason for cancellation"
                        autoFocus
                    />
                    <div className="flex justify-end gap-2 mt-4">
                        <Button
                            variant="secondary"
                            onClick={() => setVoidSaleId(null)}
                            disabled={isVoiding}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            onClick={confirmVoid}
                            disabled={isVoiding || !voidReason.trim()}
                        >
                            {isVoiding ? 'Voiding...' : 'Confirm Void'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Professional Refund Modal */}
            <Modal
                isOpen={isRefundModalOpen}
                onClose={() => setIsRefundModalOpen(false)}
                title={`Process Refund - Bill #${selectedSaleForAction?.billNo}`}
                size="lg"
            >
                <div className="space-y-6">
                    <div className="bg-red-50 dark:bg-red-900/10 p-4 rounded-lg flex gap-3 items-start border border-red-100 dark:border-red-900/30">
                        <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                        <div>
                            <p className="text-sm font-bold text-red-800 dark:text-red-400 uppercase">Refund Protocol</p>
                            <p className="text-xs text-red-700 dark:text-red-500">
                                {isSingleReturnItem
                                    ? 'Returned item is auto-selected for this bill. Stock will be automatically adjusted. Refund reason is mandatory for accounting logs.'
                                    : 'Select items and quantities for return. Stock will be automatically adjusted. Refund reason is mandatory for accounting logs.'}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                        {returnItems.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center p-3 bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-xl hover:border-red-200 transition-colors">
                                <div className="flex-1">
                                    <div className="font-bold text-sm">{item.productName}</div>
                                    <div className="text-[10px] text-gray-400 uppercase font-black">{item.variantInfo}</div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-gray-400">Price: {formatIndianCurrency(item.sellingPrice)}</div>
                                        <div className="text-[10px] text-gray-500">Max Qty: {item.quantity}</div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-900 p-1 rounded-lg border border-gray-200 dark:border-gray-700">
                                        <button
                                            onClick={() => setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, refundQty: Math.max(0, it.refundQty - 1) } : it))}
                                            className="p-1 hover:bg-white rounded transition-colors"
                                        >
                                            <Minus className="w-3 h-3" />
                                        </button>
                                        <span className="w-6 text-center font-black text-sm">{item.refundQty}</span>
                                        <button
                                            onClick={() => setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, refundQty: Math.min(it.quantity, it.refundQty + 1) } : it))}
                                            className="p-1 hover:bg-white rounded transition-colors"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-700">
                        <Input
                            label="Reason for Refund"
                            placeholder="e.g. Size mismatch, defective product..."
                            value={refundReason}
                            onChange={(e) => setRefundReason(e.target.value)}
                            required
                        />
                        <div className="flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-4 rounded-2xl border-2 border-gray-100 dark:border-gray-700 shadow-inner">
                            <div className="text-gray-500 font-bold uppercase text-[10px] tracking-widest">Total Refund Amount</div>
                            <div className="text-2xl font-black text-red-600">
                                {formatIndianCurrency(returnItems.reduce((sum, it) => sum + getReturnValue(it, 'refundQty'), 0))}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="secondary" onClick={() => setIsRefundModalOpen(false)}>Cancel</Button>
                        <Button
                            variant="danger"
                            className="px-8 font-black uppercase tracking-widest text-xs"
                            disabled={!refundReason.trim() || returnItems.every(it => it.refundQty === 0)}
                            onClick={submitRefund}
                        >
                            Confirm Refund & Restock
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Professional Exchange Modal */}
            <Modal
                isOpen={isExchangeModalOpen}
                onClose={() => setIsExchangeModalOpen(false)}
                title={`Professional Exchange - Bill #${selectedSaleForAction?.billNo}`}
                size="lg"
            >
                <div className="space-y-6">
                    <div className="bg-orange-50 dark:bg-orange-900/10 p-4 rounded-lg flex gap-3 items-start border border-orange-100 dark:border-orange-900/30">
                        <ArrowLeftRight className="w-5 h-5 text-orange-600 mt-0.5" />
                        <div>
                            <p className="text-sm font-bold text-orange-800 dark:text-orange-400 uppercase">Exchange Workflow</p>
                            <p className="text-xs text-orange-700 dark:text-orange-500">
                                {isSingleReturnItem
                                    ? '1. Returned item is auto-selected. 2. Select replacement items. 3. System calculates price difference.'
                                    : '1. Select items being returned. 2. Select replacement items. 3. System calculates price difference.'}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Section A: Returns */}
                        <div className="space-y-3">
                            <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
                                <Undo2 className="w-3 h-3" /> {isSingleReturnItem ? 'Step 1: Returned Item (Auto-Selected)' : 'Step 1: Returned Items'}
                            </h4>
                            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                {returnItems.map((item, idx) => (
                                    <div key={idx} className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-orange-300">
                                        <div className="font-bold text-sm truncate">{item.productName}</div>
                                        <div className="flex justify-between items-center mt-2">
                                            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">{item.variantInfo}</span>
                                            <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-md border border-gray-100">
                                                <button onClick={() => setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, returnQty: Math.max(0, it.returnQty - 1) } : it))} className="p-0.5 hover:bg-white rounded"><Minus className="w-3 h-3" /></button>
                                                <span className="w-4 text-center text-xs font-bold">{item.returnQty}</span>
                                                <button onClick={() => setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, returnQty: Math.min(it.quantity, it.returnQty + 1) } : it))} className="p-0.5 hover:bg-white rounded"><Plus className="w-3 h-3" /></button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Section B: New Items Selector */}
                        <div className="space-y-3">
                            <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
                                <Plus className="w-3 h-3" /> Step 2: Replacement Items
                            </h4>
                            <div className="space-y-2">
                                <ReplacementProductPicker
                                    products={exchangeSelectableProducts}
                                    onSelectProduct={handleAddReplacementProduct}
                                    existingItemQuantities={replacementItemQuantities}
                                />
                                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                    {exchangeNewItems.map((item, idx) => (
                                        <div key={idx} className="p-2 bg-orange-50/50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-900/30 rounded-lg flex justify-between items-center group">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs font-bold truncate">{item.productName}</div>
                                                <div className="text-[9px] text-gray-500 uppercase">{item.variantInfo}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-1 bg-white p-1 rounded-md border border-orange-200">
                                                    <button onClick={() => setExchangeNewItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: Math.max(1, it.quantity - 1) } : it))} className="p-0.5 hover:bg-gray-100 rounded"><Minus className="w-2.5 h-2.5" /></button>
                                                    <span className="w-4 text-center text-xs font-bold">{item.quantity}</span>
                                                    <button onClick={() => setExchangeNewItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: it.quantity + 1 } : it))} className="p-0.5 hover:bg-gray-100 rounded"><Plus className="w-2.5 h-2.5" /></button>
                                                </div>
                                                <button onClick={() => setExchangeNewItems(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Summary Footer */}
                    <div className="pt-4 border-t border-dashed border-gray-200 dark:border-gray-700">
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-center p-3 rounded-xl bg-gray-50 border border-gray-100">
                                <div className="text-[10px] font-bold text-gray-400 uppercase">Returned Value</div>
                                <div className="text-sm font-black text-gray-700">
                                    {formatIndianCurrency(returnItems.reduce((sum, it) => sum + getReturnValue(it, 'returnQty'), 0))}
                                </div>
                            </div>
                            <div className="text-center p-3 rounded-xl bg-gray-50 border border-gray-100">
                                <div className="text-[10px] font-bold text-gray-400 uppercase">New Item Total</div>
                                <div className="text-sm font-black text-gray-700">
                                    {formatIndianCurrency(exchangeNewItems.reduce((sum, it) => sum + (it.sellingPrice * it.quantity), 0))}
                                </div>
                            </div>
                            <div className="text-center p-3 rounded-xl bg-blue-50 border border-blue-100">
                                <div className="text-[10px] font-bold text-blue-400 uppercase">Final Difference</div>
                                <div className={`text-lg font-black ${exchangeNewItems.reduce((sum, it) => sum + (it.sellingPrice * it.quantity), 0) - returnItems.reduce((sum, it) => sum + getReturnValue(it, 'returnQty'), 0) > 0 ? 'text-blue-700' : 'text-green-700'}`}>
                                    {formatIndianCurrency(exchangeNewItems.reduce((sum, it) => sum + (it.sellingPrice * it.quantity), 0) - returnItems.reduce((sum, it) => sum + getReturnValue(it, 'returnQty'), 0))}
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center justify-end gap-3">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                Replacement Payment
                            </label>
                            <select
                                value={replacementPaymentMethod}
                                onChange={(e) => setReplacementPaymentMethod(e.target.value as 'CASH' | 'CARD' | 'UPI')}
                                className="h-9 px-3 border-2 border-gray-200 rounded-lg text-sm font-bold bg-white dark:bg-gray-800"
                            >
                                <option value="CASH">CASH</option>
                                <option value="CARD">CARD</option>
                                <option value="UPI">UPI</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-2">
                        <div className="text-xs">
                            {returnItems.every(it => (it.returnQty || 0) === 0) ? (
                                <span className="text-amber-600 dark:text-amber-400 font-medium">
                                    ⚠️ Select at least 1 returned item (Step 1)
                                </span>
                            ) : exchangeNewItems.length === 0 ? (
                                <span className="text-amber-600 dark:text-amber-400 font-medium">
                                    ⚠️ Select at least 1 replacement item (Step 2)
                                </span>
                            ) : (
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    ✓ Ready to finalize exchange
                                </span>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <Button variant="secondary" onClick={() => setIsExchangeModalOpen(false)}>Cancel Workflow</Button>
                            <Button
                                variant="primary"
                                className="px-10 font-bold bg-orange-600 hover:bg-orange-700 shadow-lg shadow-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={exchangeNewItems.length === 0 || returnItems.every(it => (it.returnQty || 0) === 0)}
                                onClick={submitExchange}
                            >
                                Finalize Exchange
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>
            {/* Payment Mode Update Modal */}
            <Modal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                title={`Update Payment Mode - Bill #${selectedSaleForPaymentUpdate?.billNo}`}
                size="sm"
            >
                <div className="space-y-6">
                    {(() => {
                        const saleForModal = selectedSaleForPaymentUpdate;
                        const exchCreditPmt = (saleForModal?.payments || []).find((p: any) => p.paymentMode === 'EXCHANGE_CREDIT');
                        const exchCreditAmt = exchCreditPmt ? Number(exchCreditPmt.amount || 0) : 0;
                        const isRepl = isReplacementSale(saleForModal) && exchCreditAmt > 0;
                        const freshAmt = isRepl ? (saleForModal.grandTotal - exchCreditAmt) : (saleForModal?.grandTotal || 0);

                        return (
                            <div className="bg-primary-50 dark:bg-primary-900/10 p-4 rounded-lg flex gap-3 items-start border border-primary-100 dark:border-primary-900/30">
                                <CreditCard className="w-5 h-5 text-primary-600 mt-0.5" />
                                <div>
                                    <p className="text-sm font-bold text-primary-800 dark:text-primary-400 uppercase">Change Payment Method</p>
                                    {isRepl ? (
                                        <>
                                            <p className="text-xs text-primary-700 dark:text-primary-500">
                                                Bill Total: <span className="font-bold">{formatIndianCurrency(saleForModal.grandTotal)}</span>
                                            </p>
                                            <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold">
                                                Exchange Credit: -{formatIndianCurrency(exchCreditAmt)} (preserved)
                                            </p>
                                            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                                                Fresh Amount to Assign: <span className="font-black">{formatIndianCurrency(freshAmt)}</span>
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-xs text-primary-700 dark:text-primary-500">
                                            Total Bill Amount: <span className="font-bold">{formatIndianCurrency(saleForModal?.grandTotal || 0)}</span>
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    <div className="grid grid-cols-2 gap-2">
                        {['CASH', 'UPI', 'CARD', 'SPLIT'].map((m) => (
                            <button
                                key={m}
                                onClick={() => setPaymentEditData({ ...paymentEditData, method: m as any })}
                                className={`py-3 px-4 rounded-xl border-2 font-black transition-all ${paymentEditData.method === m
                                    ? 'border-primary-600 bg-primary-600 text-white shadow-lg shadow-primary-200'
                                    : 'border-gray-100 bg-white text-gray-400 hover:border-gray-300'}`}
                            >
                                {m}
                            </button>
                        ))}
                    </div>

                    {paymentEditData.method === 'SPLIT' && (
                        <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-inner">
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-gray-400 ml-1">Cash Amount</label>
                                    <Input
                                        type="number"
                                        value={paymentEditData.cashAmount}
                                        onChange={(e) => setPaymentEditData({ ...paymentEditData, cashAmount: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-gray-400 ml-1">UPI Amount</label>
                                    <Input
                                        type="number"
                                        value={paymentEditData.upiAmount}
                                        onChange={(e) => setPaymentEditData({ ...paymentEditData, upiAmount: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-gray-400 ml-1">Card Amount</label>
                                    <Input
                                        type="number"
                                        value={paymentEditData.cardAmount}
                                        onChange={(e) => setPaymentEditData({ ...paymentEditData, cardAmount: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>

                            <div className={`mt-4 pt-3 border-t border-dashed flex justify-between items-center ${(() => {
                                const saleM = selectedSaleForPaymentUpdate;
                                const ecAmt = (saleM?.payments || []).find((p: any) => p.paymentMode === 'EXCHANGE_CREDIT');
                                const ecVal = ecAmt ? Number(ecAmt.amount || 0) : 0;
                                const isR = isReplacementSale(saleM) && ecVal > 0;
                                const target = isR ? (saleM.grandTotal - ecVal) : (saleM?.grandTotal || 0);
                                return Math.abs(((parseFloat(paymentEditData.cashAmount) || 0) + (parseFloat(paymentEditData.upiAmount) || 0) + (parseFloat(paymentEditData.cardAmount) || 0)) - target) < 0.01
                                    ? 'border-green-200 text-green-600' : 'border-red-200 text-red-600';
                            })()}`}>
                                <span className="text-xs font-bold uppercase">Current Sum:</span>
                                <span className="text-lg font-black">
                                    {formatIndianCurrency((parseFloat(paymentEditData.cashAmount) || 0) + (parseFloat(paymentEditData.upiAmount) || 0) + (parseFloat(paymentEditData.cardAmount) || 0))}
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-3">
                        <Button variant="secondary" onClick={() => setIsPaymentModalOpen(false)}>Cancel</Button>
                        <Button
                            variant="primary"
                            className="px-8 font-black uppercase"
                            disabled={(() => {
                                if (isSavingPayment) return true;
                                if (paymentEditData.method !== 'SPLIT') return false;
                                const saleM = selectedSaleForPaymentUpdate;
                                const ecAmt = (saleM?.payments || []).find((p: any) => p.paymentMode === 'EXCHANGE_CREDIT');
                                const ecVal = ecAmt ? Number(ecAmt.amount || 0) : 0;
                                const isR = isReplacementSale(saleM) && ecVal > 0;
                                const target = isR ? (saleM.grandTotal - ecVal) : (saleM?.grandTotal || 0);
                                return Math.abs(((parseFloat(paymentEditData.cashAmount) || 0) + (parseFloat(paymentEditData.upiAmount) || 0) + (parseFloat(paymentEditData.cardAmount) || 0)) - target) > 0.01;
                            })()}
                            onClick={submitPaymentUpdate}
                        >
                            {isSavingPayment ? 'Updating...' : 'Confirm Update'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div >
    );
};
