import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    ShieldCheck, 
    Shield,
    Search, 
    RefreshCw, 
    ShoppingCart, 
    Package, 
    BarChart3, 
    Filter,
    Check, 
    AlertCircle,
    ChevronDown,
    ChevronUp,
    User,
    Lock,
    DollarSign,
    Calendar,
    Boxes,
    Wallet,
    Sliders,
    UserCog,
    EyeOff
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
    createdAt?: string;

    // 1. POS & Checkout
    permAddItem: boolean;
    permEditSales: boolean;
    permChangePayment: boolean;
    permVoidSale: boolean;
    permBackDateSale: boolean;
    maxDiscount: number;

    // 2. Garment Catalogue & Pricing
    permManageProducts: boolean;
    permDeleteProduct: boolean;
    permPrintSticker: boolean;
    permViewCostPrice: boolean;

    // 3. Stock & Inventory
    permManageInventory: boolean;

    // 4. Cash Register & Shifts
    permManageCashDrawer: boolean;

    // 5. Reports & Administration
    permViewReports: boolean;
    permViewSales: boolean;
    permViewGstReports: boolean;
    permViewInsights: boolean;
    permDeleteAudit: boolean;
    permEditSettings: boolean;
    permManageUsers: boolean;
}

type PermissionKey = keyof Omit<UserPermission, 'id' | 'name' | 'username' | 'role' | 'isActive' | 'createdAt' | 'maxDiscount'>;

type RoleFilter = 'ALL' | 'CASHIER' | 'ADMIN';
type StatusFilter = 'ACTIVE' | 'ALL' | 'INACTIVE';
type PresetRole = 'CASHIER' | 'SENIOR_CASHIER' | 'SUPERVISOR' | 'MANAGER';

