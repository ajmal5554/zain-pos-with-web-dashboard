import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, Plus, Search, UserCheck, UserX } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { adminService, type AdminUser } from '@/features/admin/services/admin.service';
import { isDemoModeEnabled } from '@/lib/demo';

export default function UsersPage() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [passwordOpenFor, setPasswordOpenFor] = useState<AdminUser | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [form, setForm] = useState({ username: '', password: '', name: '', role: 'CASHIER' as 'ADMIN' | 'CASHIER' });
    const [newPassword, setNewPassword] = useState('');

    useEffect(() => {
        void loadUsers();
    }, []);

    async function loadUsers() {
        try {
            setLoading(true);
            if (isDemoModeEnabled()) return;
            setUsers(await adminService.getUsers());
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to load users');
        } finally {
            setLoading(false);
        }
    }

    const filteredUsers = useMemo(() => users.filter((user) =>
        user.name.toLowerCase().includes(search.toLowerCase()) ||
        user.username.toLowerCase().includes(search.toLowerCase())
    ), [search, users]);

    async function handleCreateUser() {
        try {
            const created = await adminService.createUser(form);
            setUsers((current) => [created as AdminUser, ...current]);
            setForm({ username: '', password: '', name: '', role: 'CASHIER' });
            setFormOpen(false);
            toast.success('User created');
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to create user');
        }
    }

    async function handleToggleActive(user: AdminUser) {
        try {
            const updated = await adminService.updateUser(user.id, { isActive: !user.isActive });
            setUsers((current) => current.map((item) => item.id === user.id ? updated : item));
            toast.success(updated.isActive ? 'User activated' : 'User deactivated');
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to update user');
        }
    }

    async function handlePasswordChange() {
        if (!passwordOpenFor || !newPassword) return;
        try {
            await adminService.updatePassword(passwordOpenFor.id, newPassword);
            setPasswordOpenFor(null);
            setNewPassword('');
            toast.success('Password updated');
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to update password');
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="dashboard-section-title">Users</h1>
                    <p className="dashboard-section-copy">Manage remote staff accounts and account status.</p>
                </div>
                {!isDemoModeEnabled() && (
                    <Button className="rounded-2xl" onClick={() => setFormOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add User
                    </Button>
                )}
            </div>

            <Card>
                <CardHeader className="border-b border-slate-200/70 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40">
                    <CardTitle className="text-xl">Staff Directory</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search users"
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
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Name</th>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Username</th>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Role</th>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Status</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {loading ? (
                                    [1, 2, 3].map((i) => (
                                        <tr key={i}>
                                            <td className="px-4 py-4"><div className="h-4 w-40 animate-pulse rounded bg-slate-100 dark:bg-slate-900" /></td>
                                            <td className="px-4 py-4"><div className="h-4 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-900" /></td>
                                            <td className="px-4 py-4"><div className="h-8 w-20 animate-pulse rounded-full bg-slate-100 dark:bg-slate-900" /></td>
                                            <td className="px-4 py-4"><div className="h-8 w-20 animate-pulse rounded-full bg-slate-100 dark:bg-slate-900" /></td>
                                            <td className="px-4 py-4"><div className="ml-auto h-8 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-900" /></td>
                                        </tr>
                                    ))
                                ) : filteredUsers.map((user) => (
                                    <tr key={user.id}>
                                        <td className="px-4 py-4 font-medium text-slate-950 dark:text-slate-100">{user.name}</td>
                                        <td className="px-4 py-4 text-slate-500 dark:text-slate-400">{user.username}</td>
                                        <td className="px-4 py-4">
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                                {user.role}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4">
                                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${user.isActive
                                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                                                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                                                }`}>
                                                {user.isActive ? <UserCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                                                {user.isActive ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setPasswordOpenFor(user)}>
                                                    <KeyRound className="mr-2 h-4 w-4" />
                                                    Password
                                                </Button>
                                                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void handleToggleActive(user)}>
                                                    {user.isActive ? 'Disable' : 'Enable'}
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {formOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-lg">
                        <CardHeader>
                            <CardTitle>Create User</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Full name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
                            <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Username" value={form.username} onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))} />
                            <div className="relative">
                                <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
                                <button className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowPassword((current) => !current)}>
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            <select className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as 'ADMIN' | 'CASHIER' }))}>
                                <option value="CASHIER">Cashier</option>
                                <option value="ADMIN">Admin</option>
                            </select>
                            <div className="flex justify-end gap-3">
                                <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
                                <Button onClick={() => void handleCreateUser()}>Create</Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {passwordOpenFor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-lg">
                        <CardHeader>
                            <CardTitle>Change Password</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-500 dark:text-slate-400">Update password for {passwordOpenFor.name}.</p>
                            <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                            <div className="flex justify-end gap-3">
                                <Button variant="outline" onClick={() => setPasswordOpenFor(null)}>Cancel</Button>
                                <Button onClick={() => void handlePasswordChange()}>Update</Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
