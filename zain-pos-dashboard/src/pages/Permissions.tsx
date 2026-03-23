import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminService, type AdminUser } from '@/features/admin/services/admin.service';
import { isDemoModeEnabled } from '@/lib/demo';

const permissionColumns: Array<{ key: keyof AdminUser; label: string }> = [
    { key: 'permAddItem', label: 'POS Items' },
    { key: 'permPrintSticker', label: 'Stickers' },
    { key: 'permManageProducts', label: 'Products' },
    { key: 'permVoidSale', label: 'Void Bill' },
    { key: 'permViewReports', label: 'Dashboard' },
    { key: 'permViewSales', label: 'Sales' },
    { key: 'permViewGstReports', label: 'GST' },
    { key: 'permEditSettings', label: 'Settings' },
    { key: 'permManageInventory', label: 'Inventory' },
    { key: 'permManageUsers', label: 'Users' },
    { key: 'permViewInsights', label: 'Insights' }
];

export default function PermissionsPage() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void loadUsers();
    }, []);

    async function loadUsers() {
        try {
            setLoading(true);
            if (isDemoModeEnabled()) return;
            setUsers(await adminService.getUsers());
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to load permissions');
        } finally {
            setLoading(false);
        }
    }

    const sortedUsers = useMemo(() => [...users].sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)), [users]);

    async function togglePermission(user: AdminUser, key: keyof AdminUser) {
        if (user.role === 'ADMIN') return;
        const updatedValue = !Boolean(user[key]);
        const previous = users;
        setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, [key]: updatedValue } : entry));
        try {
            const updated = await adminService.updateUser(user.id, { [key]: updatedValue } as Partial<AdminUser>);
            setUsers((current) => current.map((entry) => entry.id === user.id ? updated : entry));
        } catch (error: any) {
            setUsers(previous);
            toast.error(error?.response?.data?.error || 'Failed to update permission');
        }
    }

    async function saveDiscount(user: AdminUser, value: number) {
        try {
            const updated = await adminService.updateUser(user.id, { maxDiscount: value });
            setUsers((current) => current.map((entry) => entry.id === user.id ? updated : entry));
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to update max discount');
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="dashboard-section-title">Permissions</h1>
                <p className="dashboard-section-copy">Control cashier access, GST visibility, and operational safeguards remotely.</p>
            </div>

            <Card>
                <CardHeader className="border-b border-slate-200/70 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40">
                    <CardTitle className="text-xl">Role Matrix</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50/80 text-slate-400 dark:bg-slate-900/50 dark:text-slate-500">
                                <tr>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">User</th>
                                    {permissionColumns.map((column) => (
                                        <th key={column.key} className="px-4 py-4 text-center font-semibold uppercase tracking-[0.18em]">{column.label}</th>
                                    ))}
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Max Discount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {loading ? (
                                    <tr>
                                        <td colSpan={permissionColumns.length + 2} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">Loading permissions...</td>
                                    </tr>
                                ) : sortedUsers.map((user) => (
                                    <tr key={user.id}>
                                        <td className="px-4 py-4">
                                            <div className="font-medium text-slate-950 dark:text-slate-100">{user.name}</div>
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{user.role}</div>
                                        </td>
                                        {permissionColumns.map((column) => (
                                            <td key={column.key} className="px-4 py-4 text-center">
                                                {user.role === 'ADMIN' ? (
                                                    <div className="flex justify-center">
                                                        <ShieldCheck className="h-5 w-5 text-sky-600 dark:text-sky-300" />
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => void togglePermission(user, column.key)}
                                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${user[column.key] ? 'bg-slate-950 dark:bg-sky-400' : 'bg-slate-200 dark:bg-slate-700'}`}
                                                    >
                                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${user[column.key] ? 'translate-x-6' : 'translate-x-1'}`} />
                                                    </button>
                                                )}
                                            </td>
                                        ))}
                                        <td className="px-4 py-4">
                                            {user.role === 'ADMIN' ? (
                                                <div className="text-right text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Unlimited</div>
                                            ) : (
                                                <div className="flex justify-end">
                                                    <input
                                                        type="number"
                                                        defaultValue={user.maxDiscount}
                                                        onBlur={(e) => void saveDiscount(user, Number(e.target.value) || 0)}
                                                        className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-sm dark:border-slate-700 dark:bg-slate-900"
                                                    />
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
