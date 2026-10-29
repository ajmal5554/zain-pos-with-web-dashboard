import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Edit, Trash2, Printer, Search, ArrowUp, ArrowDown, Tag, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { db } from '../lib/db';
import { useAuthStore } from '../store/authStore';
import { StickerPrintModal } from '../components/ui/StickerPrintModal';
import { Skeleton } from '../components/ui/Skeleton';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { showToast } from '../components/ui/Toast';
import {
    formatVariantDescription,
    normalizeText,
    getCategoryGarmentFields,
} from '../lib/catalogueDescription';

const getVariantAttributesSummary = (productName: string, variant: any): string => {
    let raw = formatVariantDescription('', variant);
    if (!raw || raw === 'Standard Garment') {
        raw = variant?.formattedDescription || '';
    }
    if (!raw) return '';
    const nameNorm = (productName || '').trim().toLowerCase();
    if (nameNorm && raw.toLowerCase().startsWith(nameNorm)) {
        raw = raw.slice(nameNorm.length).replace(/^[\s|•\-]+/, '').trim();
    }
    if (variant?.barcode && raw.startsWith(variant.barcode)) {
        raw = raw.slice(variant.barcode.length).replace(/^[\s|•\-]+/, '').trim();
    }
    const parts = raw.split(/\s*\|\s*/).map(p => p.trim()).filter(Boolean);
    const filtered = parts.filter(p => p.toLowerCase() !== nameNorm);
    return filtered.join(' • ');
};

