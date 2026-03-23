import { useState } from 'react';
import { AlertTriangle, DollarSign, Package, Search, TrendingDown } from 'lucide-react';
import { useInventoryMetrics } from '@/features/inventory/hooks/useInventoryMetrics';
import { StockHealthBadge } from '@/features/inventory/components/StockHealthBadge';
import { StatCard } from '@/components/shared/StatCard';
import { MobileInventoryCard } from '@/components/shared/MobileInventoryCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';

export default function Inventory() {
    const { products, metrics, loading } = useInventoryMetrics();
    const [searchTerm, setSearchTerm] = useState('');

    const filteredProducts = products.filter((product) =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.barcode?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div>
                <h1 className="dashboard-section-title">Inventory Intelligence</h1>
                <p className="dashboard-section-copy">
                    Search stock position, watch threshold pressure, and understand how much value is sitting on shelves.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                    title="Inventory Value"
                    value={formatCurrency(metrics.totalValue)}
                    icon={<DollarSign className="h-5 w-5" />}
                    loading={loading}
                />
                <StatCard
                    title="Low Stock"
                    value={metrics.lowStockCount}
                    icon={<AlertTriangle className="h-5 w-5" />}
                    loading={loading}
                />
                <StatCard
                    title="Out of Stock"
                    value={metrics.outOfStockCount}
                    icon={<TrendingDown className="h-5 w-5" />}
                    loading={loading}
                />
                <StatCard
                    title="Products"
                    value={metrics.totalItems}
                    icon={<Package className="h-5 w-5" />}
                    loading={loading}
                />
            </div>

            <Card className="hidden md:block">
                <CardHeader className="flex flex-col gap-4 border-b border-slate-200/70 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <CardTitle className="text-xl">Stock Report</CardTitle>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            Filter by product name or barcode.
                        </p>
                    </div>
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search name or barcode"
                            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-700 dark:focus:ring-sky-950/40"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-white/70 text-slate-400 dark:bg-slate-950/60 dark:text-slate-500">
                                <tr>
                                    <th className="px-6 py-4 text-left font-semibold uppercase tracking-[0.18em]">Product</th>
                                    <th className="px-6 py-4 text-left font-semibold uppercase tracking-[0.18em]">Category</th>
                                    <th className="px-6 py-4 text-right font-semibold uppercase tracking-[0.18em]">Price</th>
                                    <th className="px-6 py-4 text-center font-semibold uppercase tracking-[0.18em]">Stock</th>
                                    <th className="px-6 py-4 text-center font-semibold uppercase tracking-[0.18em]">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {loading ? (
                                    [1, 2, 3, 4, 5].map((i) => (
                                        <tr key={i}>
                                            <td className="px-6 py-4"><div className="h-4 w-48 animate-pulse rounded bg-slate-100 dark:bg-slate-900" /></td>
                                            <td className="px-6 py-4"><div className="h-4 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-900" /></td>
                                            <td className="px-6 py-4"><div className="ml-auto h-4 w-16 animate-pulse rounded bg-slate-100 dark:bg-slate-900" /></td>
                                            <td className="px-6 py-4"><div className="mx-auto h-4 w-12 animate-pulse rounded bg-slate-100 dark:bg-slate-900" /></td>
                                            <td className="px-6 py-4"><div className="mx-auto h-8 w-24 animate-pulse rounded-full bg-slate-100 dark:bg-slate-900" /></td>
                                        </tr>
                                    ))
                                ) : filteredProducts.length > 0 ? (
                                    filteredProducts.map((product) => (
                                        <tr key={product.id} className="bg-white/60 transition-colors hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/40">
                                            <td className="px-6 py-4 font-medium text-slate-950 dark:text-white">
                                                {product.name}
                                                <div className="mt-1 font-mono text-xs text-slate-400 dark:text-slate-500">{product.barcode || 'N/A'}</div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                                                {product.category?.name || 'Uncategorized'}
                                            </td>
                                            <td className="px-6 py-4 text-right font-medium text-slate-950 dark:text-slate-100">
                                                {formatCurrency(product.price)}
                                            </td>
                                            <td className="px-6 py-4 text-center text-slate-700 dark:text-slate-300">
                                                {product.stock}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <StockHealthBadge stock={product.stock} minStock={product.minStock} />
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                                            No products found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            <div className="space-y-4 md:hidden">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search products"
                        className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-700 dark:focus:ring-sky-950/40"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {loading ? (
                    <div className="dashboard-surface rounded-[1.5rem] px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                        Loading products...
                    </div>
                ) : filteredProducts.length > 0 ? (
                    filteredProducts.map((product) => (
                        <MobileInventoryCard key={product.id} product={product} />
                    ))
                ) : (
                    <div className="dashboard-surface rounded-[1.5rem] px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                        No products found.
                    </div>
                )}
            </div>
        </div>
    );
}