export const Permissions: React.FC = () => {
    const navigate = useNavigate();
    const { user: currentUser } = useAuthStore();
    const [users, setUsers] = useState<UserPermission[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE');
    const [savingUserId, setSavingUserId] = useState<string | null>(null);
    const [expandedUserIds, setExpandedUserIds] = useState<string[]>([]);

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
                // Expand the first non-admin cashier by default for convenience
                const firstCashier = res.data.find((u: UserPermission) => u.role !== 'ADMIN' && u.isActive);
                if (firstCashier) {
                    setExpandedUserIds([firstCashier.id]);
                }
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

    const toggleExpand = (userId: string) => {
        setExpandedUserIds(prev => 
            prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
        );
    };

    const expandAll = () => {
        setExpandedUserIds(users.map(u => u.id));
    };

    const collapseAll = () => {
        setExpandedUserIds([]);
    };

    const togglePermission = async (userId: string, field: PermissionKey) => {
        const target = users.find(u => u.id === userId);
        if (!target || target.role === 'ADMIN') return;

        const previousValue = Boolean(target[field]);
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

    const applyPreset = async (userId: string, preset: PresetRole) => {
        const target = users.find(u => u.id === userId);
        if (!target || target.role === 'ADMIN') return;

        let presetData: Partial<UserPermission> = {};
        let label = '';

        switch (preset) {
            case 'CASHIER':
                label = 'Standard Cashier';
                presetData = {
                    permAddItem: true,
                    permPrintSticker: true,
                    permManageCashDrawer: true,
                    permEditSales: false,
                    permChangePayment: false,
                    permVoidSale: false,
                    permBackDateSale: false,
                    permManageProducts: false,
                    permDeleteProduct: false,
                    permViewCostPrice: false,
                    permManageInventory: false,
                    permViewReports: false,
                    permViewSales: false,
                    permViewGstReports: false,
                    permViewInsights: false,
                    permDeleteAudit: false,
                    permEditSettings: false,
                    permManageUsers: false,
                    maxDiscount: 0,
                };
                break;
            case 'SENIOR_CASHIER':
                label = 'Senior Cashier';
                presetData = {
                    permAddItem: true,
                    permPrintSticker: true,
                    permManageCashDrawer: true,
                    permEditSales: true,
                    permChangePayment: true,
                    permVoidSale: false,
                    permBackDateSale: false,
                    permManageProducts: false,
                    permDeleteProduct: false,
                    permViewCostPrice: false,
                    permManageInventory: false,
                    permViewReports: false,
                    permViewSales: true,
                    permViewGstReports: false,
                    permViewInsights: false,
                    permDeleteAudit: false,
                    permEditSettings: false,
                    permManageUsers: false,
                    maxDiscount: 10,
                };
                break;
            case 'SUPERVISOR':
                label = 'Store Supervisor';
                presetData = {
                    permAddItem: true,
                    permPrintSticker: true,
                    permManageCashDrawer: true,
                    permEditSales: true,
                    permChangePayment: true,
                    permVoidSale: true,
                    permBackDateSale: false,
                    permManageProducts: true,
                    permDeleteProduct: false,
                    permViewCostPrice: false,
                    permManageInventory: true,
                    permViewReports: true,
                    permViewSales: true,
                    permViewGstReports: true,
                    permViewInsights: true,
                    permDeleteAudit: false,
                    permEditSettings: false,
                    permManageUsers: false,
                    maxDiscount: 15,
                };
                break;
            case 'MANAGER':
                label = 'Store Manager';
                presetData = {
                    permAddItem: true,
                    permPrintSticker: true,
                    permManageCashDrawer: true,
                    permEditSales: true,
                    permChangePayment: true,
                    permVoidSale: true,
                    permBackDateSale: true,
                    permManageProducts: true,
                    permDeleteProduct: true,
                    permViewCostPrice: true,
                    permManageInventory: true,
                    permViewReports: true,
                    permViewSales: true,
                    permViewGstReports: true,
                    permViewInsights: true,
                    permDeleteAudit: true,
                    permEditSettings: true,
                    permManageUsers: false,
                    maxDiscount: 25,
                };
                break;
        }

        // Optimistic update
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...presetData } : u));
        setSavingUserId(userId);

        try {
            const res = await window.electronAPI.users.update(userId, {
                data: presetData,
                updatedBy: currentUser?.id || ''
            });

            if (res.success) {
                showToast(`Applied "${label}" template successfully`, 'success');
            } else {
                showToast(res.error || 'Failed to apply template', 'error');
                loadUsers();
            }
        } catch (error: any) {
            showToast('Failed to apply template: ' + error.message, 'error');
            loadUsers();
        } finally {
            setSavingUserId(null);
        }
    };

    const filteredUsers = useMemo(() => {
        return users.filter(u => {
            const matchesQuery = 
                u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                u.username.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
            const matchesStatus = 
                statusFilter === 'ALL' 
                    ? true 
                    : statusFilter === 'ACTIVE' 
                    ? u.isActive !== false 
                    : u.isActive === false;

            return matchesQuery && matchesRole && matchesStatus;
        });
    }, [users, searchQuery, roleFilter, statusFilter]);

    const renderToggleSwitch = (user: UserPermission, field: PermissionKey, title: string, subtitle?: string) => {
        const hasPerm = Boolean(user[field]);
        const isBusy = savingUserId === user.id;

        return (
            <div className="flex items-start justify-between gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <div className="flex-1 min-w-0 pr-1">
                    <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                        {title}
                    </div>
                    {subtitle && (
                        <div className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug mt-0.5">
                            {subtitle}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => togglePermission(user.id, field)}
                    disabled={isBusy}
                    aria-label={title}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 mt-0.5 ${
                        hasPerm ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'
                    } ${isBusy ? 'opacity-70 cursor-wait' : 'cursor-pointer'}`}
                >
                    <span 
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                            hasPerm ? 'translate-x-4' : 'translate-x-1'
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
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2.5">
                        <ShieldCheck className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
                        User Permissions & Staff Access
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
                        Configure role boundaries, allowed operational actions, and discount limits for store employees.
                    </p>
                </div>
                <div className="flex items-center gap-2 self-stretch sm:self-auto">
                    <Button 
                        variant="secondary" 
                        onClick={() => navigate('/users')}
                        className="flex items-center gap-1.5 text-sm font-medium"
                    >
                        <UserCog className="w-4 h-4 text-gray-500" />
                        Manage Accounts
                    </Button>
                    <Button 
                        variant="secondary" 
                        onClick={loadUsers} 
                        disabled={loading} 
                        className="flex items-center gap-1.5 text-sm font-medium"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-2xl p-4 shadow-xs space-y-3">
                <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Search staff by name or username..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-9 text-xs w-full"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Role Filter */}
                        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-800 text-xs">
                            <button
                                type="button"
                                onClick={() => setRoleFilter('ALL')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                                    roleFilter === 'ALL'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-2xs font-bold'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900'
                                }`}
                            >
                                All Roles ({users.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setRoleFilter('CASHIER')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                                    roleFilter === 'CASHIER'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-2xs font-bold'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900'
                                }`}
                            >
                                Cashiers ({users.filter(u => u.role === 'CASHIER').length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setRoleFilter('ADMIN')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                                    roleFilter === 'ADMIN'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-2xs font-bold'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900'
                                }`}
                            >
                                Admins ({users.filter(u => u.role === 'ADMIN').length})
                            </button>
                        </div>

                        {/* Status Filter */}
                        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-800 text-xs">
                            <button
                                type="button"
                                onClick={() => setStatusFilter('ACTIVE')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                                    statusFilter === 'ACTIVE'
                                        ? 'bg-white dark:bg-gray-700 text-emerald-700 dark:text-emerald-300 shadow-2xs font-bold'
                                        : 'text-gray-500 dark:text-gray-400'
                                }`}
                            >
                                Active Staff
                            </button>
                            <button
                                type="button"
                                onClick={() => setStatusFilter('ALL')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                                    statusFilter === 'ALL'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-2xs font-bold'
                                        : 'text-gray-500 dark:text-gray-400'
                                }`}
                            >
                                All Status
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-2 px-1">
                    <span>Showing <strong>{filteredUsers.length}</strong> staff profiles</span>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={expandAll}
                            className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                        >
                            Expand all
                        </button>
                        <span>•</span>
                        <button
                            type="button"
                            onClick={collapseAll}
                            className="text-gray-500 hover:underline font-medium"
                        >
                            Collapse all
                        </button>
                    </div>
                </div>
            </div>

            {/* Staff Cards List */}
            <div className="space-y-4">
                {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-200 dark:border-dark-border p-4 animate-pulse">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-gray-700" />
                                    <div className="space-y-1.5">
                                        <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                                        <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                                    </div>
                                </div>
                                <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded-full" />
                            </div>
                        </div>
                    ))
                ) : filteredUsers.length === 0 ? (
                    <div className="p-12 text-center bg-white dark:bg-dark-card rounded-2xl border border-gray-200 dark:border-dark-border text-gray-400 space-y-2">
                        <User className="w-8 h-8 mx-auto opacity-30" />
                        <div className="text-sm font-medium">No staff members match the selected filters.</div>
                        <div className="text-xs">Try selecting a different role or search query.</div>
                    </div>
                ) : (
                    filteredUsers.map((user) => {
                        const isAdmin = user.role === 'ADMIN';
                        const isExpanded = expandedUserIds.includes(user.id);
                        const isBusy = savingUserId === user.id;

                        return (
                            <div
                                key={user.id}
                                className={`bg-white dark:bg-dark-card rounded-2xl border transition-all shadow-xs overflow-hidden ${
                                    !user.isActive
                                        ? 'opacity-60 border-gray-200 dark:border-gray-800'
                                        : isAdmin
                                        ? 'border-purple-200 dark:border-purple-900/50 bg-gradient-to-r from-purple-50/20 to-transparent'
                                        : 'border-gray-200 dark:border-dark-border'
                                }`}
                            >
                                {/* Card Header / Summary Row */}
                                <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-[200px]">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-xs ${
                                            isAdmin 
                                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' 
                                                : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                                        }`}>
                                            {user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-sm text-gray-900 dark:text-white">
                                                    {user.name}
                                                </span>
                                                <span className="text-xs text-gray-400 font-mono">
                                                    @{user.username}
                                                </span>
                                                {isAdmin ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                                                        <Shield className="w-3 h-3" />
                                                        Admin
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                                        Cashier
                                                    </span>
                                                )}
                                                {!user.isActive && (
                                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                                        Deactivated
                                                    </span>
                                                )}
                                            </div>

                                            {/* Quick Summary Subline */}
                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                                                {isAdmin ? (
                                                    <span className="text-purple-600 dark:text-purple-400 font-medium">
                                                        Full Administrative Access (Zero Restrictions)
                                                    </span>
                                                ) : (
                                                    <>
                                                        <span>
                                                            Max Discount: <strong className="text-gray-800 dark:text-gray-200">{user.maxDiscount || 0}%</strong>
                                                        </span>
                                                        <span>•</span>
                                                        <span>
                                                            Stock Audit: <strong className={user.permManageInventory ? 'text-emerald-600' : 'text-gray-400'}>{user.permManageInventory ? 'Allowed' : 'Locked'}</strong>
                                                        </span>
                                                        <span>•</span>
                                                        <span>
                                                            Wholesale Cost: <strong className={user.permViewCostPrice ? 'text-emerald-600' : 'text-gray-400'}>{user.permViewCostPrice ? 'Visible' : 'Hidden'}</strong>
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Buttons: Presets & Expand */}
                                    <div className="flex items-center gap-2">
                                        {!isAdmin && (
                                            <div className="hidden lg:flex items-center gap-1.5 p-1 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/60 text-xs">
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-1.5">Template:</span>
                                                <button
                                                    type="button"
                                                    onClick={() => applyPreset(user.id, 'CASHIER')}
                                                    disabled={isBusy}
                                                    title="Standard Cashier (Scan items, print stickers, cash drawer, 0% discount)"
                                                    className="px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-gray-700 hover:text-indigo-600 shadow-2xs transition-colors"
                                                >
                                                    Cashier
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => applyPreset(user.id, 'SENIOR_CASHIER')}
                                                    disabled={isBusy}
                                                    title="Senior Cashier (Billing, exchanges, payment changes, 10% discount cap)"
                                                    className="px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-gray-700 hover:text-indigo-600 shadow-2xs transition-colors"
                                                >
                                                    Senior
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => applyPreset(user.id, 'SUPERVISOR')}
                                                    disabled={isBusy}
                                                    title="Store Supervisor (POS, products, stocktake, reports, 15% discount cap)"
                                                    className="px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-gray-700 hover:text-indigo-600 shadow-2xs transition-colors"
                                                >
                                                    Supervisor
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => applyPreset(user.id, 'MANAGER')}
                                                    disabled={isBusy}
                                                    title="Store Manager (Full operations, reports, insights, wholesale costs, 25% discount)"
                                                    className="px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-gray-700 hover:text-indigo-600 shadow-2xs transition-colors"
                                                >
                                                    Manager
                                                </button>
                                            </div>
                                        )}

                                        {!isAdmin && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => toggleExpand(user.id)}
                                                className="flex items-center gap-1.5 text-xs font-semibold"
                                            >
                                                <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                                                <span>{isExpanded ? 'Hide Permissions' : 'Configure Permissions'}</span>
                                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                {/* Expanded Granular Controls (For Cashiers / Staff) */}
                                {!isAdmin && isExpanded && (
                                    <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/20 p-5 space-y-5 animate-in fade-in duration-200">
                                        {/* Mobile Presets Bar (shown on smaller screens) */}
                                        <div className="lg:hidden flex flex-wrap items-center gap-1.5 pb-3 border-b border-gray-200 dark:border-gray-800">
                                            <span className="text-[11px] font-bold text-gray-500">Quick Templates:</span>
                                            <button
                                                type="button"
                                                onClick={() => applyPreset(user.id, 'CASHIER')}
                                                disabled={isBusy}
                                                className="px-2 py-1 text-xs rounded bg-white dark:bg-gray-800 border"
                                            >
                                                Cashier
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => applyPreset(user.id, 'SENIOR_CASHIER')}
                                                disabled={isBusy}
                                                className="px-2 py-1 text-xs rounded bg-white dark:bg-gray-800 border"
                                            >
                                                Senior
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => applyPreset(user.id, 'SUPERVISOR')}
                                                disabled={isBusy}
                                                className="px-2 py-1 text-xs rounded bg-white dark:bg-gray-800 border"
                                            >
                                                Supervisor
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => applyPreset(user.id, 'MANAGER')}
                                                disabled={isBusy}
                                                className="px-2 py-1 text-xs rounded bg-white dark:bg-gray-800 border"
                                            >
                                                Manager
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                                            {/* Column 1: POS & Checkout */}
                                            <div className="bg-white dark:bg-dark-card p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 shadow-2xs space-y-1">
                                                <div className="flex items-center gap-2 pb-2 mb-1 border-b border-blue-50 dark:border-blue-900/20 text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                                                    <ShoppingCart className="w-4 h-4" />
                                                    <span>Point of Sale & Billing</span>
                                                </div>

                                                {renderToggleSwitch(user, 'permAddItem', 'Scan & Add Items', 'Add garments into billing cart')}
                                                {renderToggleSwitch(user, 'permEditSales', 'Process Exchanges / Edit', 'Process garment exchanges & revise bills')}
                                                {renderToggleSwitch(user, 'permChangePayment', 'Change Payment Mode', 'Switch payment method post-checkout')}
                                                {renderToggleSwitch(user, 'permVoidSale', 'Void Completed Bills', 'Cancel finalized transactions with reason')}
                                                {renderToggleSwitch(user, 'permBackDateSale', 'Back-Date Sales', 'Record bills for previous dates')}

                                                {/* Discount Allowance Limit */}
                                                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                                                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                                        Max Discount Allowance (%)
                                                    </label>
                                                    <div className="flex items-center gap-2">
                                                        <div className="relative flex-1">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={100}
                                                                step="any"
                                                                placeholder="0"
                                                                value={user.maxDiscount === 0 ? '' : (user.maxDiscount || '')}
                                                                onFocus={(e) => e.target.select()}
                                                                onChange={(e) => updateMaxDiscountLocal(user.id, e.target.value)}
                                                                onBlur={(e) => {
                                                                    const val = parseFloat(e.target.value) || 0;
                                                                    saveMaxDiscount(user.id, val);
                                                                }}
                                                                className="w-full pl-3 pr-8 py-1.5 text-xs font-bold font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                            />
                                                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">%</span>
                                                        </div>
                                                        <span className="text-[11px] text-gray-400">
                                                            {user.maxDiscount === 0 ? 'No discount' : `Cap: ${user.maxDiscount}%`}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Column 2: Products & Stock Management */}
                                            <div className="bg-white dark:bg-dark-card p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/30 shadow-2xs space-y-1">
                                                <div className="flex items-center gap-2 pb-2 mb-1 border-b border-emerald-50 dark:border-emerald-900/20 text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                                                    <Package className="w-4 h-4" />
                                                    <span>Products & Inventory</span>
                                                </div>

                                                {renderToggleSwitch(user, 'permManageProducts', 'Manage Product Catalogue', 'Add, edit item identity, barcodes, and MRP')}
                                                {renderToggleSwitch(user, 'permDeleteProduct', 'Deactivate / Delete Products', 'Remove garments from the active catalogue')}
                                                {renderToggleSwitch(user, 'permPrintSticker', 'Print Barcode Labels', 'Print thermal barcode stickers for garments')}
                                                
                                                {/* Gap Resolved: Stock Inventory Audits */}
                                                {renderToggleSwitch(user, 'permManageInventory', 'Stocktake & Inventory Audits', 'Audit rack counts, view stock logs, and make adjustments')}

                                                {/* Gap Resolved: Cost Price Visibility */}
                                                {renderToggleSwitch(user, 'permViewCostPrice', 'View Wholesale Cost Prices', 'Display supplier purchase costs and gross margins')}
                                            </div>

                                            {/* Column 3: Cash Register & Administration */}
                                            <div className="bg-white dark:bg-dark-card p-4 rounded-xl border border-purple-100 dark:border-purple-900/30 shadow-2xs space-y-1">
                                                <div className="flex items-center gap-2 pb-2 mb-1 border-b border-purple-50 dark:border-purple-900/20 text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                                                    <BarChart3 className="w-4 h-4" />
                                                    <span>Cash Register & Reports</span>
                                                </div>

                                                {/* Gap Resolved: Cash Drawer Management */}
                                                {renderToggleSwitch(user, 'permManageCashDrawer', 'Manage Cash Counter & Drawer', 'Open/close shifts, count cash, and record expenses')}

                                                {renderToggleSwitch(user, 'permViewSales', 'View Sales History', 'Access invoice history and past bills')}
                                                {renderToggleSwitch(user, 'permViewReports', 'View Financial Reports & Profit', 'View daily revenue, gross profit, and analysis')}
                                                {renderToggleSwitch(user, 'permViewGstReports', 'View GST Tax Reports', 'Access tax summaries and B2B/B2C filing')}
                                                {renderToggleSwitch(user, 'permViewInsights', 'Sales Forecasting & Insights', 'View 6-month demand outlook and restocking advice')}
                                                {renderToggleSwitch(user, 'permDeleteAudit', 'View Activity Log & Audit Trail', 'Allow viewing staff actions, price edits, and operational logs')}
                                                {renderToggleSwitch(user, 'permEditSettings', 'Edit Store Settings', 'Configure shop headers, printers, and backups')}
                                                {renderToggleSwitch(user, 'permManageUsers', 'Manage Staff Accounts', 'Create staff accounts and reset passwords')}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