export const Products: React.FC = () => {
    type NumberInput = number | '';

    type VariantForm = {
        id: string; // Stable ID: existing DB ID or temp-*
        sku: string;
        barcode: string;
        size: string;
        color: string;
        brand: string;
        fabric: string;
        quality: string;
        pattern: string;
        sleeve: string;
        fit: string;
        collar: string;
        pocket: string;
        styleRef: string;
        isPrepared: boolean;
        mrp: NumberInput;
        sellingPrice: NumberInput;
        costPrice: NumberInput;
        stock: number; // Informational / read-only
        minStock: NumberInput;
        isActive: boolean;
    };

    type ProductForm = {
        name: string;
        categoryId: string;
        hsn: string;
        taxRate: NumberInput;
        variants: VariantForm[];
    };

    const { user } = useAuthStore();
    const [products, setProducts] = useState<any[]>([]);
    const [categories, setCategories] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'itemNumber' | 'alphabetical' | 'updatedAt'>('updatedAt');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [showModal, setShowModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState<any>(null);
    const [showStickerModal, setShowStickerModal] = useState(false);
    const [selectedVariant, setSelectedVariant] = useState<any>(null);
    const [selectedProduct, setSelectedProduct] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [editLoading, setEditLoading] = useState(false);
    const [editError, setEditError] = useState('');
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [generatingCodes, setGeneratingCodes] = useState<Set<string>>(new Set());
    const loadRevision = useRef(0);
    const categoriesLoaded = useRef(false);
    const hasLoadedProducts = useRef(false);
    const editRevision = useRef(0);
    const editInFlight = useRef<string | null>(null);
    const saveInFlight = useRef(false);
    const barcodeRequests = useRef(new Set<string>());
    const saveRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);
    const canPrintLabels = user?.role === 'ADMIN' || Boolean(user?.permPrintSticker);

    const createEmptyVariant = (): VariantForm => ({
        id: `temp-${crypto.randomUUID()}`,
        sku: '',
        barcode: '',
        size: '',
        color: '',
        brand: '',
        fabric: '',
        quality: '',
        pattern: '',
        sleeve: '',
        fit: '',
        collar: '',
        pocket: '',
        styleRef: '',
        isPrepared: true, // New preparation variants default to conversion pending
        mrp: 0,
        sellingPrice: 0,
        costPrice: 0,
        stock: 0,
        minStock: 5,
        isActive: true,
    });

    const [formData, setFormData] = useState<ProductForm>(() => ({
        name: '',
        categoryId: '',
        hsn: '',
        taxRate: 5,
        variants: [createEmptyVariant()],
    }));

    const parseNumberInput = (raw: string, isInt = false): NumberInput => {
        if (raw.trim() === '') return '';
        const parsed = isInt ? parseInt(raw, 10) : parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : '';
    };

    const toNumber = (value: NumberInput, fallback = 0): number => {
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };

    useEffect(() => {
        if (!user) return;
        const timer = window.setTimeout(() => void loadData(), searchQuery.trim() ? 250 : 0);
        return () => {
            window.clearTimeout(timer);
            loadRevision.current++;
        };
    }, [searchQuery, user?.id]);

    useEffect(() => () => {
        editRevision.current++;
        editInFlight.current = null;
    }, [user?.id]);

    const loadData = async () => {
        const revision = ++loadRevision.current;
        try {
            if (!hasLoadedProducts.current) setLoading(true);
            setLoadError('');

            let where: any = { isActive: true };
            const tokens = searchQuery.trim().split(/\s+/).filter(Boolean);
            if (tokens.length > 0) {
                where = {
                    isActive: true,
                    AND: tokens.map((token) => ({
                        OR: [
                            { name: { contains: token } },
                            { category: { name: { contains: token } } },
                            { variants: { some: { barcode: { contains: token }, isActive: true } } },
                            { variants: { some: { sku: { contains: token }, isActive: true } } },
                        ],
                    })),
                };
            }

            if (!window.electronAPI?.catalogue?.listProducts) {
                throw new Error('Catalogue service is unavailable. Restart the app and try again.');
            }
            const [res, categoriesData] = await Promise.all([
                window.electronAPI.catalogue.listProducts({
                    where,
                    orderBy: { updatedAt: 'desc' },
                    summary: true,
                    userId: user?.id,
                }),
                categoriesLoaded.current ? Promise.resolve(null) : db.categories.findMany({}),
            ]);
            if (!res?.success || !Array.isArray(res.data)) {
                throw new Error(res?.error || 'The catalogue returned an invalid response.');
            }
            if (categoriesData !== null && !Array.isArray(categoriesData)) throw new Error('Could not load categories.');
            if (revision !== loadRevision.current) return;
            setProducts(res.data);
            if (categoriesData !== null) {
                setCategories(categoriesData);
                categoriesLoaded.current = true;
            }
            hasLoadedProducts.current = true;
        } catch (error) {
            if (revision !== loadRevision.current) return;
            console.error('Failed to load products data:', error);
            const message = 'Failed to load products: ' + (error as Error).message;
            if (hasLoadedProducts.current) showToast(message, 'error');
            else setLoadError(message);
        } finally {
            if (revision === loadRevision.current) setLoading(false);
        }
    };

    // Category garment fields config
    const selectedCategoryName = useMemo(() => {
        const cat = categories.find((c) => c.id === formData.categoryId);
        return cat?.name || '';
    }, [categories, formData.categoryId]);

    const activeGarmentFields = useMemo(() => {
        return getCategoryGarmentFields(selectedCategoryName);
    }, [selectedCategoryName]);

    const generateSequentialBarcode = async (variantId: string) => {
        const target = formData.variants.find((v) => v.id === variantId);
        if (!target || !target.id.startsWith('temp-') || barcodeRequests.current.has(variantId)) return;
        barcodeRequests.current.add(variantId);
        setGeneratingCodes(new Set(barcodeRequests.current));
        try {
            if (!window.electronAPI?.catalogue?.generateBarcode) throw new Error('Barcode service is unavailable.');
            const result = await window.electronAPI.catalogue.generateBarcode({
                draftId: variantId,
                excludeCodes: formData.variants.filter((v) => v.id !== variantId).map((v) => v.barcode).filter(Boolean),
                userId: user?.id,
            });
            if (!result?.success || typeof result.data?.barcode !== 'string') {
                throw new Error(result?.error || 'Could not reserve a barcode.');
            }
            const next = result.data.barcode;
            setFormData((prev) => ({
                ...prev,
                variants: prev.variants.map((v) => (v.id === variantId ? { ...v, barcode: next } : v)),
            }));
            showToast(`Generated barcode: ${next}`, 'info');
        } catch (error) {
            console.error('Failed to generate sequential barcode:', error);
            showToast((error as Error).message || 'Failed to generate barcode', 'error');
        } finally {
            barcodeRequests.current.delete(variantId);
            setGeneratingCodes(new Set(barcodeRequests.current));
        }
    };

    const addVariant = () => {
        setFormData((prev) => ({
            ...prev,
            variants: [...prev.variants, createEmptyVariant()],
        }));
    };

    const removeVariant = (id: string) => {
        if (formData.variants.length <= 1) {
            showToast('A product must have at least one variant.', 'warning');
            return;
        }

        const target = formData.variants.find((v) => v.id === id);
        if (target && !target.id.startsWith('temp-')) {
            showToast('Existing variants stay attached to their history. Add a new variant for a different garment.', 'warning');
            return;
        }

        setFormData((prev) => ({
            ...prev,
            variants: prev.variants.filter((v) => v.id !== id),
        }));
    };

    const moveVariant = (index: number, direction: 'up' | 'down') => {
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= formData.variants.length) return;

        setFormData((prev) => {
            const nextVariants = [...prev.variants];
            const temp = nextVariants[index];
            nextVariants[index] = nextVariants[targetIndex];
            nextVariants[targetIndex] = temp;
            return { ...prev, variants: nextVariants };
        });
    };

    const updateVariantField = (id: string, key: keyof VariantForm, value: any) => {
        if (key === 'isPrepared') return;
        if ((key === 'barcode' || key === 'sku') && !id.startsWith('temp-')) return;
        setFormData((prev) => ({
            ...prev,
            variants: prev.variants.map((v) => (v.id === id ? { ...v, [key]: value } : v)),
        }));
    };

    const resetForm = () => {
        editRevision.current++;
        editInFlight.current = null;
        setEditLoading(false);
        setEditError('');
        saveRequest.current = null;
        setFormData({
            name: '',
            categoryId: categories[0]?.id || '',
            hsn: '',
            taxRate: 5,
            variants: [createEmptyVariant()],
        });
        setEditingProduct(null);
    };

    const handleEditProduct = async (product: any) => {
        if (saveInFlight.current || editInFlight.current === product.id) return;
        const revision = ++editRevision.current;
        editInFlight.current = product.id;
        saveRequest.current = null;
        setEditingProduct(product);
        setEditError('');
        setEditLoading(true);
        setShowModal(true);
        try {
            if (!window.electronAPI?.catalogue?.getProduct) throw new Error('Catalogue service is unavailable.');
            const res = await window.electronAPI.catalogue.getProduct(product.id, user?.id);
            if (revision !== editRevision.current) return;
            if (!res?.success || res.data?.id !== product.id || !Array.isArray(res.data.variants)) {
                throw new Error(res?.error || 'Could not load the complete product.');
            }
            const fullProduct = res.data;
            saveRequest.current = null;

            setEditingProduct(fullProduct);
            setFormData({
                name: fullProduct.name || '',
                categoryId: fullProduct.categoryId || '',
                hsn: fullProduct.hsn || '',
                taxRate: fullProduct.taxRate ?? 5,
                variants: (fullProduct.variants || []).map((v: any) => ({
                    id: v.id,
                    sku: v.sku || '',
                    barcode: v.barcode || '',
                    size: v.size || '',
                    color: v.color || '',
                    brand: v.brand || '',
                    fabric: v.fabric || '',
                    quality: v.quality || '',
                    pattern: v.pattern || '',
                    sleeve: v.sleeve || '',
                    fit: v.fit || '',
                    collar: v.collar || '',
                    pocket: v.pocket || '',
                    styleRef: v.styleRef || '',
                    isPrepared: Boolean(v.isPrepared),
                    mrp: v.mrp ?? 0,
                    sellingPrice: v.sellingPrice ?? 0,
                    costPrice: v.costPrice ?? 0,
                    stock: v.stock ?? 0,
                    minStock: v.minStock ?? 5,
                    isActive: v.isActive !== false,
                })),
            });
        } catch (err: any) {
            if (revision !== editRevision.current) return;
            console.error('Failed to load full product for edit:', err);
            setEditError('Failed to load product details: ' + err.message);
        } finally {
            if (revision === editRevision.current) {
                editInFlight.current = null;
                setEditLoading(false);
            }
        }
    };

    const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
    const [duplicateNameConfirmOpen, setDuplicateNameConfirmOpen] = useState(false);

    const executeSaveProduct = async () => {
        if (editLoading || editError || saveInFlight.current) return;
        saveInFlight.current = true;
        try {
            setSaving(true);

            // Prepare payload
            const payload = {
                id: editingProduct?.id,
                userId: user?.id,
                name: normalizeText(formData.name),
                categoryId: formData.categoryId,
                hsn: normalizeText(formData.hsn) || null,
                taxRate: toNumber(formData.taxRate, 5),
                updatedAt: editingProduct?.updatedAt, // For optimistic concurrency
                variants: formData.variants.map((v) => ({
                    id: v.id,
                    barcodeDraftId: v.id.startsWith('temp-') ? v.id : undefined,
                    ...(v.id.startsWith('temp-') ? {
                        sku: v.sku ? String(v.sku).trim() : undefined,
                        barcode: v.barcode ? String(v.barcode).trim() : undefined,
                    } : {}),
                    size: normalizeText(v.size),
                    color: normalizeText(v.color),
                    brand: normalizeText(v.brand),
                    fabric: normalizeText(v.fabric),
                    quality: normalizeText(v.quality),
                    pattern: normalizeText(v.pattern),
                    sleeve: normalizeText(v.sleeve),
                    fit: normalizeText(v.fit),
                    collar: normalizeText(v.collar),
                    pocket: normalizeText(v.pocket),
                    styleRef: normalizeText(v.styleRef),
                    mrp: toNumber(v.mrp),
                    sellingPrice: toNumber(v.sellingPrice),
                    ...(user?.role === 'ADMIN' || user?.permViewCostPrice ? { costPrice: toNumber(v.costPrice) } : {}),
                    minStock: toNumber(v.minStock, 5),
                    isActive: v.isActive,
                })),
            };
            const fingerprint = JSON.stringify(payload);
            if (!saveRequest.current || saveRequest.current.fingerprint !== fingerprint) {
                saveRequest.current = { fingerprint, requestId: crypto.randomUUID() };
            }

            // Call atomic catalogue service
            let result: any;
            if (window.electronAPI?.catalogue?.saveProduct) {
                result = await window.electronAPI.catalogue.saveProduct({ ...payload, requestId: saveRequest.current.requestId });
            } else {
                // Fallback for isolated web mock
                showToast('Electron catalogue API not detected', 'error');
                return;
            }

            if (!result?.success) {
                throw new Error(result?.error || 'Save failed');
            }

            setShowModal(false);
            resetForm();
            loadData();
            showToast(editingProduct ? 'Product updated successfully!' : 'Product created successfully!', 'success');
        } catch (error: any) {
            console.error('Failed to save product:', error);
            showToast(error.message || 'Failed to save product', 'error', 6000);
        } finally {
            saveInFlight.current = false;
            setSaving(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (editLoading || editError || saveInFlight.current) return;

        try {
            // 1. Check for duplicates within current form variants
            const formBarcodes = formData.variants
                .map((v) => (v.barcode != null ? String(v.barcode).trim() : ''))
                .filter(Boolean);

            const hasDraftDuplicates = new Set(formBarcodes).size !== formBarcodes.length;
            if (hasDraftDuplicates) {
                showToast('Duplicate barcodes found within your variants. Each variant must have a unique code.', 'error');
                return;
            }

            // 2. Cross-check for duplicate product name (warn only)
            const existingName = await db.products.findFirst({
                where: {
                    name: { equals: normalizeText(formData.name) },
                    ...(editingProduct ? { id: { not: editingProduct.id } } : {}),
                },
            });

            if (existingName) {
                setDuplicateNameConfirmOpen(true);
                return;
            }

            await executeSaveProduct();
        } catch (err: any) {
            showToast('Validation failed: ' + err.message, 'error');
        }
    };

    const confirmDeleteProduct = async () => {
        if (!deleteTarget) return;
        try {
            // Soft delete to avoid breaking sales history
            await db.productVariants.updateMany({
                where: { productId: deleteTarget.id },
                data: { isActive: false },
            });

            await db.products.update({
                where: { id: deleteTarget.id },
                data: { isActive: false },
            });

            loadData();
            showToast(`Product "${deleteTarget.name}" deleted successfully`, 'success');
        } catch (error) {
            console.error('Failed to delete product:', error);
            showToast('Failed to delete product. Error: ' + (error as Error).message, 'error');
        } finally {
            setDeleteTarget(null);
        }
    };

    const handlePrintLabel = async (variant: any, product: any) => {
        if (!canPrintLabels) {
            showToast('Permission denied: you cannot print labels.', 'warning');
            return;
        }
        if (!product?.id || !variant?.id || variant.id.startsWith('temp-')) {
            showToast('Save the product, then select its label from the catalogue.', 'warning');
            return;
        }
        try {
            const res = await window.electronAPI.catalogue.getProduct(product.id, user?.id);
            if (!res?.success || !Array.isArray(res.data?.variants)) throw new Error(res?.error || 'Could not load the saved label.');
            const savedVariant = res.data.variants.find((v: any) => v.id === variant.id);
            if (!savedVariant) throw new Error('This variant is no longer available. Refresh the catalogue.');
            setSelectedVariant(savedVariant);
            setSelectedProduct(res.data);
            setShowStickerModal(true);
        } catch (error) {
            showToast((error as Error).message, 'error');
        }
    };

    const filteredProducts = useMemo(() => {
        const list = [...products];
        const dir = sortDirection === 'asc' ? 1 : -1;

        list.sort((a: any, b: any) => {
            if (sortBy === 'alphabetical') {
                return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }) * dir;
            }

            if (sortBy === 'itemNumber') {
                const aCode = (a?.variants?.[0]?.barcode || '').toString();
                const bCode = (b?.variants?.[0]?.barcode || '').toString();
                return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' }) * dir;
            }

            const aTime = new Date(a.updatedAt || 0).getTime();
            const bTime = new Date(b.updatedAt || 0).getTime();
            return (aTime - bTime) * dir;
        });

        return list;
    }, [products, sortBy, sortDirection]);


    if (!user) return <div className="p-8 text-center text-gray-500">Authenticating...</div>;

    if (user.role !== 'ADMIN' && !user.permManageProducts) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4">
                <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full">
                    <Plus className="w-12 h-12" />
                </div>
                <h1 className="text-2xl font-bold">Access Denied</h1>
                <p className="text-gray-500 max-w-md">
                    You do not have permission to manage products.
                    Please contact your administrator to request access.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap justify-between items-center gap-3">
                <div className="flex-1 min-w-[280px] max-w-md">
                    <div className="relative">
                        <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                        <Input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search products, categories or codes..."
                            className="pl-10"
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
                        title="Sort by"
                    >
                        <option value="updatedAt">Updated At</option>
                        <option value="itemNumber">Item Number</option>
                        <option value="alphabetical">Alphabetical</option>
                    </select>
                    <select
                        value={sortDirection}
                        onChange={(e) => setSortDirection(e.target.value as any)}
                        className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
                        title="Order"
                    >
                        <option value="desc">Descending</option>
                        <option value="asc">Ascending</option>
                    </select>
                    {(user?.role === 'ADMIN' || user?.permManageProducts) && (
                        <Button
                            variant="primary"
                            onClick={() => {
                                resetForm();
                                setShowModal(true);
                            }}
                        >
                            <Plus className="w-5 h-5" />
                            Add Product
                        </Button>
                    )}
                </div>
            </div>

            {/* Products Table */}
            <div className="card !p-0 border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="border-b border-gray-200 dark:border-dark-border bg-gray-50/80 dark:bg-dark-bg/60">
                            <tr>
                                <th className="pl-4 pr-2 py-3 text-left text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 w-12 whitespace-nowrap">Sl No</th>
                                <th className="px-3 py-3 text-left text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 w-24 whitespace-nowrap">Code</th>
                                <th className="px-3 py-3 text-left text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 min-w-[180px]">Product</th>
                                <th className="px-3 py-3 text-left text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 w-24 whitespace-nowrap">Category</th>
                                <th className="px-3 py-3 text-left text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 w-28 whitespace-nowrap">MRP / Price</th>
                                <th className="px-3 py-3 text-center text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 w-16 whitespace-nowrap">Stock</th>
                                <th className="px-3 py-3 text-center text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 w-14 whitespace-nowrap">Tax %</th>
                                <th className="pr-4 pl-2 py-3 text-right text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 w-28 whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, index) => (
                                    <tr key={index}>
                                        <td className="pl-4 pr-2 py-3"><Skeleton className="h-4 w-6" /></td>
                                        <td className="px-3 py-3"><Skeleton className="h-4 w-16" /></td>
                                        <td className="px-3 py-3"><Skeleton className="h-4 w-40" /></td>
                                        <td className="px-3 py-3"><Skeleton className="h-4 w-16" /></td>
                                        <td className="px-3 py-3"><Skeleton className="h-4 w-20" /></td>
                                        <td className="px-3 py-3 text-center"><Skeleton className="h-4 w-8 mx-auto" /></td>
                                        <td className="px-3 py-3 text-center"><Skeleton className="h-4 w-8 mx-auto" /></td>
                                        <td className="pr-4 pl-2 py-3 text-right"><Skeleton className="h-7 w-20 ml-auto" /></td>
                                    </tr>
                                ))
                            ) : loadError ? (
                                <tr><td colSpan={8} className="text-center py-8">
                                    <p role="alert" className="text-red-600 dark:text-red-400 mb-3">{loadError}</p>
                                    <Button variant="secondary" onClick={() => void loadData()}>Retry</Button>
                                </td></tr>
                            ) : filteredProducts.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="text-center py-8 text-gray-500">
                                        No products found
                                    </td>
                                </tr>
                            ) : (
                                filteredProducts.map((product, index) => {
                                    const primaryVariant = product.variants?.[0];
                                    const hasPreparedVariant = product.hasPreparedVariant ?? (product.variants || []).some((v: any) => v.isPrepared);
                                    const totalStock = Number.isFinite(Number(product.totalStock))
                                        ? Number(product.totalStock)
                                        : (product.variants || []).reduce((sum: number, v: any) => sum + (v.stock || 0), 0);
                                    const primaryBarcode = primaryVariant?.barcode || primaryVariant?.sku || '-';
                                    const attrs = primaryVariant ? getVariantAttributesSummary(product.name, primaryVariant) : '';

                                    return (
                                        <tr key={product.id} className="hover:bg-gray-50/80 dark:hover:bg-dark-bg/40 transition-colors">
                                            <td className="pl-4 pr-2 py-3 text-gray-400 text-xs font-mono whitespace-nowrap">{index + 1}</td>
                                            <td className="px-3 py-3 whitespace-nowrap">
                                                <div className="font-mono text-xs font-bold text-gray-700 dark:text-gray-300">
                                                    {primaryBarcode}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 min-w-0">
                                                <div className="font-medium text-sm text-gray-900 dark:text-white flex items-center gap-2">
                                                    <span className="truncate">{product.name}</span>
                                                    {hasPreparedVariant && (
                                                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 rounded whitespace-nowrap shrink-0">
                                                            Conversion in Progress
                                                        </span>
                                                    )}
                                                </div>
                                                {attrs ? (
                                                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate" title={attrs}>
                                                        {attrs}
                                                    </div>
                                                ) : null}
                                            </td>
                                            <td className="px-3 py-3 whitespace-nowrap">
                                                <span className="badge badge-secondary">
                                                    {product.category?.name || '-'}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 whitespace-nowrap">
                                                <div className="text-xs font-bold font-mono text-gray-900 dark:text-white">
                                                    ₹{primaryVariant?.sellingPrice || 0}
                                                </div>
                                                <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                                                    {primaryVariant?.mrp && primaryVariant.mrp > (primaryVariant.sellingPrice || 0) ? (
                                                        <span>MRP: <span className="line-through">₹{primaryVariant.mrp}</span></span>
                                                    ) : primaryVariant?.mrp ? (
                                                        <span>MRP: ₹{primaryVariant.mrp}</span>
                                                    ) : (
                                                        <span>MRP: ₹{primaryVariant?.sellingPrice || 0}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-center whitespace-nowrap">
                                                <span className={`inline-block min-w-[28px] text-xs font-bold font-mono px-2 py-0.5 rounded ${
                                                    totalStock > 0
                                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                                }`}>
                                                    {totalStock}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">
                                                {product.taxRate}%
                                            </td>
                                            <td className="pr-4 pl-2 py-3 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    {canPrintLabels && (
                                                        <Button
                                                            variant="secondary"
                                                            size="sm"
                                                            onClick={() => {
                                                                if (primaryVariant) {
                                                                    handlePrintLabel(primaryVariant, product);
                                                                } else {
                                                                    showToast('No product data found to print label.', 'warning');
                                                                }
                                                            }}
                                                            title="Print Barcode Label"
                                                            className="p-1.5 text-gray-600 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400"
                                                        >
                                                            <Printer className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => handleEditProduct(product)}
                                                        title="Edit Product"
                                                        className="p-1.5 text-gray-600 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </Button>
                                                    {user?.permDeleteProduct && (
                                                        <Button
                                                            variant="danger"
                                                            size="sm"
                                                            onClick={() => setDeleteTarget(product)}
                                                            title="Delete Product"
                                                            className="p-1.5"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Table Summary Footer */}
                <div className="px-4 py-3 border-t border-gray-100 dark:border-dark-border bg-gray-50/50 dark:bg-dark-bg/20 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium">
                        {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
                    </span>
                    <span className="text-gray-400 text-[11px]">
                        Showing active catalogue items
                    </span>
                </div>
            </div>

            {/* Product Edit / Create Modal */}
            <Modal
                isOpen={showModal}
                onClose={() => {
                    if (!saving && !saveInFlight.current) {
                        setShowModal(false);
                        resetForm();
                    }
                }}
                title={editingProduct ? `Edit Product: ${editingProduct.name}` : 'Add New Product'}
                size="lg"
            >
                {editLoading ? (
                    <div role="status" aria-live="polite" className="min-h-[240px] flex flex-col items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
                        <RefreshCw className="w-6 h-6 animate-spin text-primary-600" aria-hidden="true" />
                        <p>Loading product details…</p>
                    </div>
                ) : editError ? (
                    <div className="min-h-[240px] flex flex-col items-center justify-center gap-4 text-center">
                        <p role="alert" className="text-red-600 dark:text-red-400">{editError}</p>
                        <Button type="button" variant="secondary" onClick={() => void handleEditProduct(editingProduct)}>
                            <RefreshCw className="w-4 h-4" /> Retry
                        </Button>
                    </div>
                ) : showModal ? (() => {
                    const variant = formData.variants[0] || createEmptyVariant();
                    return (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Product Name & Category */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Input
                                    label="Product Name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Crazy Heart - Plain - L"
                                    required
                                />

                                <Select
                                    label="Category"
                                    value={formData.categoryId}
                                    onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                                    options={[
                                        { value: '', label: 'Select Category' },
                                        ...categories.map((c) => ({ value: c.id, label: c.name })),
                                    ]}
                                    required
                                />
                            </div>

                            {/* Barcode & SKU */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative">
                                    <Input
                                        label="Barcode (Preserves leading zeros)"
                                        value={variant.barcode || ''}
                                        readOnly={!variant.id.startsWith('temp-')}
                                        disabled={generatingCodes.has(variant.id)}
                                        onChange={(e) => updateVariantField(variant.id, 'barcode', e.target.value)}
                                        placeholder="e.g. 0012345 or 1001"
                                    />
                                    <button
                                        type="button"
                                        disabled={!variant.id.startsWith('temp-') || generatingCodes.has(variant.id)}
                                        onClick={() => generateSequentialBarcode(variant.id)}
                                        className="absolute right-2 top-[34px] px-2 py-0.5 text-xs bg-primary-100 text-primary-700 rounded hover:bg-primary-200 disabled:opacity-40"
                                        title="Generate next sequential unique code"
                                    >
                                        {generatingCodes.has(variant.id) ? 'Generating...' : 'Generate Code'}
                                    </button>
                                </div>

                                <Input
                                    label="SKU / Internal Reference"
                                    value={variant.sku || ''}
                                    readOnly={!variant.id.startsWith('temp-')}
                                    onChange={(e) => updateVariantField(variant.id, 'sku', e.target.value)}
                                    placeholder="e.g. SH-CH-XL-01"
                                />
                            </div>

                            {/* HSN & Tax Rate */}
                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label="HSN Code"
                                    value={formData.hsn}
                                    onChange={(e) => setFormData({ ...formData, hsn: e.target.value })}
                                    placeholder="e.g. 6205"
                                />
                                <Input
                                    label="Tax Rate (%)"
                                    type="number"
                                    value={formData.taxRate}
                                    onChange={(e) =>
                                        setFormData({ ...formData, taxRate: parseNumberInput(e.target.value) })
                                    }
                                    step="0.01"
                                    required
                                />
                            </div>

                            {/* Garment Specifications */}
                            <div className="border-t border-gray-100 dark:border-dark-border pt-3">
                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                    Garment Specifications
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <Input
                                        label="Size"
                                        value={variant.size}
                                        onChange={(e) => updateVariantField(variant.id, 'size', e.target.value)}
                                        placeholder="e.g. XL, 38, 42"
                                    />
                                    <Input
                                        label="Brand"
                                        value={variant.brand}
                                        onChange={(e) => updateVariantField(variant.id, 'brand', e.target.value)}
                                        placeholder="e.g. Crazy Heart"
                                    />
                                    <Input
                                        label="Fabric"
                                        value={variant.fabric}
                                        onChange={(e) => updateVariantField(variant.id, 'fabric', e.target.value)}
                                        placeholder="e.g. Cotton, Linen"
                                    />
                                    <Input
                                        label="Quality / Weave"
                                        value={variant.quality}
                                        onChange={(e) => updateVariantField(variant.id, 'quality', e.target.value)}
                                        placeholder="e.g. Oxford, Twill"
                                    />
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                                    <Input
                                        label="Pattern / Design"
                                        value={variant.pattern}
                                        onChange={(e) => updateVariantField(variant.id, 'pattern', e.target.value)}
                                        placeholder="e.g. Checks, Plain"
                                    />

                                    {activeGarmentFields.optional.includes('sleeve') && (
                                        <Input
                                            label="Sleeve"
                                            value={variant.sleeve}
                                            onChange={(e) => updateVariantField(variant.id, 'sleeve', e.target.value)}
                                            placeholder="e.g. Full Sleeve"
                                        />
                                    )}

                                    {activeGarmentFields.optional.includes('fit') && (
                                        <Input
                                            label="Fit"
                                            value={variant.fit}
                                            onChange={(e) => updateVariantField(variant.id, 'fit', e.target.value)}
                                            placeholder="e.g. Slim Fit"
                                        />
                                    )}

                                    {activeGarmentFields.optional.includes('collar') && (
                                        <Input
                                            label="Collar"
                                            value={variant.collar}
                                            onChange={(e) => updateVariantField(variant.id, 'collar', e.target.value)}
                                            placeholder="e.g. Spread, Mand"
                                        />
                                    )}

                                    {activeGarmentFields.optional.includes('pocket') && (
                                        <Input
                                            label="Pocket"
                                            value={variant.pocket}
                                            onChange={(e) => updateVariantField(variant.id, 'pocket', e.target.value)}
                                            placeholder="e.g. Single, None"
                                        />
                                    )}

                                    <Input
                                        label="Style / Model Ref"
                                        value={variant.styleRef}
                                        onChange={(e) => updateVariantField(variant.id, 'styleRef', e.target.value)}
                                        placeholder="e.g. 700 / Premium"
                                    />
                                </div>
                            </div>

                            {/* Pricing & Stock Fields */}
                            <div className="border-t border-gray-100 dark:border-dark-border pt-3">
                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                    Pricing & Stock
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <Input
                                        label="MRP (₹)"
                                        type="number"
                                        value={variant.mrp}
                                        onChange={(e) => updateVariantField(variant.id, 'mrp', parseNumberInput(e.target.value))}
                                        step="0.01"
                                        required
                                    />
                                    <Input
                                        label="Selling Price (₹)"
                                        type="number"
                                        value={variant.sellingPrice}
                                        onChange={(e) => updateVariantField(variant.id, 'sellingPrice', parseNumberInput(e.target.value))}
                                        step="0.01"
                                        required
                                    />
                                    {(user?.role === 'ADMIN' || user?.permViewCostPrice) && (
                                        <Input
                                            label="Cost Price (₹)"
                                            type="number"
                                            value={variant.costPrice}
                                            onChange={(e) => updateVariantField(variant.id, 'costPrice', parseNumberInput(e.target.value))}
                                            step="0.01"
                                        />
                                    )}
                                    <div>
                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            Stock Balance
                                        </label>
                                        <input
                                            type="text"
                                            readOnly
                                            disabled
                                            value={variant.isPrepared ? '0 (Uncounted)' : `${variant.stock} (Live)`}
                                            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border rounded-lg text-sm text-gray-500 cursor-not-allowed"
                                            title="Add stock or change counts on the Stock page. Products manages item details and labels."
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-dark-border">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={saving}
                                    onClick={() => {
                                        setShowModal(false);
                                        resetForm();
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" variant="primary" disabled={saving} className="px-5">
                                    {saving ? 'Saving...' : editingProduct ? 'Update Product' : 'Create Product'}
                                </Button>
                            </div>
                        </form>
                    );
                })() : null}
            </Modal>

            {/* Sticker Print Modal */}
            <StickerPrintModal
                isOpen={showStickerModal}
                onClose={() => {
                    setShowStickerModal(false);
                    setSelectedVariant(null);
                    setSelectedProduct(null);
                }}
                product={selectedProduct}
                variant={selectedVariant}
            />

            {/* Delete Product Confirmation */}
            <ConfirmDialog
                isOpen={!!deleteTarget}
                title="Delete Product"
                message={`Are you sure you want to deactivate "${deleteTarget?.name}"? Its historical sales and movements will remain preserved.`}
                confirmText="Deactivate"
                confirmVariant="danger"
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDeleteProduct}
            />

            {/* Duplicate Product Name Confirmation */}
            <ConfirmDialog
                isOpen={duplicateNameConfirmOpen}
                title="Duplicate Product Name"
                message={`An item named "${formData.name}" already exists in your inventory. Are you sure you want to create a duplicate entry? It is recommended to use unique names for better reporting.`}
                confirmText="Continue with Duplicate"
                confirmVariant="warning"
                onClose={() => setDuplicateNameConfirmOpen(false)}
                onConfirm={async () => {
                    setDuplicateNameConfirmOpen(false);
                    await executeSaveProduct();
                }}
            />
        </div>
    );
};
