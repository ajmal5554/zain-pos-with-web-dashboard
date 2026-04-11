import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, Lock, Unlock, Settings2, Info, Percent } from 'lucide-react';
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
import { cn } from '@/lib/utils';

const permissionColumns: Array<{ key: keyof AdminUser; label: string }> = [
    { key: 'permAddItem', label: 'POS Entry' },
    { key: 'permPrintSticker', label: 'Stickers' },
    { key: 'permManageProducts', label: 'Products' },
    { key: 'permVoidSale', label: 'Void Bill' },
    { key: 'permViewReports', label: 'Stats' },
    { key: 'permViewSales', label: 'Sales' },
    { key: 'permViewGstReports', label: 'GST' },
    { key: 'permEditSettings', label: 'Config' },
    { key: 'permManageInventory', label: 'Stock' },
    { key: 'permManageUsers', label: 'Users' }
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
            toast.success(`Discount limit set to ${value}%`);
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to update max discount');
        }
    }

    return (
        <div className="flex-1 space-y-4 pt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Access & Permissions</h2>
                    <p className="text-muted-foreground text-sm">
                        Manage what users can access in the system.
                    </p>
                </div>
            </div>

            <Card className="overflow-hidden">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2 border-b bg-muted/50">
                    <div>
                        <CardTitle className="text-base font-semibold">User Permissions</CardTitle>
                        <CardDescription className="text-xs">Control operations per user.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-0 border-t-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="min-w-[180px] font-medium sticky left-0 bg-muted/50 shadow-sm z-10">User / Role</TableHead>
                                    {permissionColumns.map((col) => (
                                        <TableHead key={col.key} className="text-center font-medium min-w-[90px] text-xs px-2">
                                            {col.label}
                                        </TableHead>
                                    ))}
                                    <TableHead className="text-right font-medium min-w-[140px]">Max Discount (%)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={permissionColumns.length + 2} className="h-24 text-center text-muted-foreground">
                                            Loading users...
                                        </TableCell>
                                    </TableRow>
                                ) : sortedUsers.map((user) => (
                                    <TableRow key={user.id} className="hover:bg-muted/20 transition-colors">
                                        <TableCell className="font-medium sticky left-0 bg-background z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                            <div className="text-sm">{user.name}</div>
                                            <Badge variant={user.role === 'ADMIN' ? "default" : "secondary"} className="mt-1 font-normal text-[10px]">
                                                {user.role}
                                            </Badge>
                                        </TableCell>
                                        {permissionColumns.map((column) => (
                                            <TableCell key={column.key} className="text-center">
                                                {user.role === 'ADMIN' ? (
                                                    <div className="flex justify-center text-muted-foreground/30">
                                                        <ShieldCheck className="h-4 w-4" />
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-center">
                                                        <button
                                                            onClick={() => void togglePermission(user, column.key)}
                                                            className={cn(
                                                                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                                                                user[column.key] ? "bg-primary" : "bg-input"
                                                            )}
                                                        >
                                                            <span className={cn(
                                                                "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                                                                user[column.key] ? "translate-x-4" : "translate-x-0"
                                                            )} />
                                                        </button>
                                                    </div>
                                                )}
                                            </TableCell>
                                        ))}
                                        <TableCell className="text-right">
                                            {user.role === 'ADMIN' ? (
                                                <span className="text-xs text-muted-foreground font-medium">Unlimited</span>
                                            ) : (
                                                <div className="flex justify-end relative items-center max-w-[100px] ml-auto">
                                                    <input 
                                                        type="number"
                                                        defaultValue={user.maxDiscount}
                                                        onBlur={(e) => void saveDiscount(user, Number(e.target.value) || 0)}
                                                        className="w-full h-8 rounded-md border border-input bg-background pl-2 pr-6 text-sm tabular-nums text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    />
                                                    <div className="absolute right-2 text-muted-foreground pointer-events-none">
                                                        <Percent className="h-3 w-3" />
                                                    </div>
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <div className="rounded-md border bg-card p-4 flex items-start gap-4 text-sm text-muted-foreground">
                 <ShieldAlert className="h-5 w-5 mt-0.5 text-accent-foreground shrink-0" />
                 <div>
                     <p className="font-semibold text-foreground">Note on Permissions</p>
                     <p className="mt-1">Permissions update in real time. Users might need to refresh the page to see changes.</p>
                 </div>
            </div>
        </div>
    );
}
