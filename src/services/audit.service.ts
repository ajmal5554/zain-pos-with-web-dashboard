import { db } from '../lib/db';
import { useAuthStore } from '../store/authStore';
export type AuditAction =
    | 'SALE_VOID'
    | 'SALE_CREATE'
    | 'SALE_UPDATE'
    | 'PAYMENT_UPDATE'
    | 'STOCK_ADD'
    | 'STOCK_ADJUST'
    | 'PRODUCT_DELETE'
    | 'PRODUCT_UPDATE'
    | 'USER_LOGIN';

export const auditService = {
    async log(action: AuditAction, details: string, userId?: string) {
        try {
            const actorId = userId || useAuthStore.getState().user?.id;
            if (!actorId) return;

            await db.auditLogs.create({
                data: {
                    action,
                    details,
                    userId: actorId
                }
            });
        } catch (error) {
            console.error('Failed to create audit log:', error);
        }
    },

    async getLogs(limit = 50) {
        try {
            return await db.auditLogs.findMany({
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { user: true }
            });
        } catch (error) {
            console.error('Failed to fetch logs:', error);
            return [];
        }
    }
};
