import { useAuthStore } from '../store/authStore';

export const authService = {
    async login(username: string, password: string) {
        const result = await window.electronAPI.auth.login({ username, password });
        if (!result.success) {
            throw new Error(result.error || 'Login failed');
        }
        return result.data;
    },

    async createUser(data: {
        username: string;
        password: string;
        name: string;
        role: string;
    }) {
        const createdBy = useAuthStore.getState().user?.id;
        if (!createdBy) {
            throw new Error('Authentication required');
        }

        const result = await window.electronAPI.users.create({
            userData: data,
            createdBy
        });
        if (!result.success) {
            throw new Error(result.error || 'Failed to create user');
        }
        return result.data;
    },

    async changePassword(userId: string, oldPassword: string, newPassword: string) {
        const user = await window.electronAPI.auth.login({
            username: useAuthStore.getState().user?.username || '',
            password: oldPassword
        });

        if (!user.success) {
            throw new Error(user.error || 'Invalid current password');
        }

        const changedBy = useAuthStore.getState().user?.id;
        if (!changedBy) {
            throw new Error('Authentication required');
        }

        const result = await window.electronAPI.users.changePassword({
            id: userId,
            password: newPassword,
            changedBy
        });
        if (!result.success) {
            throw new Error(result.error || 'Failed to change password');
        }
        return result;
    },
};
