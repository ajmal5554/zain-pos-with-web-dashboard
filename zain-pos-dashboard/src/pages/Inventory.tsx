import * as React from 'react';
import { useState } from 'react';
import { Activity, AlertTriangle, DollarSign, Search, TrendingDown, Layers, Box, BarChart3, ShieldAlert } from 'lucide-react';
import { useInventoryMetrics } from '@/features/inventory/hooks/useInventoryMetrics';
import { StockHealthBadge } from '@/features/inventory/components/StockHealthBadge';
import { StatCard } from '@/components/shared/StatCard';
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
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/format';


export default function Inventory() {
    const { products, metrics, loading } = useInventoryMetrics();
    const [searchTerm, setSearchTerm] = useState('');

    const filteredProducts = products.filter((product) =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.barcode?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="flex-1 space-y-4 pt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Stock</h2>
                    <p className="text-muted-foreground text-sm">
                        View stock levels and items that need reordering.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard title="Total Stock Value" value={formatCurrency(metrics.totalValue)} icon={<DollarSign className="h-4 w-4" />} loading={loading} />
                <StatCard title="Low Stock Items" value={metrics.lowStockCount} icon={<AlertTriangle className="h-4 w-4" />} loading={loading} />
                <StatCard title="Out of Stock" value={metrics.outOfStockCount} icon={<TrendingDown className="h-4 w-4" />} loading={loading} />
                <StatCard title="Product Types" value={metrics.totalItems} icon={<Layers className="h-4 w-4" />} loading={loading} />
            </div>

            {/* Pressure Alert Box */}
            {metrics.lowStockCount > 0 && (
                <div className="p-4 rounded-md bg-rose-50 border border-rose-200 flex items-start gap-4 text-rose-800">
                     <ShieldAlert className="h-5 w-5 mt-0.5 text-rose-600 shrink-0" />
                     <div>
                         <p className="text-sm font-bold">Low Stock Alert</p>
                         <p className="text-sm mt-1">{metrics.lowStockCount} items are running low. Please order more soon.</p>
                     </div>
                </div>
            )}

            <Card>
                <CardContent className="p-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search items..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="rounded-md border bg-card overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead className="hidden sm:table-cell">Category</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-center">Stock</TableHead>
                            <TableHead className="hidden sm:table-cell text-center">Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    Loading...
                                </TableCell>
                            </TableRow>
                        ) : filteredProducts.length > 0 ? (
                            filteredProducts.map((product) => (
                                <TableRow key={product.id}>
                                    <TableCell className="max-w-[150px]">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-medium text-sm leading-tight truncate">{product.name}</span>
                                            {/* Show status badge inline on mobile only */}
                                            <span className="sm:hidden">
                                                <StockHealthBadge stock={product.stock} minStock={product.minStock} />
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden sm:table-cell">
                                        <Badge variant="secondary" className="font-normal text-xs">
                                            {product.category?.name || 'General'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-medium text-sm whitespace-nowrap">
                                        {formatCurrency(product.price)}
                                    </TableCell>
                                    <TableCell className="text-center font-medium">
                                        {product.stock}
                                    </TableCell>
                                    <TableCell className="hidden sm:table-cell text-center">
                                        <StockHealthBadge stock={product.stock} minStock={product.minStock} />
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    No items found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
