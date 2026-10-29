import React, { useEffect, useState } from 'react';
import { 
    ShieldCheck, 
    Search, 
    RefreshCw, 
    Percent, 
    ShoppingCart, 
    Package, 
    BarChart3, 
    Filter,
    Sparkles,
    UserCheck,
    Check,
    AlertCircle
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { showToast } from '../components/ui/Toast';
import { useAuthStore } from '../store/authStore';

interface UserPermission {
    id: string;
    name: string;
    username: string;
    role: string;
    isActive: boolean;
    // POS & Sales
    permAddItem: boolean;
    permEditSales: boolean;
    permChangePayment: boolean;
    permVoidSale: boolean;
    maxDiscount: number;
    // Catalog & Inventory
    permManageProducts: boolean;
    permDeleteProduct: boolean;
    permPrintSticker: boolean;
    // Analytics & Administration
    permViewReports: boolean;
    permViewSales: boolean;
    permViewGstReports: boolean;
    permViewInsights: boolean;
    permEditSettings: boolean;
    permManageUsers: boolean;
}

type PermissionKey = keyof Omit<UserPermission, 'id' | 'name' | 'username' | 'role' | 'isActive' | 'maxDiscount'>;

type RoleFilter = 'ALL' | 'CASHIER' | 'ADMIN';

export const Permissions: React.FC = () => {
    const [users, setUsers] = useState<UserPermission[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
    const [savingUserId, setSavingUserId] = useState<string | null>(null);
    const { user: currentUser } = useAuthStore();

    useEffect(() => {
        if (currentUser?.id) {
            loadUsers();
        }
    }, [currentUser?.id]);

    const loadUsers = async () => {
        try {
            setLoading(true);
            if (!currentUser?.id) return;

            const res = await window.electronAPI.users.list({ requestingUserId: currentUser?.id });
            if (res.success && Array.isArray(res.data)) {
                setUsers(res.data);
            } else {
                showToast(res.error || 'Failed to load staff list', 'error');
            }
        } catch (error: any) {
            console.error('Error loading users:', error);
            showToast('Error loading staff list: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const togglePermission = async (userId: string, field: PermissionKey) => {
        const target = users.find(u => u.id === userId);
        if (!target || target.role === 'ADMIN') return;

        const previousValue = target[field];
        const newValue = !previousValue;

        // Optimistic UI update
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, [field]: newValue } : u));
        setSavingUserId(userId);

        try {
            const res = await window.electronAPI.users.update(userId, {
                data: { [field]: newValue },
                updatedBy: currentUser?.id || ''
            });

            if (!res.success) {
                // Revert
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, [field]: previousValue } : u));
                showToast(res.error || 'Failed to update permission', 'error');
            }
        } catch (error: any) {
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, [field]: previousValue } : u));
            showToast('Update failed: ' + error.message, 'error');
        } finally {
            setSavingUserId(null);
        }
    };

    const updateMaxDiscountLocal = (userId: string, valStr: string) => {
        const num = parseFloat(valStr) || 0;
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, maxDiscount: num } : u));
    };

    const saveMaxDiscount = async (userId: string, value: number) => {
        const clamped = Math.min(100, Math.max(0, Math.round(value * 10) / 10));
        setSavingUserId(userId);

        try {
            const res = await window.electronAPI.users.update(userId, {
                data: { maxDiscount: clamped },
                updatedBy: currentUser?.id || ''
            });

            if (res.success) {
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, maxDiscount: clamped } : u));
                showToast(`Discount cap set to ${clamped}%`, 'success');
            } else {
                showToast(res.error || 'Failed to update discount limit', 'error');
            }
        } catch (error: any) {
            showToast('Discount update failed: ' + error.message, 'error');
        } finally {
            setSavingUserId(null);
        }
    };

    const applyPreset = async (userId: string, presetName: 'CASHIER' | 'SUPERVISOR') => {
        const target = users.find(u => u.id === userId);
        if (!target || target.role === 'ADMIN') return;

        const presetData: Partial<UserPermission> = presetName === 'CASHIER'
            ? {
                permAddItem: true,
                permPrintSticker: true,
                permEditSales: false,
                permChangePayment: false,
                permVoidSale: false,
                permManageProducts: false,
                permDeleteProduct: false,
                permViewReports: false,
                permViewSales: false,
                permViewGstReports: false,
                permViewInsights: false,
                permEditSettings: false,
                permManageUsers: false,
                maxDiscount: 0,
            }
            : {
                permAddItem: true,
                permPrintSticker: true,
                permEditSales: true,
                permChangePayment: true,
                permVoidSale: true,
                permManageProducts: true,
                permDeleteProduct: false,
                permViewReports: true,
                permViewSales: true,
                permViewGstReports: true,
                permViewInsights: true,
                permEditSettings: false,
                permManageUsers: false,
                maxDiscount: 15,
            };

        // Optimistic update
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...presetData } : u));
        setSavingUserId(userId);

        try {
            const res = await window.electronAPI.users.update(userId, {
                data: presetData,
                updatedBy: currentUser?.id || ''
            });

            if (res.success) {
                showToast(`Applied "${presetName === 'CASHIER' ? 'Standard Cashier' : 'Store Supervisor'}" preset`, 'success');
            } else {
                showToast(res.error || 'Failed to apply preset', 'error');
                loadUsers(); // reload actual
            }
        } catch (error: any) {
            showToast('Failed to apply preset: ' + error.message, 'error');
            loadUsers();
        } finally {
            setSavingUserId(null);
        }
    };

    const filteredUsers = users.filter(u => {
        const matchesQuery = 
            u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.username.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
        return matchesQuery && matchesRole;
    });

    const renderToggle = (user: UserPermission, field: PermissionKey, tooltip: string) => {
        const hasPerm = Boolean(user[field]);
        const isAdmin = user.role === 'ADMIN';

        if (isAdmin) {
            return (
                <div className="flex justify-center" title="Administrators have full access to all features">
                    <ShieldCheck className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
            );
        }

        const isBusy = savingUserId === user.id;

        return (
            <div className="flex justify-center" title={tooltip}>
                <button
                    type="button"
                    onClick={() => togglePermission(user.id, field)}
                    disabled={isBusy}
                    aria-label={tooltip}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                        hasPerm ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                    } ${isBusy ? 'opacity-70 cursor-wait' : 'cursor-pointer'}`}
                >
                    <span 
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                            hasPerm ? 'translate-x-6' : 'translate-x-1'
                        }`} 
                    />
                </button>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
                        User Permissions & Allowances
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
                        Manage granular access levels, allowed POS actions, and discount caps for store staff.
                    </p>
                </div>
                <Button variant="secondary" onClick={loadUsers} disabled={loading} className="flex items-center gap-2">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh Staff
                </Button>
            </div>

            {/* Controls Bar: Search & Role Filter */}
            <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-dark-border bg-gray-50/70 dark:bg-gray-800/40 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
                    <div className="relative max-w-sm w-full">
                        <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Search staff by name or username..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 h-10 w-full"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                            <Filter className="w-3.5 h-3.5" />
                            Role:
                        </span>
                        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-100 dark:bg-gray-800 text-xs">
                            <button
                                onClick={() => setRoleFilter('ALL')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                                    roleFilter === 'ALL'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
                                }`}
                            >
                                All ({users.length})
                            </button>
                            <button
                                onClick={() => setRoleFilter('CASHIER')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                                    roleFilter === 'CASHIER'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
                                }`}
                            >
                                Cashiers ({users.filter(u => u.role === 'CASHIER').length})
                            </button>
                            <button
                                onClick={() => setRoleFilter('ADMIN')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                                    roleFilter === 'ADMIN'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
                                }`}
                            >
                                Admins ({users.filter(u => u.role === 'ADMIN').length})
                            </button>
                        </div>
                    </div>
                </div>

                {/* Table with Grouped Categories */}
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        {/* Level 1: Category Header Groups */}
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-dark-border text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                                <th rowSpan={2} className="px-5 py-3 text-left bg-gray-100/90 dark:bg-gray-800/90 min-w-[200px] border-r border-gray-200 dark:border-dark-border sticky left-0 z-10">
                                    Staff Member
                                </th>
                                <th colSpan={5} className="py-2.5 text-center bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-r border-blue-200 dark:border-blue-900/40">
                                    <div className="flex items-center justify-center gap-1.5">
                                        <ShoppingCart className="w-3.5 h-3.5" />
                                        Point of Sale & Billing
                                    </div>
                                </th>
                                <th colSpan={3} className="py-2.5 text-center bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-r border-emerald-200 dark:border-emerald-900/40">
                                    <div className="flex items-center justify-center gap-1.5">
                                        <Package className="w-3.5 h-3.5" />
                                        Products & Catalog
                                    </div>
                                </th>
                                <th colSpan={6} className="py-2.5 text-center bg-purple-50/70 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300">
                                    <div className="flex items-center justify-center gap-1.5">
                                        <BarChart3 className="w-3.5 h-3.5" />
                                        Administration & Reports
                                    </div>
                                </th>
                            </tr>

                            {/* Level 2: Sub-columns */}
                            <tr className="bg-gray-50/80 dark:bg-gray-800/60 text-[11px] font-bold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-dark-border">
                                {/* POS sub-columns */}
                                <th className="px-3 py-2.5 text-center" title="Allow scanning or clicking products into cart">Add Items</th>
                                <th className="px-3 py-2.5 text-center" title="Allow editing finalized sales and issuing exchanges">Edit Sales</th>
                                <th className="px-3 py-2.5 text-center" title="Allow changing payment modes after checkout">Change Pymt</th>
                                <th className="px-3 py-2.5 text-center" title="Allow voiding completed invoices">Void Bill</th>
                                <th className="px-4 py-2.5 text-right border-r border-blue-200 dark:border-blue-900/40" title="Maximum bill discount % allowed (0% means NO discount allowed)">Max Disc (%)</th>

                                {/* Catalog sub-columns */}
                                <th className="px-3 py-2.5 text-center" title="Allow access to Products page to add or edit product catalog">Manage Catalog</th>
                                <th className="px-3 py-2.5 text-center" title="Allow permanently deleting products from the store catalog">Delete Items</th>
                                <th className="px-3 py-2.5 text-center border-r border-emerald-200 dark:border-emerald-900/40" title="Allow printing barcode stickers and labels">Print Stickers</th>

                                {/* Admin sub-columns */}
                                <th className="px-3 py-2.5 text-center" title="Allow viewing Dashboard revenue statistics">Dashboard</th>
                                <th className="px-3 py-2.5 text-center" title="Allow viewing Sales History invoices">Sales Hist</th>
                                <th className="px-3 py-2.5 text-center" title="Allow viewing Reports and GST tax summaries">Reports</th>
                                <th className="px-3 py-2.5 text-center" title="Allow viewing Sales Outlook & Business Insights">Business Insights</th>
                                <th className="px-3 py-2.5 text-center" title="Allow opening System & Store Settings">Settings</th>
                                <th className="px-3 py-2.5 text-center" title="Allow managing staff accounts and roles">Users</th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-gray-200 dark:divide-dark-border">
                            {filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={15} className="py-12 text-center text-gray-400">
                                        No staff members match the selected search or filter criteria.
                                    </td>
                                </tr>
                            ) : (
                                filteredUsers.map((user) => {
                                    const isAdmin = user.role === 'ADMIN';

                                    return (
                                        <tr key={user.id} className="hover:bg-gray-50/70 dark:hover:bg-gray-800/30 transition-colors">
                                            {/* Staff details + quick presets */}
                                            <td className="px-5 py-3.5 bg-white dark:bg-dark-card border-r border-gray-200 dark:border-dark-border sticky left-0 z-10">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div>
                                                        <div className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                                                            {user.name}
                                                            {isAdmin && (
                                                                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                                                                    Admin
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-gray-400">@{user.username}</div>
                                                    </div>

                                                    {!isAdmin && (
                                                        <div className="flex items-center gap-1" title="Quick Role Presets">
                                                            <button
                                                                type="button"
                                                                onClick={() => applyPreset(user.id, 'CASHIER')}
                                                                disabled={savingUserId === user.id}
                                                                className="text-[10px] px-1.5 py-1 rounded bg-gray-100 dark:bg-gray-700/60 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-600 dark:text-gray-300 hover:text-blue-600 transition-colors font-medium"
                                                                title="Reset to Standard Cashier (Add items + Sticker print only, 0% discount)"
                                                            >
                                                                Cashier
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => applyPreset(user.id, 'SUPERVISOR')}
                                                                disabled={savingUserId === user.id}
                                                                className="text-[10px] px-1.5 py-1 rounded bg-gray-100 dark:bg-gray-700/60 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-gray-600 dark:text-gray-300 hover:text-purple-600 transition-colors font-medium"
                                                                title="Set as Supervisor (POS + Products + Reports + 15% discount)"
                                                            >
                                                                Supervisor
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>

                                            {/* POS Toggles */}
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permAddItem', 'Add Items: Allows scanning and adding items into POS cart')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permEditSales', 'Edit Sales: Allows modifying finalized invoices & processing exchanges')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permChangePayment', 'Change Payment: Allows updating payment methods after checkout')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permVoidSale', 'Void Bill: Allows cancelling/voiding completed sales')}
                                            </td>
                                            <td className="px-4 py-3.5 text-right border-r border-blue-100 dark:border-blue-950">
                                                {isAdmin ? (
                                                    <span className="text-xs font-bold text-gray-400 uppercase">Unlimited</span>
                                                ) : (
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <div className="relative w-20">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={100}
                                                                step="any"
                                                                value={user.maxDiscount === 0 ? '0' : (user.maxDiscount || '')}
                                                                onChange={(e) => updateMaxDiscountLocal(user.id, e.target.value)}
                                                                onBlur={(e) => {
                                                                    const val = parseFloat(e.target.value) || 0;
                                                                    saveMaxDiscount(user.id, val);
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        const val = parseFloat((e.target as HTMLInputElement).value) || 0;
                                                                        saveMaxDiscount(user.id, val);
                                                                        (e.target as HTMLInputElement).blur();
                                                                    }
                                                                }}
                                                                placeholder="0"
                                                                title="Maximum discount % this cashier can apply on a bill. Setting 0 means NO discount allowed."
                                                                className="w-full pl-2 pr-6 py-1 text-xs font-mono text-right bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                                                            />
                                                            <Percent className="absolute right-1.5 top-2 w-3 h-3 text-gray-400 pointer-events-none" />
                                                        </div>
                                                    </div>
                                                )}
                                            </td>

                                            {/* Catalog Toggles */}
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permManageProducts', 'Manage Products: Access Products page to create & edit catalog')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permDeleteProduct', 'Delete Products: Permanently delete product entries from database')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center border-r border-emerald-100 dark:border-emerald-950">
                                                {renderToggle(user, 'permPrintSticker', 'Print Stickers: Access barcode & price sticker printing in catalog')}
                                            </td>

                                            {/* Admin & Reports Toggles */}
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permViewReports', 'Dashboard: Access overall dashboard analytics and charts')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permViewSales', 'Sales History: Access invoice history and reprint receipts')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permViewGstReports', 'Reports: Access comprehensive GST tax and financial sales reports')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permViewInsights', 'Business Insights: Access recorded sales outlook and audited-stock checks')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permEditSettings', 'Settings: Access store branding, printers, and system configuration')}
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                {renderToggle(user, 'permManageUsers', 'Manage Users: Access staff user accounts and permissions')}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Bottom Help Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50/70 dark:bg-blue-900/15 border border-blue-200/80 dark:border-blue-800/40 rounded-xl flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                    <div className="text-xs text-blue-900 dark:text-blue-200 space-y-1">
                        <p className="font-bold text-sm">Real-time Enforcement</p>
                        <p>Permission changes apply immediately across all open POS windows. Staff will be blocked from restricted routes without needing to restart the application.</p>
                    </div>
                </div>

                <div className="p-4 bg-amber-50/70 dark:bg-amber-900/15 border border-amber-200/80 dark:border-amber-800/40 rounded-xl flex items-start gap-3">
                    <Percent className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
                        <p className="font-bold text-sm">Strict Discount Caps</p>
                        <p>Setting <strong>0%</strong> strictly blocks the cashier from giving any discount. Setting <strong>10%</strong> caps the maximum allowable discount on any invoice to 10%.</p>
                    </div>
                </div>

                <div className="p-4 bg-purple-50/70 dark:bg-purple-900/15 border border-purple-200/80 dark:border-purple-800/40 rounded-xl flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400 mt-0.5 shrink-0" />
                    <div className="text-xs text-purple-900 dark:text-purple-200 space-y-1">
                        <p className="font-bold text-sm">1-Click Role Presets</p>
                        <p>Use the <strong>Cashier</strong> or <strong>Supervisor</strong> buttons next to a staff member's name to instantly apply recommended permission packages.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

