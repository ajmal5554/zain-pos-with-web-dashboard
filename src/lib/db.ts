import { useAuthStore } from '../store/authStore';

class DatabaseService {
    private getUserId() {
        const userId = useAuthStore.getState().user?.id;
        if (!userId) {
            throw new Error('Authentication required');
        }
        return userId;
    }

    private async execute(model: string, method: string, args?: any) {
        const result = await window.electronAPI.db.secureQuery({
            model,
            method,
            args,
            userId: this.getUserId()
        });

        if (!result.success) {
            throw new Error(result.error);
        }

        return result.data;
    }

    async syncNow() {
        return await window.electronAPI.db.syncNow();
    }

    users = {
        findUnique: (args: any) => this.execute('user', 'findUnique', args),
        findMany: (args?: any) => this.execute('user', 'findMany', args),
    };

    products = {
        findUnique: (args: any) => this.execute('product', 'findUnique', args),
        findFirst: (args: any) => this.execute('product', 'findFirst', args),
        findMany: (args?: any) => this.execute('product', 'findMany', args),
        create: (args: any) => this.execute('product', 'create', args),
        update: (args: any) => this.execute('product', 'update', args),
        updateMany: (args: any) => this.execute('product', 'updateMany', args),
        delete: (args: any) => this.execute('product', 'delete', args),
    };

    productVariants = {
        findUnique: (args: any) => this.execute('productVariant', 'findUnique', args),
        findFirst: (args: any) => this.execute('productVariant', 'findFirst', args),
        findMany: (args?: any) => this.execute('productVariant', 'findMany', args),
        create: (args: any) => this.execute('productVariant', 'create', args),
        update: (args: any) => this.execute('productVariant', 'update', args),
        updateMany: (args: any) => this.execute('productVariant', 'updateMany', args),
        delete: (args: any) => this.execute('productVariant', 'delete', args),
    };

    categories = {
        findUnique: (args: any) => this.execute('category', 'findUnique', args),
        findMany: (args?: any) => this.execute('category', 'findMany', args),
        create: (args: any) => this.execute('category', 'create', args),
        update: (args: any) => this.execute('category', 'update', args),
        delete: (args: any) => this.execute('category', 'delete', args),
    };

    customers = {
        findUnique: (args: any) => this.execute('customer', 'findUnique', args),
        findMany: (args?: any) => this.execute('customer', 'findMany', args),
        create: (args: any) => this.execute('customer', 'create', args),
        update: (args: any) => this.execute('customer', 'update', args),
        delete: (args: any) => this.execute('customer', 'delete', args),
    };

    sales = {
        findUnique: (args: any) => this.execute('sale', 'findUnique', args),
        findMany: (args?: any) => this.execute('sale', 'findMany', args),
        aggregate: (args: any) => this.execute('sale', 'aggregate', args),
        groupBy: (args: any) => this.execute('sale', 'groupBy', args),
        count: (args?: any) => this.execute('sale', 'count', args),
    };

    saleItems = {
        findMany: (args?: any) => this.execute('saleItem', 'findMany', args),
        aggregate: (args: any) => this.execute('saleItem', 'aggregate', args),
    };

    auditLogs = {
        create: (args: any) => this.execute('auditLog', 'create', args),
        findMany: (args?: any) => this.execute('auditLog', 'findMany', args),
    };

    inventoryMovements = {
        findMany: (args?: any) => this.execute('inventoryMovement', 'findMany', args),
        create: (args: any) => this.execute('inventoryMovement', 'create', args),
    };

    settings = {
        findUnique: (args: any) => this.execute('setting', 'findUnique', args),
        findMany: (args?: any) => this.execute('setting', 'findMany', args),
        upsert: (args: any) => this.execute('setting', 'upsert', args),
    };
}

export const db = new DatabaseService();
