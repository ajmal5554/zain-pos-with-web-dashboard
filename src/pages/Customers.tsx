import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Users,
    UserPlus,
    Search,
    Edit2,
    Trash2,
    Phone,
    Mail,
    MapPin,
    ChevronLeft,
    ChevronRight,
    Download,
    Eye,
    ShoppingBag,
    IndianRupee,
    ShieldCheck,
    RefreshCw,
    X,
    Calendar,
    ExternalLink
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { showToast } from '../components/ui/Toast';
import { Skeleton } from '../components/ui/Skeleton';
import { db } from '../lib/db';
import { useCartStore } from '../store/cartStore';
import { useAuthStore } from '../store/authStore';
import * as XLSX from 'xlsx';

export interface CustomerRecord {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    gstin: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CustomerSaleSummary {
    totalOrders: number;
    totalSpent: number;
    lastOrderDate: string | null;
    firstOrderDate: string | null;
    averageOrderValue: number;
    sales: Array<{
        id: string;
        billNo: string;
        grandTotal: number;
        paymentMethod: string;
        status: string;
        createdAt: string;
    }>;
}

const AVATAR_COLORS = [
    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 border-teal-200 dark:border-teal-800',
];

function getAvatarColor(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
}

function getInitials(name: string) {
    if (!name) return 'C';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
}

export const Customers: React.FC = () => {
    const navigate = useNavigate();
    const [customers, setCustomers] = useState<CustomerRecord[]>([]);
    const [salesSummaryMap, setSalesSummaryMap] = useState<Record<string, CustomerSaleSummary>>({});
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<'ALL' | 'REPEAT' | 'WITH_GSTIN' | 'WITH_PHONE'>('ALL');
    const [sortBy, setSortBy] = useState<'NEWEST' | 'NAME_ASC' | 'NAME_DESC' | 'HIGHEST_SPEND' | 'MOST_ORDERS'>('NEWEST');

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Modal states
    const [showFormModal, setShowFormModal] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);
    const [formSaving, setFormSaving] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        email: '',
        address: '',
        gstin: '',
    });
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});

    // Customer 360 / Details Modal
    const [viewingCustomer, setViewingCustomer] = useState<CustomerRecord | null>(null);

    // Delete Confirmation
    const [customerToDelete, setCustomerToDelete] = useState<CustomerRecord | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        try {
            // Load customers and sales concurrently to compute metrics
            const [customerData, salesData] = await Promise.all([
                db.customers.findMany({
                    orderBy: { createdAt: 'desc' }
                }),
                db.sales.findMany({
                    where: { status: 'COMPLETED' },
                    select: {
                        id: true,
                        billNo: true,
                        customerName: true,
                        customerPhone: true,
                        grandTotal: true,
                        paymentMethod: true,
                        status: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: 'desc' }
                }).catch(() => [])
            ]);

            // Discover any past customers from sales who may not have been saved in db.customers
            const existingPhones = new Set((customerData || []).map((c: any) => c.phone).filter(Boolean));
            const existingNames = new Set((customerData || []).map((c: any) => (c.name || '').trim().toLowerCase()));
            const discoveredFromSales: CustomerRecord[] = [];

            if (Array.isArray(salesData)) {
                salesData.forEach((sale: any) => {
                    const phone = sale.customerPhone?.trim() || null;
                    const name = sale.customerName?.trim() || null;
                    const isAnon = !name || name.toLowerCase() === 'walk-in customer' || name.toLowerCase() === 'walk-in';

                    if (phone && !existingPhones.has(phone)) {
                        existingPhones.add(phone);
                        const custName = isAnon ? `Customer ${phone}` : name;
                        discoveredFromSales.push({
                            id: `sale-cust-${phone}`,
                            name: custName,
                            phone: phone,
                            email: null,
                            address: null,
                            gstin: null,
                            createdAt: sale.createdAt,
                            updatedAt: sale.createdAt
                        });
                    } else if (!phone && !isAnon && !existingNames.has(name.toLowerCase())) {
                        existingNames.add(name.toLowerCase());
                        discoveredFromSales.push({
                            id: `sale-cust-${encodeURIComponent(name)}`,
                            name: name,
                            phone: null,
                            email: null,
                            address: null,
                            gstin: null,
                            createdAt: sale.createdAt,
                            updatedAt: sale.createdAt
                        });
                    }
                });
            }

            setCustomers([...(customerData || []), ...discoveredFromSales]);

            // Aggregate customer purchase history
            const summaryMap: Record<string, CustomerSaleSummary> = {};
            if (Array.isArray(salesData)) {
                salesData.forEach((sale: any) => {
                    const phoneKey = sale.customerPhone?.trim();
                    const nameKey = sale.customerName?.trim().toLowerCase();

                    const keysToUpdate: string[] = [];
                    if (phoneKey) keysToUpdate.push(`phone:${phoneKey}`);
                    if (nameKey && nameKey !== 'walk-in customer' && nameKey !== 'walk-in') {
                        keysToUpdate.push(`name:${nameKey}`);
                    }

                    keysToUpdate.forEach(k => {
                        if (!summaryMap[k]) {
                            summaryMap[k] = {
                                totalOrders: 0,
                                totalSpent: 0,
                                lastOrderDate: null,
                                firstOrderDate: null,
                                averageOrderValue: 0,
                                sales: []
                            };
                        }
                        const record = summaryMap[k];
                        record.totalOrders += 1;
                        record.totalSpent += Number(sale.grandTotal || 0);
                        if (!record.lastOrderDate) {
                            record.lastOrderDate = sale.createdAt;
                        }
                        record.firstOrderDate = sale.createdAt;
                        record.sales.push({
                            id: sale.id,
                            billNo: sale.billNo,
                            grandTotal: Number(sale.grandTotal || 0),
                            paymentMethod: sale.paymentMethod || 'CASH',
                            status: sale.status || 'COMPLETED',
                            createdAt: sale.createdAt
                        });
                    });
                });

                // Compute averages
                Object.values(summaryMap).forEach(rec => {
                    rec.averageOrderValue = rec.totalOrders > 0 ? rec.totalSpent / rec.totalOrders : 0;
                });
            }

            setSalesSummaryMap(summaryMap);
        } catch (error: any) {
            console.error('Failed to load customers data:', error);
            showToast('Failed to load customers: ' + (error?.message || 'Database error'), 'error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const getCustomerSummary = (customer: CustomerRecord): CustomerSaleSummary => {
        if (customer.phone && salesSummaryMap[`phone:${customer.phone.trim()}`]) {
            return salesSummaryMap[`phone:${customer.phone.trim()}`];
        }
        const nameKey = customer.name?.trim().toLowerCase();
        if (nameKey && salesSummaryMap[`name:${nameKey}`]) {
            return salesSummaryMap[`name:${nameKey}`];
        }
        return {
            totalOrders: 0,
            totalSpent: 0,
            lastOrderDate: null,
            firstOrderDate: null,
            averageOrderValue: 0,
            sales: []
        };
    };

    // Overall stats
    const stats = useMemo(() => {
        let totalSpentAll = 0;
        let repeatBuyers = 0;
        let gstinCount = 0;

        customers.forEach(c => {
            const sum = getCustomerSummary(c);
            totalSpentAll += sum.totalSpent;
            if (sum.totalOrders >= 2) repeatBuyers += 1;
            if (c.gstin && c.gstin.trim().length > 0) gstinCount += 1;
        });

        return {
            totalCustomers: customers.length,
            repeatBuyers,
            totalRevenue: totalSpentAll,
            gstinCount
        };
    }, [customers, salesSummaryMap]);

    // Filter & Sort
    const filteredCustomers = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        return customers.filter(c => {
            // Search query filter
            const matchesQuery = !query || (
                (c.name && c.name.toLowerCase().includes(query)) ||
                (c.phone && c.phone.includes(query)) ||
                (c.email && c.email.toLowerCase().includes(query)) ||
                (c.gstin && c.gstin.toLowerCase().includes(query)) ||
                (c.address && c.address.toLowerCase().includes(query))
            );

            if (!matchesQuery) return false;

            // Category filter
            const summary = getCustomerSummary(c);
            if (activeFilter === 'REPEAT' && summary.totalOrders < 2) return false;
            if (activeFilter === 'WITH_GSTIN' && (!c.gstin || c.gstin.trim().length === 0)) return false;
            if (activeFilter === 'WITH_PHONE' && (!c.phone || c.phone.trim().length === 0)) return false;

            return true;
        }).sort((a, b) => {
            const sumA = getCustomerSummary(a);
            const sumB = getCustomerSummary(b);

            switch (sortBy) {
                case 'NAME_ASC':
                    return a.name.localeCompare(b.name);
                case 'NAME_DESC':
                    return b.name.localeCompare(a.name);
                case 'HIGHEST_SPEND':
                    return sumB.totalSpent - sumA.totalSpent;
                case 'MOST_ORDERS':
                    return sumB.totalOrders - sumA.totalOrders;
                case 'NEWEST':
                default:
                    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
            }
        });
    }, [customers, searchQuery, activeFilter, sortBy, salesSummaryMap]);

    // Pagination calculations
    const totalPages = Math.ceil(filteredCustomers.length / itemsPerPage) || 1;
    const paginatedCustomers = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredCustomers.slice(start, start + itemsPerPage);
    }, [filteredCustomers, currentPage, itemsPerPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, activeFilter, sortBy, itemsPerPage]);

    // Modal actions
    const openAddModal = () => {
        setEditingCustomer(null);
        setFormData({ name: '', phone: '', email: '', address: '', gstin: '' });
        setFormErrors({});
        setShowFormModal(true);
    };

    const openEditModal = (customer: CustomerRecord) => {
        setEditingCustomer(customer);
        setFormData({
            name: customer.name || '',
            phone: customer.phone || '',
            email: customer.email || '',
            address: customer.address || '',
            gstin: customer.gstin || '',
        });
        setFormErrors({});
        setShowFormModal(true);
    };

    const validateForm = () => {
        const errors: Record<string, string> = {};
        if (!formData.name.trim()) {
            errors.name = 'Customer name is required';
        }

        if (formData.phone.trim()) {
            const cleanPhone = formData.phone.trim().replace(/\s+/g, '');
            if (!/^\+?[0-9]{7,15}$/.test(cleanPhone)) {
                errors.phone = 'Please enter a valid phone number (7-15 digits)';
            } else {
                // Check duplicate phone locally
                const existing = customers.find(c =>
                    c.phone &&
                    c.phone.trim().replace(/\s+/g, '') === cleanPhone &&
                    (!editingCustomer || c.id !== editingCustomer.id)
                );
                if (existing) {
                    errors.phone = `Phone number already used by ${existing.name}`;
                }
            }
        }

        if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
            errors.email = 'Please enter a valid email address';
        }

        if (formData.gstin.trim() && formData.gstin.trim().length > 15) {
            errors.gstin = 'GSTIN should not exceed 15 characters';
        }

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;

        setFormSaving(true);
        try {
            const cleanData = {
                name: formData.name.trim(),
                phone: formData.phone.trim() || null,
                email: formData.email.trim() || null,
                address: formData.address.trim() || null,
                gstin: formData.gstin.trim().toUpperCase() || null,
                isSynced: false,
            };

            const currentUser = useAuthStore.getState().user;
            if (editingCustomer) {
                if (editingCustomer.id.startsWith('sale-cust-')) {
                    await db.customers.create({ data: cleanData });
                } else {
                    await db.customers.update({
                        where: { id: editingCustomer.id },
                        data: cleanData
                    });
                }
                try {
                    await db.auditLogs.create({
                        data: {
                            action: 'CUSTOMER_UPDATE',
                            userId: currentUser?.id,
                            details: JSON.stringify({
                                customerId: editingCustomer.id,
                                customerName: cleanData.name,
                                customerPhone: cleanData.phone,
                                previousName: editingCustomer.name,
                                previousPhone: editingCustomer.phone,
                                summary: `Customer profile updated: "${editingCustomer.name}" (${editingCustomer.phone || 'No phone'}) → "${cleanData.name}" (${cleanData.phone || 'No phone'})`
                            })
                        }
                    });
                } catch (auditErr) {
                    console.warn('Could not record customer update audit log:', auditErr);
                }
                showToast(`Customer "${cleanData.name}" updated successfully`, 'success');
            } else {
                await db.customers.create({ data: cleanData });
                try {
                    await db.auditLogs.create({
                        data: {
                            action: 'CUSTOMER_CREATE',
                            userId: currentUser?.id,
                            details: JSON.stringify({
                                customerName: cleanData.name,
                                customerPhone: cleanData.phone,
                                summary: `New customer registered: "${cleanData.name}" (${cleanData.phone || 'No phone'})`
                            })
                        }
                    });
                } catch (auditErr) {
                    console.warn('Could not record customer create audit log:', auditErr);
                }
                showToast(`Customer "${cleanData.name}" added successfully`, 'success');
            }

            setShowFormModal(false);
            setEditingCustomer(null);
            await loadData(true);
        } catch (error: any) {
            console.error('Failed to save customer:', error);
            const errMsg = error?.message?.includes('UNIQUE constraint failed')
                ? 'A customer with this phone number already exists.'
                : (error?.message || 'Failed to save customer');
            showToast(errMsg, 'error');
        } finally {
            setFormSaving(false);
        }
    };

    const handleDeleteConfirm = async () => {
        if (!customerToDelete) return;
        setDeleting(true);
        try {
            if (!customerToDelete.id.startsWith('sale-cust-')) {
                await db.customers.delete({
                    where: { id: customerToDelete.id }
                });
            }
            try {
                const currentUser = useAuthStore.getState().user;
                await db.auditLogs.create({
                    data: {
                        action: 'CUSTOMER_DELETE',
                        userId: currentUser?.id,
                        details: JSON.stringify({
                            customerId: customerToDelete.id,
                            customerName: customerToDelete.name,
                            customerPhone: customerToDelete.phone,
                            summary: `Customer profile deleted: "${customerToDelete.name}" (${customerToDelete.phone || 'No phone'})`
                        })
                    }
                });
            } catch (auditErr) {
                console.warn('Could not record customer delete audit log:', auditErr);
            }
            showToast(`Customer "${customerToDelete.name}" removed successfully`, 'success');
            setCustomerToDelete(null);
            await loadData(true);
        } catch (error: any) {
            console.error('Failed to delete customer:', error);
            showToast('Failed to delete customer: ' + (error?.message || 'Database error'), 'error');
        } finally {
            setDeleting(false);
        }
    };

    const handleStartSaleForCustomer = (customer: CustomerRecord) => {
        useCartStore.getState().setCustomer(customer.id, customer.name, customer.phone);
        showToast(`Customer "${customer.name}" selected for new sale`, 'info');
        navigate('/pos');
    };

    const handleExportExcel = () => {
        try {
            const exportData = filteredCustomers.map(c => {
                const summary = getCustomerSummary(c);
                return {
                    'Customer Name': c.name,
                    'Phone': c.phone || '',
                    'Email': c.email || '',
                    'GSTIN': c.gstin || '',
                    'Address': c.address || '',
                    'Total Orders': summary.totalOrders,
                    'Total Spent (₹)': summary.totalSpent.toFixed(2),
                    'Average Order Value (₹)': summary.averageOrderValue.toFixed(2),
                    'Last Purchase Date': summary.lastOrderDate ? new Date(summary.lastOrderDate).toLocaleDateString() : 'Never',
                    'Registered Date': c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''
                };
            });

            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');
            const dateStr = new Date().toISOString().slice(0, 10);
            XLSX.writeFile(workbook, `zain_customers_${dateStr}.xlsx`);
            showToast(`Exported ${exportData.length} customers to Excel`, 'success');
        } catch (err: any) {
            console.error('Export failed:', err);
            showToast('Failed to export to Excel: ' + (err?.message || 'Unknown error'), 'error');
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-dark-card p-5 rounded-2xl border border-gray-200 dark:border-dark-border shadow-sm">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="p-2.5 rounded-xl bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                            <Users className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Customer Directory</h1>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                Manage customer profiles, track loyalty, view order histories, and handle GST records.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                    <Button
                        variant="secondary"
                        onClick={() => loadData(true)}
                        disabled={refreshing || loading}
                        className="flex-1 sm:flex-none"
                        title="Refresh customers"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">Refresh</span>
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleExportExcel}
                        disabled={filteredCustomers.length === 0}
                        className="flex-1 sm:flex-none"
                    >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">Export</span>
                    </Button>
                    <Button
                        variant="primary"
                        onClick={openAddModal}
                        className="flex-1 sm:flex-none"
                    >
                        <UserPlus className="w-4 h-4" />
                        <span>Add Customer</span>
                    </Button>
                </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="stat-card">
                    <div className="flex items-center justify-between mb-2">
                        <span className="stat-label">Total Customers</span>
                        <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                            <Users className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="stat-value">{stats.totalCustomers}</div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Registered in store</p>
                </div>

                <div className="stat-card">
                    <div className="flex items-center justify-between mb-2">
                        <span className="stat-label">Repeat Buyers</span>
                        <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                            <ShoppingBag className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="stat-value">{stats.repeatBuyers}</div>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                        {stats.totalCustomers > 0 ? Math.round((stats.repeatBuyers / stats.totalCustomers) * 100) : 0}% repeat rate
                    </p>
                </div>

                <div className="stat-card">
                    <div className="flex items-center justify-between mb-2">
                        <span className="stat-label">Customer Revenue</span>
                        <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                            <IndianRupee className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="stat-value">₹{stats.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Lifetime customer spend</p>
                </div>

                <div className="stat-card">
                    <div className="flex items-center justify-between mb-2">
                        <span className="stat-label">GST Registered</span>
                        <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400">
                            <ShieldCheck className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="stat-value">{stats.gstinCount}</div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">B2B GSTIN profiles</p>
                </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="card space-y-4 !p-4">
                <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                    {/* Search Input */}
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by name, phone, email, GSTIN..."
                            className="pl-10 pr-9 text-sm"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>

                    {/* Quick Filters */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            onClick={() => setActiveFilter('ALL')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                activeFilter === 'ALL'
                                    ? 'bg-primary-600 text-white shadow-sm'
                                    : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                            }`}
                        >
                            All ({customers.length})
                        </button>
                        <button
                            onClick={() => setActiveFilter('REPEAT')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                activeFilter === 'REPEAT'
                                    ? 'bg-primary-600 text-white shadow-sm'
                                    : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                            }`}
                        >
                            Repeat ({stats.repeatBuyers})
                        </button>
                        <button
                            onClick={() => setActiveFilter('WITH_GSTIN')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                activeFilter === 'WITH_GSTIN'
                                    ? 'bg-primary-600 text-white shadow-sm'
                                    : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                            }`}
                        >
                            With GSTIN ({stats.gstinCount})
                        </button>
                        <button
                            onClick={() => setActiveFilter('WITH_PHONE')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                activeFilter === 'WITH_PHONE'
                                    ? 'bg-primary-600 text-white shadow-sm'
                                    : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                            }`}
                        >
                            With Phone
                        </button>
                    </div>

                    {/* Sort Dropdown */}
                    <div className="flex items-center gap-2 self-end md:self-auto">
                        <span className="text-xs text-gray-500 whitespace-nowrap">Sort:</span>
                        <select
                            value={sortBy}
                            onChange={(e: any) => setSortBy(e.target.value)}
                            className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-lg text-xs py-1.5 px-2.5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="NEWEST">Newest Added</option>
                            <option value="NAME_ASC">Name (A-Z)</option>
                            <option value="NAME_DESC">Name (Z-A)</option>
                            <option value="HIGHEST_SPEND">Highest Lifetime Spend</option>
                            <option value="MOST_ORDERS">Most Orders</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Customers Table */}
            <div className="card overflow-hidden !p-0">
                <div className="overflow-x-auto">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                <th>Contact Details</th>
                                <th>GSTIN</th>
                                <th>Purchases</th>
                                <th>Total Spend</th>
                                <th>Last Order</th>
                                <th className="text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i}>
                                        <td colSpan={7} className="py-4 px-4">
                                            <Skeleton className="h-8 w-full" />
                                        </td>
                                    </tr>
                                ))
                            ) : paginatedCustomers.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-12">
                                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                                            <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-400 mb-3">
                                                <Users className="w-8 h-8" />
                                            </div>
                                            <p className="text-base font-medium text-gray-900 dark:text-white">
                                                {searchQuery ? 'No customers match your search' : 'No customers found'}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                                                {searchQuery
                                                    ? 'Try searching with a different name, phone number, or GSTIN.'
                                                    : 'Start building your customer base by clicking "Add Customer".'}
                                            </p>
                                            {searchQuery ? (
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setSearchQuery('')}
                                                    className="mt-4"
                                                >
                                                    Clear Search
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="primary"
                                                    size="sm"
                                                    onClick={openAddModal}
                                                    className="mt-4"
                                                >
                                                    <UserPlus className="w-4 h-4" />
                                                    Add First Customer
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedCustomers.map((customer) => {
                                    const summary = getCustomerSummary(customer);
                                    const colorClass = getAvatarColor(customer.name);
                                    const initials = getInitials(customer.name);

                                    return (
                                        <tr key={customer.id} className="group">
                                            {/* Customer Name & Avatar */}
                                            <td>
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs border ${colorClass} shrink-0`}>
                                                        {initials}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <button
                                                            onClick={() => setViewingCustomer(customer)}
                                                            className="font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 text-left truncate block transition-colors"
                                                        >
                                                            {customer.name}
                                                        </button>
                                                        <span className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                                                            <Calendar className="w-3 h-3" />
                                                            {new Date(customer.createdAt).toLocaleDateString('en-IN', {
                                                                day: 'numeric',
                                                                month: 'short',
                                                                year: 'numeric'
                                                            })}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Contact Details */}
                                            <td>
                                                <div className="space-y-1">
                                                    {customer.phone ? (
                                                        <div className="flex items-center gap-1.5 text-xs font-mono text-gray-700 dark:text-gray-300">
                                                            <Phone className="w-3.5 h-3.5 text-gray-400" />
                                                            <span>{customer.phone}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-gray-400 italic">No phone</span>
                                                    )}
                                                    {customer.email && (
                                                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                                                            <Mail className="w-3 h-3 text-gray-400 shrink-0" />
                                                            <span className="truncate">{customer.email}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>

                                            {/* GSTIN */}
                                            <td>
                                                {customer.gstin ? (
                                                    <span className="badge badge-info font-mono text-[11px] uppercase tracking-wider">
                                                        {customer.gstin}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">—</span>
                                                )}
                                            </td>

                                            {/* Purchases Count */}
                                            <td>
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    summary.totalOrders >= 2
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                                        : summary.totalOrders === 1
                                                            ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                                                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                                                }`}>
                                                    {summary.totalOrders === 1 ? '1 Order' : `${summary.totalOrders} Orders`}
                                                </span>
                                            </td>

                                            {/* Total Spend */}
                                            <td className="font-semibold text-gray-900 dark:text-white">
                                                ₹{summary.totalSpent.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>

                                            {/* Last Order Date */}
                                            <td className="text-xs text-gray-500 dark:text-gray-400">
                                                {summary.lastOrderDate ? (
                                                    new Date(summary.lastOrderDate).toLocaleDateString('en-IN', {
                                                        day: 'numeric',
                                                        month: 'short',
                                                        year: 'numeric'
                                                    })
                                                ) : (
                                                    <span className="text-gray-400 italic">No orders</span>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        onClick={() => setViewingCustomer(customer)}
                                                        className="p-1.5 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-dark-border transition-colors"
                                                        title="View History & Profile"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleStartSaleForCustomer(customer)}
                                                        className="p-1.5 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                                                        title="Start New Sale for Customer"
                                                    >
                                                        <ShoppingBag className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => openEditModal(customer)}
                                                        className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                                                        title="Edit Customer"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => setCustomerToDelete(customer)}
                                                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                                                        title="Delete Customer"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                {!loading && filteredCustomers.length > 0 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-gray-200 dark:border-dark-border bg-gray-50/50 dark:bg-dark-card/50">
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>
                                Showing{' '}
                                <strong className="font-semibold text-gray-800 dark:text-gray-200">
                                    {(currentPage - 1) * itemsPerPage + 1}
                                </strong>{' '}
                                to{' '}
                                <strong className="font-semibold text-gray-800 dark:text-gray-200">
                                    {Math.min(currentPage * itemsPerPage, filteredCustomers.length)}
                                </strong>{' '}
                                of{' '}
                                <strong className="font-semibold text-gray-800 dark:text-gray-200">
                                    {filteredCustomers.length}
                                </strong>{' '}
                                customers
                            </span>
                            <span className="mx-2">•</span>
                            <label className="flex items-center gap-1.5">
                                <span>Rows:</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => setItemsPerPage(Number(e.target.value))}
                                    className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300"
                                >
                                    <option value={10}>10</option>
                                    <option value={25}>25</option>
                                    <option value={50}>50</option>
                                </select>
                            </label>
                        </div>

                        <div className="flex items-center gap-1">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                            >
                                <ChevronLeft className="w-4 h-4" />
                                <span className="hidden sm:inline">Prev</span>
                            </Button>

                            <div className="px-3 text-xs font-medium text-gray-700 dark:text-gray-300">
                                Page {currentPage} of {totalPages}
                            </div>

                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                            >
                                <span className="hidden sm:inline">Next</span>
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Modal 1: Add / Edit Customer Modal */}
            <Modal
                isOpen={showFormModal}
                onClose={() => {
                    if (!formSaving) {
                        setShowFormModal(false);
                        setEditingCustomer(null);
                    }
                }}
                title={editingCustomer ? 'Edit Customer Profile' : 'Add New Customer'}
                size="md"
            >
                <form onSubmit={handleFormSubmit} className="space-y-4">
                    <div>
                        <Input
                            label="Customer Full Name *"
                            value={formData.name}
                            maxLength={50}
                            onChange={(e) => {
                                setFormData({ ...formData, name: e.target.value.slice(0, 50) });
                                if (formErrors.name) setFormErrors({ ...formErrors, name: '' });
                            }}
                            placeholder="e.g. Rahul Sharma"
                            error={formErrors.name}
                            required
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <Input
                                label="Phone Number"
                                value={formData.phone}
                                maxLength={14}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    const digits = raw.replace(/\D/g, '');
                                    const maxDigits = raw.startsWith('+') ? 13 : 10;
                                    const capped = raw.startsWith('+') ? `+${digits.slice(0, 13)}` : digits.slice(0, 10);
                                    setFormData({ ...formData, phone: capped });
                                    if (formErrors.phone) setFormErrors({ ...formErrors, phone: '' });
                                }}
                                placeholder="e.g. 9876543210"
                                error={formErrors.phone}
                            />
                            <p className="text-[11px] text-gray-400 mt-1">10-digit mobile number for lookups and WhatsApp.</p>
                        </div>

                        <div>
                            <Input
                                label="Email Address"
                                type="email"
                                value={formData.email}
                                maxLength={80}
                                onChange={(e) => {
                                    setFormData({ ...formData, email: e.target.value.slice(0, 80) });
                                    if (formErrors.email) setFormErrors({ ...formErrors, email: '' });
                                }}
                                placeholder="customer@example.com"
                                error={formErrors.email}
                            />
                        </div>
                    </div>

                    <div>
                        <Input
                            label="GSTIN (Optional)"
                            value={formData.gstin}
                            maxLength={15}
                            onChange={(e) => {
                                setFormData({ ...formData, gstin: e.target.value.toUpperCase().slice(0, 15) });
                                if (formErrors.gstin) setFormErrors({ ...formErrors, gstin: '' });
                            }}
                            placeholder="e.g. 32AAAAA0000A1Z5"
                            error={formErrors.gstin}
                        />
                        <p className="text-[11px] text-gray-400 mt-1">15-character GSTIN for B2B input tax credit.</p>
                    </div>

                    <div>
                        <label className="label">Address / Landmark</label>
                        <textarea
                            value={formData.address}
                            maxLength={200}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value.slice(0, 200) })}
                            placeholder="Building, street, town, postal code..."
                            rows={3}
                            className="input resize-none text-sm"
                        />
                    </div>

                    <div className="flex gap-2 pt-4 border-t border-gray-100 dark:border-dark-border">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setShowFormModal(false)}
                            disabled={formSaving}
                            className="flex-1"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={formSaving}
                            className="flex-1"
                        >
                            {formSaving ? 'Saving...' : editingCustomer ? 'Update Customer' : 'Create Customer'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* Modal 2: Customer 360 / Purchase History Modal */}
            {viewingCustomer && (
                <Modal
                    isOpen={Boolean(viewingCustomer)}
                    onClose={() => setViewingCustomer(null)}
                    title="Customer 360 Profile"
                    size="lg"
                >
                    <div className="space-y-6">
                        {/* Customer Header Card */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-gray-50 dark:bg-dark-card border border-gray-200 dark:border-dark-border">
                            <div className="flex items-center gap-3">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-base border ${getAvatarColor(viewingCustomer.name)} shrink-0`}>
                                    {getInitials(viewingCustomer.name)}
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                        {viewingCustomer.name}
                                        {viewingCustomer.gstin && (
                                            <span className="badge badge-info text-[10px] font-mono">
                                                GST: {viewingCustomer.gstin}
                                            </span>
                                        )}
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {viewingCustomer.phone && (
                                            <span className="flex items-center gap-1 font-mono">
                                                <Phone className="w-3.5 h-3.5 text-gray-400" />
                                                {viewingCustomer.phone}
                                            </span>
                                        )}
                                        {viewingCustomer.email && (
                                            <span className="flex items-center gap-1">
                                                <Mail className="w-3.5 h-3.5 text-gray-400" />
                                                {viewingCustomer.email}
                                            </span>
                                        )}
                                        {viewingCustomer.address && (
                                            <span className="flex items-center gap-1">
                                                <MapPin className="w-3.5 h-3.5 text-gray-400" />
                                                {viewingCustomer.address}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => {
                                        handleStartSaleForCustomer(viewingCustomer);
                                        setViewingCustomer(null);
                                    }}
                                    className="flex-1 sm:flex-none"
                                >
                                    <ShoppingBag className="w-4 h-4" />
                                    New Sale
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                        const c = viewingCustomer;
                                        setViewingCustomer(null);
                                        openEditModal(c);
                                    }}
                                    className="flex-1 sm:flex-none"
                                >
                                    <Edit2 className="w-4 h-4" />
                                    Edit
                                </Button>
                            </div>
                        </div>

                        {/* Customer Metrics */}
                        {(() => {
                            const summary = getCustomerSummary(viewingCustomer);
                            return (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border">
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Total Spent</p>
                                        <p className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">
                                            ₹{summary.totalSpent.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                    </div>
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border">
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Total Orders</p>
                                        <p className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">
                                            {summary.totalOrders}
                                        </p>
                                    </div>
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border">
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Avg. Order Value</p>
                                        <p className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">
                                            ₹{summary.averageOrderValue.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                        </p>
                                    </div>
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border">
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Last Purchase</p>
                                        <p className="text-xs font-semibold text-gray-900 dark:text-white mt-1.5">
                                            {summary.lastOrderDate ? new Date(summary.lastOrderDate).toLocaleDateString('en-IN', {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric'
                                            }) : 'None'}
                                        </p>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Recent Invoices Table */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                                    <ShoppingBag className="w-4 h-4 text-primary-500" />
                                    Purchase History
                                </h4>
                                {viewingCustomer.phone && (
                                    <button
                                        onClick={() => {
                                            navigate('/sales');
                                        }}
                                        className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 flex items-center gap-1"
                                    >
                                        View in Sales History
                                        <ExternalLink className="w-3 h-3" />
                                    </button>
                                )}
                            </div>

                            {(() => {
                                const summary = getCustomerSummary(viewingCustomer);
                                if (summary.sales.length === 0) {
                                    return (
                                        <div className="text-center py-8 border border-dashed border-gray-200 dark:border-dark-border rounded-xl">
                                            <p className="text-xs text-gray-500">No recorded purchases for this customer yet.</p>
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                onClick={() => {
                                                    handleStartSaleForCustomer(viewingCustomer);
                                                    setViewingCustomer(null);
                                                }}
                                                className="mt-3"
                                            >
                                                <ShoppingBag className="w-3.5 h-3.5" />
                                                Create First Sale
                                            </Button>
                                        </div>
                                    );
                                }

                                return (
                                    <div className="border border-gray-200 dark:border-dark-border rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                                        <table className="table text-xs">
                                            <thead>
                                                <tr>
                                                    <th>Bill #</th>
                                                    <th>Date & Time</th>
                                                    <th>Payment</th>
                                                    <th>Status</th>
                                                    <th className="text-right">Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {summary.sales.map((sale) => (
                                                    <tr key={sale.id}>
                                                        <td className="font-mono font-semibold">#{sale.billNo}</td>
                                                        <td className="text-gray-500">
                                                            {new Date(sale.createdAt).toLocaleString('en-IN', {
                                                                day: 'numeric',
                                                                month: 'short',
                                                                year: 'numeric',
                                                                hour: '2-digit',
                                                                minute: '2-digit'
                                                            })}
                                                        </td>
                                                        <td>
                                                            <span className="badge badge-info text-[10px]">
                                                                {sale.paymentMethod}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <span className="badge badge-success text-[10px]">
                                                                {sale.status}
                                                            </span>
                                                        </td>
                                                        <td className="text-right font-bold">
                                                            ₹{sale.grandTotal.toFixed(2)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })()}
                        </div>

                        <div className="flex justify-end pt-2">
                            <Button variant="secondary" onClick={() => setViewingCustomer(null)}>
                                Close
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Modal 3: Delete Confirmation Dialog (Strict Rule: Zero native confirm) */}
            <ConfirmDialog
                isOpen={Boolean(customerToDelete)}
                onClose={() => setCustomerToDelete(null)}
                onConfirm={handleDeleteConfirm}
                title="Delete Customer Profile"
                message={`Are you sure you want to delete customer "${customerToDelete?.name}"?\n\nThis will permanently remove their contact info and GST records from your store. Past invoices will keep their recorded customer name.`}
                confirmText={deleting ? 'Deleting...' : 'Delete Customer'}
                variant="danger"
                loading={deleting}
            />
        </div>
    );
};
export default Customers;
