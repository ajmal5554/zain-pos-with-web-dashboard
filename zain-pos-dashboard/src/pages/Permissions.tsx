import { useEffect, useMemo, useState } from 'react';
import { 
    ShieldCheck, 
    Shield, 
    Lock, 
    Unlock, 
    Settings2, 
    Info, 
    Percent, 
    ShoppingCart, 
    Package, 
    Wallet, 
    BarChart3, 
    Sliders,
    Sparkles,
    User as UserIcon,
    Check
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { adminService, type AdminUser } from '@/features/admin/services/admin.service';
import { isDemoModeEnabled } from '@/lib/demo';
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
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface PermissionGroup {
    title: string;
    icon: React.ElementType;
    description: string;
    permissions: Array<{
        key: keyof AdminUser;
        label: string;
        desc: string;
    }>;
}

const PERMISSION_GROUPS: PermissionGroup[] = [
    {
        title: 'POS & Checkout',
        icon: ShoppingCart,
        description: 'Permissions controlling bill creation, cashier limits, and checkout tender.',
        permissions: [
            { key: 'permAddItem', label: 'Add Items to Cart', desc: 'Can scan and add items during sale' },
            { key: 'permEditSales', label: 'Edit / Exchange Bills', desc: 'Can process product exchanges and edit items' },
            { key: 'permChangePayment', label: 'Modify Payment Mode', desc: 'Can change payment method after bill completion' },
            { key: 'permVoidSale', label: 'Void / Cancel Bills', desc: 'Can void completed sales bills' },
            { key: 'permBackDateSale', label: 'Backdate Sales', desc: 'Can enter sales for past dates' },
        ]
    },
    {
        title: 'Catalogue & Garment Pricing',
        icon: Package,
        description: 'Permissions controlling products, labels, and wholesale cost privacy.',
        permissions: [
            { key: 'permManageProducts', label: 'Manage Products', desc: 'Can create and edit garment catalogue' },
            { key: 'permDeleteProduct', label: 'Delete Products', desc: 'Can remove items from product catalogue' },
            { key: 'permPrintSticker', label: 'Print Barcode Stickers', desc: 'Can generate and print thermal barcode labels' },
            { key: 'permViewCostPrice', label: 'View Cost Price', desc: 'Can see wholesale purchase costs and margins' },
        ]
    },
    {
        title: 'Inventory & Stock Counts',
        icon: Sliders,
        description: 'Permissions for stock movements and counts.',
        permissions: [
            { key: 'permManageInventory', label: 'Manage Stock & Audits', desc: 'Can adjust inventory quantities and record counts' },
        ]
    },
    {
        title: 'Cash Register & Shifts',
        icon: Wallet,
        description: 'Permissions for cash drawer reconciliation and petty cash expenses.',
        permissions: [
            { key: 'permManageCashDrawer', label: 'Cash Register & Expenses', desc: 'Can open/close shifts, count cash, and record expenses' },
        ]
    },
    {
        title: 'Reports & Administration',
        icon: BarChart3,
        description: 'Access to business intelligence, tax reports, and system settings.',
        permissions: [
            { key: 'permViewReports', label: 'General Reports', desc: 'Can view daily sales and general summaries' },
            { key: 'permViewSales', label: 'Sales History', desc: 'Can browse full completed invoice log' },
            { key: 'permViewGstReports', label: 'GST Tax Reports', desc: 'Can view tax slabs, HSN summaries, and tax exports' },
            { key: 'permViewInsights', label: 'Sales Forecasting', desc: 'Can view 1-6 month demand forecasts and restocking' },
            { key: 'permDeleteAudit', label: 'View Activity Logs', desc: 'Can inspect system audit records' },
            { key: 'permEditSettings', label: 'Edit Store Settings', desc: 'Can configure shop details and payment methods' },
            { key: 'permManageUsers', label: 'Manage Users', desc: 'Can create users and modify access permissions' },
        ]
    }
];

type PresetRole = 'CASHIER' | 'SENIOR_CASHIER' | 'SUPERVISOR' | 'MANAGER';

const ROLE_PRESETS: Record<PresetRole, Partial<AdminUser>> = {
    CASHIER: {
        permAddItem: true,
        permEditSales: false,
        permChangePayment: false,
        permVoidSale: false,
        permBackDateSale: false,
        permManageProducts: false,
        permDeleteProduct: false,
        permPrintSticker: true,
        permViewCostPrice: false,
        permManageInventory: false,
        permManageCashDrawer: true,
        permViewReports: false,
        permViewSales: true,
        permViewGstReports: false,
        permViewInsights: false,
        permDeleteAudit: false,
        permEditSettings: false,
        permManageUsers: false,
        maxDiscount: 10,
    },
    SENIOR_CASHIER: {
        permAddItem: true,
        permEditSales: true,
        permChangePayment: false,
        permVoidSale: true,
        permBackDateSale: false,
        permManageProducts: false,
        permDeleteProduct: false,
        permPrintSticker: true,
        permViewCostPrice: false,
        permManageInventory: false,
        permManageCashDrawer: true,
        permViewReports: true,
        permViewSales: true,
        permViewGstReports: false,
        permViewInsights: false,
        permDeleteAudit: false,
        permEditSettings: false,
        permManageUsers: false,
        maxDiscount: 15,
    },
    SUPERVISOR: {
        permAddItem: true,
        permEditSales: true,
        permChangePayment: true,
        permVoidSale: true,
        permBackDateSale: true,
        permManageProducts: true,
        permDeleteProduct: false,
        permPrintSticker: true,
        permViewCostPrice: true,
        permManageInventory: true,
        permManageCashDrawer: true,
        permViewReports: true,
        permViewSales: true,
        permViewGstReports: true,
        permViewInsights: true,
        permDeleteAudit: false,
        permEditSettings: false,
        permManageUsers: false,
        maxDiscount: 25,
    },
    MANAGER: {
        permAddItem: true,
        permEditSales: true,
        permChangePayment: true,
        permVoidSale: true,
        permBackDateSale: true,
        permManageProducts: true,
        permDeleteProduct: true,
        permPrintSticker: true,
        permViewCostPrice: true,
        permManageInventory: true,
        permManageCashDrawer: true,
        permViewReports: true,
        permViewSales: true,
        permViewGstReports: true,
        permViewInsights: true,
        permDeleteAudit: true,
        permEditSettings: false,
        permManageUsers: false,
        maxDiscount: 50,
    }
};

export default function PermissionsPage() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        void loadUsers();
    }, []);

    async function loadUsers() {
        try {
            setLoading(true);
            if (isDemoModeEnabled()) {
                const demoUsers: AdminUser[] = [
                    {
                        id: 'u-1',
                        username: 'admin',
                        name: 'Zain Store Owner',
                        role: 'ADMIN',
                        isActive: true,
                        permAddItem: true,
                        permEditSales: true,
                        permChangePayment: true,
                        permVoidSale: true,
                        permBackDateSale: true,
                        permManageProducts: true,
                        permDeleteProduct: true,
                        permPrintSticker: true,
                        permViewCostPrice: true,
                        permManageInventory: true,
                        permManageCashDrawer: true,
                        permViewReports: true,
                        permViewSales: true,
                        permViewGstReports: true,
                        permViewInsights: true,
                        permBulkUpdate: true,
                        permDeleteAudit: true,
                        permEditSettings: true,
                        permManageUsers: true,
                        maxDiscount: 100
                    },
                    {
                        id: 'u-2',
                        username: 'cashier1',
                        name: 'Nikhil (Cashier)',
                        role: 'CASHIER',
                        isActive: true,
                        ...ROLE_PRESETS.CASHIER,
                        maxDiscount: 10
                    } as AdminUser
                ];
                setUsers(demoUsers);
                setSelectedUserId('u-2');
                return;
            }
            const data = await adminService.getUsers();
            setUsers(data);
            const firstNonAdmin = data.find((u) => u.role !== 'ADMIN') || data[0];
            if (firstNonAdmin) setSelectedUserId(firstNonAdmin.id);
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to load permissions');
        } finally {
            setLoading(false);
        }
    }

    const selectedUser = useMemo(
        () => users.find((u) => u.id === selectedUserId) || users[0],
        [users, selectedUserId]
    );

    async function togglePermission(key: keyof AdminUser) {
        if (!selectedUser || selectedUser.role === 'ADMIN') return;
        const currentVal = Boolean(selectedUser[key]);
        const nextVal = !currentVal;

        const updatedUsers = users.map((u) =>
            u.id === selectedUser.id ? { ...u, [key]: nextVal } : u
        );
        setUsers(updatedUsers);

        if (isDemoModeEnabled()) return;

        try {
            await adminService.updateUser(selectedUser.id, { [key]: nextVal } as Partial<AdminUser>);
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to update permission');
            setUsers(users); // revert
        }
    }

    async function applyPreset(presetKey: PresetRole) {
        if (!selectedUser || selectedUser.role === 'ADMIN') return;
        const preset = ROLE_PRESETS[presetKey];

        const updatedUsers = users.map((u) =>
            u.id === selectedUser.id ? { ...u, ...preset } : u
        );
        setUsers(updatedUsers);

        if (isDemoModeEnabled()) {
            toast.success(`Applied ${presetKey} role template locally`);
            return;
        }

        try {
            setSaving(true);
            await adminService.updateUser(selectedUser.id, preset as Partial<AdminUser>);
            toast.success(`Applied ${presetKey} role template`);
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to apply template');
            setUsers(users);
        } finally {
            setSaving(false);
        }
    }

    async function handleMaxDiscountChange(val: number) {
        if (!selectedUser || selectedUser.role === 'ADMIN') return;
        const discount = Math.min(100, Math.max(0, val));

        const updatedUsers = users.map((u) =>
            u.id === selectedUser.id ? { ...u, maxDiscount: discount } : u
        );
        setUsers(updatedUsers);

        if (isDemoModeEnabled()) return;

        try {
            await adminService.updateUser(selectedUser.id, { maxDiscount: discount });
        } catch {
            toast.error('Failed to update discount limit');
            setUsers(users);
        }
    }

    if (loading) {
        return (
            <div className="flex-1 space-y-4 pb-12">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Access & Permissions</h2>
                        <p className="text-muted-foreground text-sm">Control feature access and operational limits per staff member.</p>
                    </div>
                </div>
                <div className="flex justify-center p-12 text-muted-foreground animate-pulse">
                    Loading permissions...
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 space-y-6 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Access & Permissions</h2>
                    <p className="text-muted-foreground text-sm">
                        Configure granular feature access and discount limits for store staff.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: User Selector */}
                <div className="lg:col-span-4 space-y-4">
                    <Card className="rounded-2xl">
                        <CardHeader>
                            <CardTitle className="text-base font-bold flex items-center gap-2">
                                <UserIcon className="w-4 h-4 text-primary" />
                                Store Staff Accounts
                            </CardTitle>
                            <CardDescription>Select a staff member to configure permissions</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 p-3">
                            {users.map((u) => {
                                const isSelected = u.id === selectedUser?.id;
                                const isAdmin = u.role === 'ADMIN';

                                return (
                                    <button
                                        key={u.id}
                                        onClick={() => setSelectedUserId(u.id)}
                                        className={cn(
                                            "w-full flex items-center justify-between p-3.5 rounded-xl border text-left transition-all",
                                            isSelected
                                                ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-sm"
                                                : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                        )}
                                    >
                                        <div className="space-y-0.5">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-sm">{u.name}</span>
                                                {isAdmin ? (
                                                    <Badge variant="default" className="text-[10px] uppercase font-bold py-0 h-4">
                                                        Admin
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="secondary" className="text-[10px] uppercase font-bold py-0 h-4">
                                                        Cashier
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground font-mono">@{u.username}</p>
                                        </div>

                                        {isSelected && (
                                            <div className="w-2 h-2 rounded-full bg-primary" />
                                        )}
                                    </button>
                                );
                            })}
                        </CardContent>
                    </Card>

                    {/* Role Templates Card */}
                    {selectedUser && selectedUser.role !== 'ADMIN' && (
                        <Card className="rounded-2xl bg-slate-50/50 dark:bg-slate-900/50">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-bold flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-amber-500" />
                                    One-Click Role Templates
                                </CardTitle>
                                <CardDescription className="text-xs">Quickly configure standard permission sets</CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-2 gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs font-semibold justify-start h-9"
                                    disabled={saving}
                                    onClick={() => void applyPreset('CASHIER')}
                                >
                                    Cashier
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs font-semibold justify-start h-9"
                                    disabled={saving}
                                    onClick={() => void applyPreset('SENIOR_CASHIER')}
                                >
                                    Senior Cashier
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs font-semibold justify-start h-9"
                                    disabled={saving}
                                    onClick={() => void applyPreset('SUPERVISOR')}
                                >
                                    Supervisor
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs font-semibold justify-start h-9"
                                    disabled={saving}
                                    onClick={() => void applyPreset('MANAGER')}
                                >
                                    Manager
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Right Column: Permission Matrix */}
                <div className="lg:col-span-8 space-y-6">
                    {selectedUser?.role === 'ADMIN' ? (
                        <Card className="rounded-2xl p-6 text-center border-dashed">
                            <div className="flex flex-col items-center justify-center py-8 space-y-3">
                                <div className="p-3 bg-primary/10 rounded-full text-primary">
                                    <ShieldCheck className="w-8 h-8" />
                                </div>
                                <h3 className="font-bold text-lg">Full Store Administrator Access</h3>
                                <p className="text-sm text-muted-foreground max-w-md">
                                    <strong>{selectedUser.name}</strong> has full, unrestricted access to all POS, financial, stock, user, and administrative functions.
                                </p>
                            </div>
                        </Card>
                    ) : selectedUser ? (
                        <div className="space-y-6">
                            {/* Max Discount Card */}
                            <Card className="rounded-2xl">
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <CardTitle className="text-base font-bold flex items-center gap-2">
                                                <Percent className="w-4 h-4 text-emerald-600" />
                                                Maximum Discount Limit
                                            </CardTitle>
                                            <CardDescription className="text-xs">
                                                Maximum percentage discount this cashier can grant on a bill without supervisor approval.
                                            </CardDescription>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                min={0}
                                                max={100}
                                                value={selectedUser.maxDiscount ?? 0}
                                                onChange={(e) => void handleMaxDiscountChange(Number(e.target.value))}
                                                className="w-20 text-center font-bold text-base h-9"
                                            />
                                            <span className="text-sm font-semibold">%</span>
                                        </div>
                                    </div>
                                </CardHeader>
                            </Card>

                            {/* Categorized Permission Groups */}
                            {PERMISSION_GROUPS.map((group) => {
                                const Icon = group.icon;

                                return (
                                    <Card key={group.title} className="rounded-2xl">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-base font-bold flex items-center gap-2">
                                                <Icon className="w-4 h-4 text-primary" />
                                                {group.title}
                                            </CardTitle>
                                            <CardDescription className="text-xs">{group.description}</CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-3 divide-y divide-slate-100 dark:divide-slate-800">
                                            {group.permissions.map((perm) => {
                                                const isEnabled = Boolean(selectedUser[perm.key]);

                                                return (
                                                    <div
                                                        key={String(perm.key)}
                                                        className="flex items-center justify-between pt-3 first:pt-0"
                                                    >
                                                        <div className="space-y-0.5 pr-4">
                                                            <label className="text-sm font-semibold cursor-pointer" onClick={() => void togglePermission(perm.key)}>
                                                                {perm.label}
                                                            </label>
                                                            <p className="text-xs text-muted-foreground">{perm.desc}</p>
                                                        </div>
                                                        <Switch
                                                            checked={isEnabled}
                                                            onCheckedChange={() => void togglePermission(perm.key)}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
