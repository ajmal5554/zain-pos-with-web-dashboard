import { useState, useEffect } from 'react';
import {
    Search,
    Mail,
    Phone,
    Calendar,
    User,
    FileText,
    Plus,
    Activity,
    ShieldCheck,
    Download,
    Edit2,
    Trash2,
    X,
    Eye,
    ShoppingBag,
    IndianRupee,
    RefreshCw
} from 'lucide-react';
import { StatCard } from '@/components/shared/StatCard';
import { PaginatedTable } from '@/components/shared/PaginatedTable';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
    customerService,
    type Customer,
    type CustomerStats,
    type CustomerDetailResponse
} from '@/features/customers/services/customer.service';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx';

export default function CustomersPage() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [data, setData] = useState<{ customers: Customer[]; total: number }>({ customers: [], total: 0 });
    const [stats, setStats] = useState<CustomerStats>({ total: 0, repeatBuyers: 0, totalRevenue: 0, gstinCount: 0 });
    const [loading, setLoading] = useState(true);
    const [statsLoading, setStatsLoading] = useState(true);

    // Add / Edit Dialog state
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        email: '',
        address: '',
        gstin: ''
    });
    const [formSaving, setFormSaving] = useState(false);

    // Detail Dialog state
    const [detailCustomer, setDetailCustomer] = useState<CustomerDetailResponse | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    // Delete Confirmation state
    const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        void loadCustomers();
    }, [page, search]);

    useEffect(() => {
        void loadStats();
    }, []);

    async function loadStats() {
        try {
            setStatsLoading(true);
            const res = await customerService.getCustomerStats();
            setStats(res);
        } catch {
            // Non-critical fallback
        } finally {
            setStatsLoading(false);
        }
    }

    async function loadCustomers() {
        try {
            setLoading(true);
            const response = await customerService.getCustomers(page, 10, search);
            setData({ customers: response.customers, total: response.pagination.total });
        } catch (error: any) {
            toast.error('Failed to load customers');
        } finally {
            setLoading(false);
        }
    }

    function openAddModal() {
        setEditingCustomer(null);
        setFormData({ name: '', phone: '', email: '', address: '', gstin: '' });
        setIsFormOpen(true);
    }

    function openEditModal(customer: Customer) {
        setEditingCustomer(customer);
        setFormData({
            name: customer.name || '',
            phone: customer.phone || '',
            email: customer.email || '',
            address: customer.address || '',
            gstin: customer.gstin || ''
        });
        setIsFormOpen(true);
    }

    async function handleFormSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!formData.name.trim()) {
            toast.error('Customer name is required');
            return;
        }

        try {
            setFormSaving(true);
            const payload = {
                name: formData.name.trim(),
                phone: formData.phone.trim() || undefined,
                email: formData.email.trim() || undefined,
                address: formData.address.trim() || undefined,
                gstin: formData.gstin.trim().toUpperCase() || undefined
            };

            if (editingCustomer) {
                await customerService.updateCustomer(editingCustomer.id, payload);
                toast.success(`Customer "${payload.name}" updated successfully`);
            } else {
                await customerService.createCustomer(payload);
                toast.success(`Customer "${payload.name}" created successfully`);
            }

            setIsFormOpen(false);
            setEditingCustomer(null);
            void loadCustomers();
            void loadStats();
        } catch (error: any) {
            toast.error(error.response?.data?.error || error.message || 'Failed to save customer');
        } finally {
            setFormSaving(false);
        }
    }

    async function handleDeleteCustomer() {
        if (!customerToDelete) return;
        try {
            setIsDeleting(true);
            await customerService.deleteCustomer(customerToDelete.id);
            toast.success(`Customer "${customerToDelete.name}" deleted`);
            setCustomerToDelete(null);
            void loadCustomers();
            void loadStats();
        } catch (error: any) {
            toast.error(error.response?.data?.error || error.message || 'Failed to delete customer');
        } finally {
            setIsDeleting(false);
        }
    }

    async function viewCustomerDetails(customer: Customer) {
        try {
            setLoadingDetail(true);
            const res = await customerService.getCustomer(customer.id);
            setDetailCustomer(res);
        } catch {
            toast.error('Failed to load customer details');
        } finally {
            setLoadingDetail(false);
        }
    }

    function handleExportExcel() {
        try {
            const exportData = data.customers.map(c => ({
                'Name': c.name,
                'Phone': c.phone || '',
                'Email': c.email || '',
                'GSTIN': c.gstin || '',
                'Address': c.address || '',
                'Registered Date': c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''
            }));

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Customers');
            XLSX.writeFile(wb, `customers_${new Date().toISOString().slice(0, 10)}.xlsx`);
            toast.success(`Exported ${exportData.length} customers to Excel`);
        } catch (err: any) {
            toast.error('Failed to export Excel: ' + err.message);
        }
    }

    const columns = [
        {
            header: 'Customer Name',
            render: (customer: Customer) => (
                <div className="flex items-center gap-3 py-1">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 border border-primary/20 font-semibold text-xs">
                        {customer.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <button
                            onClick={() => viewCustomerDetails(customer)}
                            className="font-medium text-sm hover:underline text-left"
                        >
                            {customer.name}
                        </button>
                        <p className="text-xs text-muted-foreground">ID: {customer.id.slice(0, 8).toUpperCase()}</p>
                    </div>
                </div>
            )
        },
        {
            header: 'Contact Info',
            render: (customer: Customer) => (
                <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono">{customer.phone || 'No Phone'}</span>
                    </div>
                    {customer.email && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            <span>{customer.email}</span>
                        </div>
                    )}
                </div>
            )
        },
        {
            header: 'GST Number',
            render: (customer: Customer) => (
                customer.gstin ? (
                    <Badge variant="secondary" className="font-mono text-xs">
                        {customer.gstin}
                    </Badge>
                ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                )
            )
        },
        {
            header: 'Date Added',
            render: (customer: Customer) => (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{new Date(customer.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
            )
        },
        {
            header: 'Actions',
            className: 'text-right',
            render: (customer: Customer) => (
                <div className="flex justify-end gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => viewCustomerDetails(customer)}
                        title="View Invoices"
                    >
                        <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => openEditModal(customer)}
                        title="Edit Customer"
                    >
                        <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setCustomerToDelete(customer)}
                        title="Delete Customer"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            )
        }
    ];

    return (
        <div className="flex-1 space-y-4 p-2 sm:p-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Customers</h2>
                    <p className="text-muted-foreground text-sm">
                        View, search, and manage your store's customer database.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportExcel}
                        disabled={data.customers.length === 0}
                    >
                        <Download className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                    <Button size="sm" onClick={openAddModal}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Customer
                    </Button>
                </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                    title="Total Customers"
                    value={stats.total}
                    icon={<User className="h-4 w-4" />}
                    loading={statsLoading}
                />
                <StatCard
                    title="Repeat Buyers"
                    value={stats.repeatBuyers}
                    icon={<Activity className="h-4 w-4" />}
                    loading={statsLoading}
                />
                <StatCard
                    title="Tracked Spend"
                    value={`₹${stats.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                    icon={<IndianRupee className="h-4 w-4" />}
                    loading={statsLoading}
                />
                <StatCard
                    title="GST Registered"
                    value={stats.gstinCount}
                    icon={<ShieldCheck className="h-4 w-4" />}
                    loading={statsLoading}
                />
            </div>

            {/* Search Box */}
            <Card>
                <CardContent className="p-3">
                    <div className="relative max-w-sm flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search by name, phone, GSTIN..."
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                            className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-8 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                </CardContent>
            </Card>

            {/* Table */}
            <div className="rounded-md border bg-card overflow-hidden">
                <CardContent className="p-0">
                    <PaginatedTable
                        columns={columns}
                        data={data.customers}
                        total={data.total}
                        page={page}
                        onPageChange={setPage}
                        loading={loading}
                    />
                </CardContent>
            </div>

            {/* Add / Edit Dialog */}
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
                        <DialogDescription>
                            {editingCustomer
                                ? 'Update contact and registration details for this customer.'
                                : 'Enter details to create a new customer record.'}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleFormSubmit} className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold">Customer Full Name *</label>
                            <input
                                required
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                placeholder="e.g. Imran Khan"
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold">Phone Number</label>
                                <input
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    placeholder="+91 98765 43210"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold">Email Address</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    placeholder="customer@gmail.com"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold">GSTIN (Optional)</label>
                            <input
                                value={formData.gstin}
                                onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono uppercase"
                                placeholder="32AAAAA0000A1Z5"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold">Address / City</label>
                            <textarea
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                                placeholder="Store / Home location..."
                                rows={2}
                            />
                        </div>

                        <DialogFooter className="pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsFormOpen(false)}
                                disabled={formSaving}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={formSaving}>
                                {formSaving ? 'Saving...' : editingCustomer ? 'Save Changes' : 'Create Customer'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Customer Details / Purchase History Dialog */}
            <Dialog open={Boolean(detailCustomer)} onOpenChange={(open) => !open && setDetailCustomer(null)}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <User className="h-5 w-5 text-primary" />
                            {detailCustomer?.customer.name}
                        </DialogTitle>
                        <DialogDescription>
                            {detailCustomer?.customer.phone ? `Phone: ${detailCustomer.customer.phone}` : 'No phone registered'}
                            {detailCustomer?.customer.gstin ? ` • GSTIN: ${detailCustomer.customer.gstin}` : ''}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="text-xs text-muted-foreground">
                            {detailCustomer?.customer.address && (
                                <p className="mb-2"><strong>Address:</strong> {detailCustomer.customer.address}</p>
                            )}
                            <p><strong>Registered:</strong> {detailCustomer?.customer.createdAt ? new Date(detailCustomer.customer.createdAt).toLocaleDateString() : ''}</p>
                        </div>

                        <div>
                            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                                <ShoppingBag className="h-4 w-4 text-primary" />
                                Recent Purchases ({detailCustomer?.sales.length || 0})
                            </h4>

                            {detailCustomer?.sales && detailCustomer.sales.length > 0 ? (
                                <div className="border rounded-md overflow-hidden max-h-56 overflow-y-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-muted text-muted-foreground border-b">
                                            <tr>
                                                <th className="py-2 px-3 text-left">Bill #</th>
                                                <th className="py-2 px-3 text-left">Date</th>
                                                <th className="py-2 px-3 text-left">Mode</th>
                                                <th className="py-2 px-3 text-right">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {detailCustomer.sales.map((s) => (
                                                <tr key={s.id} className="hover:bg-muted/50">
                                                    <td className="py-2 px-3 font-mono font-medium">#{s.billNo}</td>
                                                    <td className="py-2 px-3 text-muted-foreground">
                                                        {new Date(s.createdAt).toLocaleDateString()}
                                                    </td>
                                                    <td className="py-2 px-3">
                                                        <Badge variant="outline" className="text-[10px]">
                                                            {s.paymentMethod}
                                                        </Badge>
                                                    </td>
                                                    <td className="py-2 px-3 text-right font-bold">
                                                        ₹{s.grandTotal.toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-center py-6 border border-dashed rounded-md text-xs text-muted-foreground">
                                    No completed purchases found for this customer.
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDetailCustomer(null)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Customer Confirmation */}
            <Dialog open={Boolean(customerToDelete)} onOpenChange={(open) => !open && setCustomerToDelete(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Delete Customer</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete customer "{customerToDelete?.name}"?
                            This action cannot be undone. Past bills will retain their original customer details.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setCustomerToDelete(null)} disabled={isDeleting}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDeleteCustomer} disabled={isDeleting}>
                            {isDeleting ? 'Deleting...' : 'Delete Customer'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
