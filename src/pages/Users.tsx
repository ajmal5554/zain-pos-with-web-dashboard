import React, { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, Key, UserCheck, UserX, Search, Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../store/authStore';

// Helper Component for Password Input
const PasswordInput = ({ label, value, onChange, disabled = false }: { label: string, value: string, onChange: (e: any) => void, disabled?: boolean }) => {
    const [show, setShow] = useState(false);
    return (
        <div className="relative">
            <Input
                label={label}
                type={show ? 'text' : 'password'}
                value={value}
                onChange={onChange}
                disabled={disabled}
            />
            <button
                type="button"
                className="absolute right-3 top-[34px] text-gray-500 hover:text-gray-700"
                onClick={() => setShow(!show)}
                tabIndex={-1}
            >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
        </div>
    );
};

export const Users: React.FC = () => {
    const currentUser = useAuthStore((state) => state.user);
    const [users, setUsers] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    // Modals
    const [showUserModal, setShowUserModal] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);

    // Form States
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        name: '',
        role: 'CASHIER'
    });

    const [passwordData, setPasswordData] = useState({
        userId: '',
        newPassword: '',
        confirmPassword: ''
    });

    useEffect(() => {
        if (currentUser?.id) {
            loadUsers();
        }
    }, [currentUser?.id]);

    const loadUsers = async () => {
        if (!currentUser?.id) return;
        try {
            const res = await window.electronAPI.users.list({ requestingUserId: currentUser?.id });
            if (res.success) {
                setUsers(res.data);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleSaveUser = async () => {
        if (!formData.username || !formData.name || (!editingUser && !formData.password)) {
            alert('Please fill all required fields');
            return;
        }

        try {
            let res;
            if (editingUser) {
                // Update (excluding password)
                res = await window.electronAPI.users.update(editingUser.id, {
                    data: {
                        name: formData.name,
                        username: formData.username,
                        role: formData.role
                    },
                    updatedBy: currentUser?.id || ''
                });
            } else {
                // Create
                res = await window.electronAPI.users.create({
                    userData: formData,
                    createdBy: currentUser?.id || ''
                });
            }

            if (res.success) {
                setShowUserModal(false);
                setEditingUser(null);
                setFormData({ username: '', password: '', name: '', role: 'CASHIER' });
                loadUsers();
            } else {
                alert('Error: ' + res.error);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleSavePassword = async () => {
        if (!passwordData.newPassword || passwordData.newPassword !== passwordData.confirmPassword) {
            alert('Passwords do not match or are empty');
            return;
        }

        try {
            const res = await window.electronAPI.users.changePassword({
                id: passwordData.userId,
                password: passwordData.newPassword,
                changedBy: currentUser?.id || ''
            });
            if (res.success) {
                setShowPasswordModal(false);
                setPasswordData({ userId: '', newPassword: '', confirmPassword: '' });
                alert('Password updated successfully');
            } else {
                alert('Error: ' + res.error);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleToggleStatus = async (user: any) => {
        if (confirm(`Are you sure you want to ${user.isActive ? 'deactivate' : 'activate'} this user?`)) {
            const res = await window.electronAPI.users.update(user.id, {
                data: { isActive: !user.isActive },
                updatedBy: currentUser?.id || ''
            });
            if (res.success) loadUsers();
        }
    };

    const openEditModal = (user: any) => {
        setEditingUser(user);
        setFormData({
            username: user.username,
            name: user.name,
            role: user.role,
            password: '' // Password not editable here
        });
        setShowUserModal(true);
    };

    const openPasswordModal = (user: any) => {
        setPasswordData({
            userId: user.id,
            newPassword: '',
            confirmPassword: ''
        });
        setShowPasswordModal(true);
    };

    const filteredUsers = users.filter(u =>
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.username.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">User Management</h1>
                <Button onClick={() => {
                    setEditingUser(null);
                    setFormData({ username: '', password: '', name: '', role: 'CASHIER' });
                    setShowUserModal(true);
                }}>
                    <Plus className="w-5 h-5" />
                    Add User
                </Button>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="relative max-w-sm">
                        <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search users..."
                            className="pl-10"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredUsers.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                    <td className="px-6 py-4 whitespace-nowrap font-medium">{user.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">{user.username}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 py-1 text-xs rounded-full ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 w-fit ${user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                            {user.isActive ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                                            {user.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                                        <button
                                            onClick={() => openPasswordModal(user)}
                                            className="p-1 hover:bg-gray-200 rounded text-gray-600"
                                            title="Change Password"
                                        >
                                            <Key className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => openEditModal(user)}
                                            className="p-1 hover:bg-blue-100 rounded text-blue-600"
                                            title="Edit User"
                                        >
                                            <Edit className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleToggleStatus(user)}
                                            className={`p-1 hover:bg-opacity-20 rounded ${user.isActive ? 'hover:bg-red-100 text-red-600' : 'hover:bg-green-100 text-green-600'}`}
                                            title={user.isActive ? "Deactivate" : "Activate"}
                                        >
                                            {user.isActive ? <Trash2 className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* User Modal */}
            <Modal
                isOpen={showUserModal}
                onClose={() => setShowUserModal(false)}
                title={editingUser ? 'Edit User' : 'Add New User'}
            >
                <div className="space-y-4">
                    <Input
                        label="Full Name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                    <Input
                        label="Username"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        disabled={!!editingUser} // Cannot change username once created
                    />
                    {!editingUser && (
                        <PasswordInput
                            label="Password"
                            value={formData.password}
                            onChange={(e: any) => setFormData({ ...formData, password: e.target.value })}
                        />
                    )}
                    <div>
                        <label className="label">Role</label>
                        <select
                            className="input w-full"
                            value={formData.role}
                            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                        >
                            <option value="CASHIER">Cashier</option>
                            <option value="ADMIN">Administrator</option>
                        </select>
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <Button variant="secondary" onClick={() => setShowUserModal(false)}>Cancel</Button>
                    <Button variant="primary" onClick={handleSaveUser}>{editingUser ? 'Update' : 'Create'}</Button>
                </div>
            </Modal>

            {/* Password Modal */}
            <Modal
                isOpen={showPasswordModal}
                onClose={() => setShowPasswordModal(false)}
                title="Change Password"
            >
                <div className="space-y-4">
                    <PasswordInput
                        label="New Password"
                        value={passwordData.newPassword}
                        onChange={(e: any) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    />
                    <PasswordInput
                        label="Confirm Password"
                        value={passwordData.confirmPassword}
                        onChange={(e: any) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    />
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <Button variant="secondary" onClick={() => setShowPasswordModal(false)}>Cancel</Button>
                    <Button variant="primary" onClick={handleSavePassword}>Update Password</Button>
                </div>
            </Modal>
        </div>
    );
};
