import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Plus, Search, Fingerprint, Lock, ShieldCheck, AlertTriangle, User } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { adminService, type AdminUser } from '@/features/admin/services/admin.service';
import { isDemoModeEnabled } from '@/lib/demo';
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
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
        <div className="flex-1 space-y-4 pt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Users</h2>
                    <p className="text-muted-foreground text-sm">
                        Manage users and system access.
                    </p>
                </div>
                {!isDemoModeEnabled() && (
                    <Button onClick={() => setFormOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add User
                    </Button>
                )}
            </div>

            <Card>
                <CardContent className="p-4">
                    <div className="relative max-w-sm flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search users..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="rounded-md border bg-card overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[30%]">Name</TableHead>
                            <TableHead>Username</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    Loading...
                                </TableCell>
                            </TableRow>
                        ) : filteredUsers.length > 0 ? (
                            filteredUsers.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell>
                                         <div className="flex items-center gap-3">
                                             <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted">
                                                 <User className="h-4 w-4" />
                                             </div>
                                             <span className="font-medium text-sm">{user.name}</span>
                                         </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="text-sm text-muted-foreground">
                                            {user.username}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="font-normal text-xs">
                                            {user.role}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={user.isActive ? "default" : "destructive"} className="font-normal text-xs">
                                            {user.isActive ? 'Active' : 'Deactivated'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button 
                                                variant="outline" 
                                                size="sm" 
                                                className="h-8"
                                                onClick={() => setPasswordOpenFor(user)}
                                            >
                                                Change Password
                                            </Button>
                                            <Button 
                                                variant={user.isActive ? "secondary" : "default"} 
                                                size="sm" 
                                                className="h-8"
                                                onClick={() => void handleToggleActive(user)}
                                            >
                                                {user.isActive ? 'Deactivate' : 'Activate'}
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    No users found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={formOpen} onOpenChange={setFormOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Add User</DialogTitle>
                        <DialogDescription>Create a new user to access the dashboard.</DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                         <div className="space-y-2">
                            <label className="text-sm font-medium">Full Name</label>
                            <input 
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                placeholder="Enter full name" 
                                value={form.name} 
                                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} 
                            />
                         </div>
                         <div className="space-y-2">
                            <label className="text-sm font-medium">Username</label>
                            <input 
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                placeholder="Enter username" 
                                value={form.username} 
                                onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))} 
                            />
                         </div>
                         <div className="space-y-2">
                            <label className="text-sm font-medium">Password</label>
                            <div className="relative">
                                <input 
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 pr-10" 
                                    type={showPassword ? 'text' : 'password'} 
                                    placeholder="••••••••" 
                                    value={form.password} 
                                    onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} 
                                />
                                <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPassword(!showPassword)}>
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                         </div>
                         <div className="space-y-2">
                            <label className="text-sm font-medium">Role</label>
                            <select 
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                value={form.role} 
                                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as any }))}
                            >
                                <option value="CASHIER">Cashier</option>
                                <option value="ADMIN">Admin</option>
                            </select>
                         </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
                        <Button onClick={() => void handleCreateUser()}>Save User</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!passwordOpenFor} onOpenChange={(open) => !open && setPasswordOpenFor(null)}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Change Password</DialogTitle>
                        <DialogDescription>Update password for {passwordOpenFor?.name}.</DialogDescription>
                    </DialogHeader>

                    <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">New Password</label>
                            <input 
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                type="password" 
                                placeholder="Enter new password" 
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)} 
                            />
                        </div>
                        <div className="p-3 rounded-md bg-amber-50 text-amber-800 flex items-start gap-2 border border-amber-200">
                             <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                             <p className="text-sm">Warning: Changing the password will log out this user.</p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPasswordOpenFor(null)}>Cancel</Button>
                        <Button onClick={() => void handlePasswordChange()}>Save Password</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
