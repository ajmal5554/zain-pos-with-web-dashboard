import { useEffect, useMemo, useState } from 'react';
import { Edit, Plus, Search, Trash2, X, MoreHorizontal, Package2, Tag, FileText, ChevronRight } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Card, 
  CardContent 
} from '@/components/ui/card';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { productService, type ManagedProduct, type ProductCategory, type ProductVariantForm } from '@/features/products/services/product.service';
import { formatCurrency } from '@/lib/format';
import { isDemoModeEnabled } from '@/lib/demo';
import { cn } from '@/lib/utils';

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
            toast.success('Product deleted');
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to delete product');
        }
    }

    return (
        <div className="flex-1 space-y-4 pt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Products</h2>
                    <p className="text-muted-foreground text-sm">
                        Manage your shop stock and items
                    </p>
                </div>
                {!isDemoModeEnabled() && (
                    <Button onClick={openCreateModal}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Product
                    </Button>
                )}
            </div>

            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center space-x-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search products..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </div>
                        <Button variant="outline" className="h-9 px-4">
                            <Tag className="mr-2 h-4 w-4" />
                            Categories
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="rounded-md border bg-card overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[40%]">Product Details</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Barcode / SKU</TableHead>
                            <TableHead className="text-right">Stock</TableHead>
                            <TableHead className="text-right">Unit Price</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    Loading...
                                </TableCell>
                            </TableRow>
                        ) : filteredProducts.length > 0 ? (
                            filteredProducts.map((product) => {
                                const primaryVariant = product.variants[0];
                                const totalStock = product.variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
                                return (
                                    <TableRow key={product.id}>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-medium text-sm">{product.name}</span>
                                                <span className="text-xs text-muted-foreground mt-1">
                                                    {product.variants.length} Type{product.variants.length === 1 ? '' : 's'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary" className="font-normal text-xs">
                                                {product.category?.name || 'None'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm text-muted-foreground">
                                                {primaryVariant?.barcode || 'N/A'}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <span className={cn(
                                                "text-sm font-medium",
                                                totalStock <= 5 ? "text-rose-500" : "text-emerald-600"
                                            )}>
                                                {totalStock}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCurrency(primaryVariant?.sellingPrice || 0)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end space-x-2">
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm"
                                                    onClick={() => openEditModal(product)}
                                                >
                                                    Edit
                                                </Button>
                                                <Button 
                                                    variant="ghost" 
                                                    size="icon"
                                                    className="h-8 w-8 text-rose-500 hover:text-rose-600"
                                                    onClick={() => void deleteProduct(product.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        ) : (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                    No products found
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={showModal} onOpenChange={setShowModal}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            {editingProduct ? 'Edit Product' : 'Add New Product'}
                        </DialogTitle>
                        <DialogDescription>
                            Enter product details and stock information here.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Product Name</label>
                                <input 
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    placeholder="e.g. T-Shirt" 
                                    value={form.name} 
                                    onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} 
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Category</label>
                                <select 
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={form.categoryId} 
                                    onChange={(e) => setForm((current) => ({ ...current, categoryId: e.target.value }))}
                                >
                                    <option value="">No Category</option>
                                    {categories.map((category) => (
                                        <option key={category.id} value={category.id}>{category.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 border-t">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold">Item Types (Sizes/Colors)</h3>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={() => setForm((current) => ({ ...current, variants: [...current.variants, { ...emptyVariant }] }))}
                                >
                                    Add Item Type
                                </Button>
                            </div>
                            
                            <div className="space-y-3">
                                {form.variants.map((variant, index) => (
                                    <div key={index} className="flex gap-3 items-end p-3 bg-muted/50 rounded-lg border">
                                         <div className="space-y-1 flex-1">
                                            <label className="text-xs font-medium">Barcode / SKU</label>
                                            <input 
                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                                value={variant.sku} 
                                                onChange={(e) => updateVariant(index, { sku: e.target.value })} 
                                            />
                                         </div>
                                         <div className="space-y-1 w-24">
                                            <label className="text-xs font-medium">Price</label>
                                            <input 
                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                                type="number" 
                                                value={variant.sellingPrice} 
                                                onChange={(e) => updateVariant(index, { sellingPrice: Number(e.target.value) })} 
                                            />
                                         </div>
                                         <div className="space-y-1 w-24">
                                            <label className="text-xs font-medium">Stock</label>
                                            <input 
                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                                type="number" 
                                                value={variant.stock} 
                                                onChange={(e) => updateVariant(index, { stock: Number(e.target.value) })} 
                                            />
                                         </div>
                                         <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="text-rose-500 shrink-0"
                                            onClick={() => setForm((current) => ({ ...current, variants: current.variants.filter((_, i) => i !== index) }))}
                                         >
                                             <Trash2 className="h-4 w-4" />
                                         </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowModal(false)}>
                            Cancel
                        </Button>
                        <Button onClick={() => void saveProduct()}>
                            Save Product
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
