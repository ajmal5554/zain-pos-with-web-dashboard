import React, { useEffect, useState } from 'react';
import { ShieldCheck, Search, RefreshCw, IndianRupee } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuthStore } from '../store/authStore';

interface UserPermission {
    id: string;
    name: string;
    username: string;
    role: string;
    permPrintSticker: boolean;
    permAddItem: boolean;
    permManageProducts: boolean;
    permDeleteProduct: boolean;
    permVoidSale: boolean;
    permViewReports: boolean;
    permViewSales: boolean;
    permViewGstReports: boolean;
    permEditSettings: boolean;
    permEditSales: boolean;
    permManageInventory: boolean;
    permManageUsers: boolean;
    permViewCostPrice: boolean;
    permChangePayment: boolean;
    permDeleteAudit: boolean;
    permBulkUpdate: boolean;
    permBackDateSale: boolean;
    permViewInsights: boolean;
    maxDiscount: number;
}

export const Permissions: React.FC = () => {
    const [users, setUsers] = useState<UserPermission[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [saving, setSaving] = useState<string | null>(null);
    const { user: currentUser } = useAuthStore();

    useEffect(() => {
        if (currentUser?.id) {
            loadUsers();
        }
    }, [currentUser?.id]);

    const loadUsers = async () => {
        try {
            setLoading(true);

            if (!currentUser?.id) {
                console.error('No current user ID available');
                return;
            }

            console.log('Loading users with currentUser ID:', currentUser.id);

            // Use the secure handler with current user ID for permission validation
            const res = await window.electronAPI.users.list({ requestingUserId: currentUser?.id });

            console.log('Users API response:', res);

            if (res.success) {
                setUsers(res.data);
            } else {
                console.error('Failed to load users:', res.error);
            }
        } catch (error) {
            console.error('Error loading users:', error);
        } finally {
            setLoading(false);
        }
    };

    const togglePermission = async (userId: string, field: keyof UserPermission) => {
        const user = users.find(u => u.id === userId);
        if (!user || user.role === 'ADMIN') return; // Admins have everything

        const newValue = !user[field];

        // Optimistic update
        setUsers(users.map(u => u.id === userId ? { ...u, [field]: newValue } : u));

        try {
            setSaving(userId);
            // Use the secure handler with proper parameters
            const res = await window.electronAPI.users.update(userId, {
                data: { [field]: newValue },
                updatedBy: currentUser?.id
            });
            if (!res.success) {
                setUsers(users.map(u => u.id === userId ? { ...u, [field]: !newValue } : u));
                alert('Failed to update: ' + res.error);
            }
        } catch (error) {
            console.error(error);
            setUsers(users.map(u => u.id === userId ? { ...u, [field]: !newValue } : u));
        } finally {
            setSaving(null);
        }
    };

    const updateMaxDiscount = async (userId: string, value: string) => {
        const numValue = parseFloat(value) || 0;

        // Local state update
        setUsers(users.map(u => u.id === userId ? { ...u, maxDiscount: numValue } : u));
    };

    const saveMaxDiscount = async (userId: string, value: number) => {
        try {
            setSaving(userId);
            // Use the secure handler with proper parameters
            const res = await window.electronAPI.users.update(userId, {
                data: { maxDiscount: value },
                updatedBy: currentUser?.id
            });
            if (!res.success) alert('Failed: ' + res.error);
        } catch (error) {
            console.error(error);
        } finally {
            setSaving(null);
        }
    };

    const filteredUsers = users.filter(u =>
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.username.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const checkIcon = (user: UserPermission, field: keyof UserPermission) => {
        const hasPerm = user[field];
        const isAdmin = user.role === 'ADMIN';

        if (isAdmin) return <div className="flex justify-center"><ShieldCheck className="w-5 h-5 text-blue-500" /></div>;

        return (
            <div className="flex justify-center">
                <button
                    onClick={() => togglePermission(user.id, field)}
                    disabled={saving === user.id}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${hasPerm ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${hasPerm ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold">User Permissions & Allowances</h1>
                    <p className="text-gray-500 text-sm">Fine-tune what cashiers can perform and their discount limits.</p>
                </div>
                <Button variant="secondary" onClick={loadUsers} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center">
                    <div className="relative max-w-sm w-full">
                        <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Search staff..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 h-10"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-800/50 text-[10px] uppercase font-bold text-gray-500">
                            <tr>
                                <th className="px-6 py-4 text-left min-w-[150px]">Staff Member</th>
                                <th className="px-4 py-4 text-center">POS Items</th>
                                <th className="px-4 py-4 text-center">Stickers</th>
                                <th className="px-4 py-4 text-center">Manage Products</th>
                                <th className="px-4 py-4 text-center">Delete Product</th>
                                <th className="px-4 py-4 text-center">Void Bill</th>
                                <th className="px-4 py-4 text-center">Edit Sales</th>
                                <th className="px-4 py-4 text-center">Update Pymt</th>
                                <th className="px-4 py-4 text-center">Dashbrd</th>
                                <th className="px-4 py-4 text-center">Sales Hist</th>
                                <th className="px-4 py-4 text-center">GST Report</th>
                                <th className="px-4 py-4 text-center">Inventory</th>
                                <th className="px-4 py-4 text-center">Cost Price</th>
                                <th className="px-4 py-4 text-center">Users</th>
                                <th className="px-4 py-4 text-center">Audit Log</th>
                                <th className="px-4 py-4 text-center">Bulk Update</th>
                                <th className="px-4 py-4 text-center">Back-Date</th>
                                <th className="px-4 py-4 text-center">Insights</th>
                                <th className="px-6 py-4 text-right">Discount (₹)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-dark-border">
                            {filteredUsers.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                                    <td className="px-6 py-4">
                                        <div className="font-bold">{user.name}</div>
                                        <div className="text-xs text-gray-400 uppercase">{user.role}</div>
                                    </td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permAddItem')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permPrintSticker')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permManageProducts')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permDeleteProduct')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permVoidSale')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permEditSales')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permChangePayment')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permViewReports')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permViewSales')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permViewGstReports')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permManageInventory')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permViewCostPrice')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permManageUsers')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permDeleteAudit')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permBulkUpdate')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permBackDateSale')}</td>
                                    <td className="px-4 py-4 text-center">{checkIcon(user, 'permViewInsights')}</td>
                                    <td className="px-6 py-4">
                                        {user.role === 'ADMIN' ? (
                                            <div className="text-right text-gray-400 text-xs font-bold uppercase">Unlimited</div>
                                        ) : (
                                            <div className="flex items-center justify-end gap-2">
                                                <div className="relative w-24">
                                                    <IndianRupee className="absolute left-2 top-2.5 w-3 h-3 text-gray-400" />
                                                    <input
                                                        type="number"
                                                        value={user.maxDiscount}
                                                        onChange={(e) => updateMaxDiscount(user.id, e.target.value)}
                                                        onBlur={(e) => saveMaxDiscount(user.id, parseFloat(e.target.value) || 0)}
                                                        className="w-full pl-6 pr-2 py-1.5 text-sm font-mono text-right bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 rounded-lg flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-500 mt-0.5" />
                    <div className="text-sm text-blue-800 dark:text-blue-400">
                        <p className="font-bold">Real-time Enforcement</p>
                        <p>Permission changes take effect immediately. Cashiers will be blocked from restricted actions without needing to restart the app.</p>
                    </div>
                </div>
                <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-lg flex items-start gap-3">
                    <IndianRupee className="w-5 h-5 text-amber-600 dark:text-amber-500 mt-0.5" />
                    <div className="text-sm text-amber-800 dark:text-amber-400">
                        <p className="font-bold">Discount Allowance</p>
                        <p>The "Max Discount" field limits the maximum amount a cashier can manually deduct from a customer's total bill.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
