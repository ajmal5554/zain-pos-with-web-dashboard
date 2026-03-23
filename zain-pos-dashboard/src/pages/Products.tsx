import { useEffect, useMemo, useState } from 'react';
import { Edit, PackageSearch, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { productService, type ManagedProduct, type ProductCategory, type ProductVariantForm } from '@/features/products/services/product.service';
import { formatCurrency } from '@/lib/format';
import { isDemoModeEnabled } from '@/lib/demo';

const emptyVariant: ProductVariantForm = {
    sku: '',
    size: '',
    color: '',
    barcode: '',
    mrp: 0,
    sellingPrice: 0,
    costPrice: 0,
    stock: 0,
    minStock: 5
};

const emptyForm = {
    name: '',
    categoryId: '',
    hsn: '',
    taxRate: 5,
    description: '',
    variants: [{ ...emptyVariant }]
};

export default function ProductsPage() {
    const [products, setProducts] = useState<ManagedProduct[]>([]);
    const [categories, setCategories] = useState<ProductCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState<ManagedProduct | null>(null);
    const [form, setForm] = useState(emptyForm);

    useEffect(() => {
        void loadData();
    }, []);

    async function loadData(query?: string) {
        try {
            setLoading(true);
            if (isDemoModeEnabled()) return;
            const [productsData, categoriesData] = await Promise.all([
                productService.getProducts(query),
                productService.getCategories()
            ]);
            setProducts(productsData);
            setCategories(categoriesData);
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to load products');
        } finally {
            setLoading(false);
        }
    }

    const filteredProducts = useMemo(() => products.filter((product) =>
        product.name.toLowerCase().includes(search.toLowerCase()) ||
        product.variants.some((variant) => variant.barcode?.toLowerCase().includes(search.toLowerCase()))
    ), [products, search]);

    function openCreateModal() {
        setEditingProduct(null);
        setForm(emptyForm);
        setShowModal(true);
    }

    function openEditModal(product: ManagedProduct) {
        setEditingProduct(product);
        setForm({
            name: product.name,
            categoryId: product.categoryId,
            hsn: product.hsn || '',
            taxRate: product.taxRate,
            description: product.description || '',
            variants: product.variants.length ? product.variants.map((variant) => ({ ...variant })) : [{ ...emptyVariant }]
        });
        setShowModal(true);
    }

    function updateVariant(index: number, patch: Partial<ProductVariantForm>) {
        setForm((current) => ({
            ...current,
            variants: current.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, ...patch } : variant)
        }));
    }

    async function saveProduct() {
        try {
            const payload = {
                ...form,
                variants: form.variants.map((variant) => ({
                    ...variant,
                    mrp: Number(variant.mrp) || 0,
                    sellingPrice: Number(variant.sellingPrice) || 0,
                    costPrice: Number(variant.costPrice) || 0,
                    stock: Number(variant.stock) || 0,
                    minStock: Number(variant.minStock) || 5
                }))
            };

            if (editingProduct) {
                const updated = await productService.updateProduct(editingProduct.id, payload);
                setProducts((current) => current.map((product) => product.id === editingProduct.id ? updated : product));
                toast.success('Product updated');
            } else {
                const created = await productService.createProduct(payload);
                setProducts((current) => [created, ...current]);
                toast.success('Product created');
            }

            setShowModal(false);
            setEditingProduct(null);
            setForm(emptyForm);
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to save product');
        }
    }

    async function deleteProduct(id: string) {
        try {
            await productService.deleteProduct(id);
            setProducts((current) => current.filter((product) => product.id !== id));
            toast.success('Product deactivated');
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to delete product');
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="dashboard-section-title">Products</h1>
                    <p className="dashboard-section-copy">Manage catalog, variants, barcodes, price points, and stock thresholds remotely.</p>
                </div>
                {!isDemoModeEnabled() && (
                    <Button className="rounded-2xl" onClick={openCreateModal}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Product
                    </Button>
                )}
            </div>

            <Card>
                <CardHeader className="border-b border-slate-200/70 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40">
                    <CardTitle className="text-xl">Catalog Search</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by product name or barcode"
                            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-700 dark:focus:ring-sky-950/40"
                        />
                    </div>
                </CardContent>
            </Card>

            <Card className="overflow-hidden">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50/80 text-slate-400 dark:bg-slate-900/50 dark:text-slate-500">
                                <tr>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Product</th>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Category</th>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Barcode</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Stock</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Price</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {loading ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">Loading products...</td>
                                    </tr>
                                ) : filteredProducts.map((product) => {
                                    const primaryVariant = product.variants[0];
                                    const totalStock = product.variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
                                    return (
                                        <tr key={product.id}>
                                            <td className="px-4 py-4">
                                                <div className="font-medium text-slate-950 dark:text-slate-100">{product.name}</div>
                                                <div className="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                                                    {product.variants.length} variant{product.variants.length === 1 ? '' : 's'}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-slate-500 dark:text-slate-400">{product.category?.name || 'Uncategorized'}</td>
                                            <td className="px-4 py-4 font-mono text-slate-500 dark:text-slate-400">{primaryVariant?.barcode || '-'}</td>
                                            <td className="px-4 py-4 text-right text-slate-900 dark:text-slate-100">{totalStock}</td>
                                            <td className="px-4 py-4 text-right text-slate-900 dark:text-slate-100">{formatCurrency(primaryVariant?.sellingPrice || 0)}</td>
                                            <td className="px-4 py-4">
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="outline" size="sm" className="rounded-xl" onClick={() => openEditModal(product)}>
                                                        <Edit className="mr-2 h-4 w-4" />
                                                        Edit
                                                    </Button>
                                                    <Button variant="outline" size="sm" className="rounded-xl text-rose-600" onClick={() => void deleteProduct(product.id)}>
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Delete
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-4xl">
                        <CardHeader>
                            <CardTitle>{editingProduct ? 'Edit Product' : 'Add Product'}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Product name" value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
                                <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" value={form.categoryId} onChange={(e) => setForm((current) => ({ ...current, categoryId: e.target.value }))}>
                                    <option value="">Select category</option>
                                    {categories.map((category) => (
                                        <option key={category.id} value={category.id}>{category.name}</option>
                                    ))}
                                </select>
                                <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="HSN code" value={form.hsn} onChange={(e) => setForm((current) => ({ ...current, hsn: e.target.value }))} />
                                <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Tax rate" type="number" value={form.taxRate} onChange={(e) => setForm((current) => ({ ...current, taxRate: Number(e.target.value) || 0 }))} />
                            </div>

                            <textarea className="min-h-[96px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Description" value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} />

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Variants</h3>
                                    <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setForm((current) => ({ ...current, variants: [...current.variants, { ...emptyVariant }] }))}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Add Variant
                                    </Button>
                                </div>

                                {form.variants.map((variant, index) => (
                                    <div key={index} className="grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800 md:grid-cols-3 xl:grid-cols-5">
                                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="SKU" value={variant.sku} onChange={(e) => updateVariant(index, { sku: e.target.value })} />
                                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Barcode" value={variant.barcode} onChange={(e) => updateVariant(index, { barcode: e.target.value })} />
                                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Size" value={variant.size} onChange={(e) => updateVariant(index, { size: e.target.value })} />
                                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Color" value={variant.color} onChange={(e) => updateVariant(index, { color: e.target.value })} />
                                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="MRP" type="number" value={variant.mrp} onChange={(e) => updateVariant(index, { mrp: Number(e.target.value) || 0 })} />
                                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Selling price" type="number" value={variant.sellingPrice} onChange={(e) => updateVariant(index, { sellingPrice: Number(e.target.value) || 0 })} />
                                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Cost price" type="number" value={variant.costPrice} onChange={(e) => updateVariant(index, { costPrice: Number(e.target.value) || 0 })} />
                                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Stock" type="number" value={variant.stock} onChange={(e) => updateVariant(index, { stock: Number(e.target.value) || 0 })} />
                                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Min stock" type="number" value={variant.minStock} onChange={(e) => updateVariant(index, { minStock: Number(e.target.value) || 0 })} />
                                        <div className="flex items-center justify-end">
                                            {form.variants.length > 1 && (
                                                <Button variant="outline" size="sm" className="rounded-xl text-rose-600" onClick={() => setForm((current) => ({ ...current, variants: current.variants.filter((_, variantIndex) => variantIndex !== index) }))}>
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Remove
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end gap-3">
                                <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                                <Button onClick={() => void saveProduct()}>{editingProduct ? 'Update' : 'Create'}</Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
