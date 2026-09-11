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

export interface AuditLogQueryOptions {
    limit?: number;
    startDate?: Date | string;
    endDate?: Date | string;
    action?: string;
    userId?: string;
}

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

    async getLogs(options: number | AuditLogQueryOptions = 500) {
        try {
            let limit = 500;
            const where: any = {};

            if (typeof options === 'number') {
                limit = options;
            } else if (typeof options === 'object' && options !== null) {
                if (options.limit !== undefined) limit = options.limit;
                if (options.startDate || options.endDate) {
                    where.createdAt = {};
                    if (options.startDate) where.createdAt.gte = new Date(options.startDate);
                    if (options.endDate) where.createdAt.lte = new Date(options.endDate);
                }
                if (options.action && options.action !== 'ALL') {
                    where.action = options.action;
                }
                if (options.userId && options.userId !== 'ALL') {
                    where.userId = options.userId;
                }
            }

            return await db.auditLogs.findMany({
                where: Object.keys(where).length > 0 ? where : undefined,
                take: limit || undefined,
                orderBy: { createdAt: 'desc' },
                include: { user: true }
            });
        } catch (error) {
            console.error('Failed to fetch logs:', error);
            return [];
        }
    }
};
