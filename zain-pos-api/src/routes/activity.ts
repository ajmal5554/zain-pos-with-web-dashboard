import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const CATEGORY_MAP: Record<string, string[]> = {
    sales: [
        'SALE_CREATE', 'SALE_COMPLETED', 'SALE_REFUND', 'REFUND', 'SALE_RETURN',
        'SALE_VOID', 'SALE_DELETE', 'SALE_UPDATE', 'DISCOUNT_APPLIED',
        'PRICE_OVERRIDE', 'EXCHANGE', 'PAYMENT_UPDATE'
    ],
    inventory: [
        'STOCK_ADD', 'STOCK_ADJUST', 'INVENTORY_ADJUSTMENT', 'PRODUCT_DELETE',
        'PRODUCT_UPDATE', 'INVENTORY_ALERT', 'LOW_STOCK'
    ],
    auth: [
        'USER_LOGIN', 'USER_LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGE',
        'PERMISSION_CHANGE', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETED'
    ],
    financial: [
        'CASH_DRAWER_OPEN', 'CASH_DRAWER_CLOSE', 'SHIFT_START', 'SHIFT_END',
        'CASH_RECONCILIATION'
    ],
    system: [
        'DATA_SYNC', 'REPORT_GENERATED', 'SETTINGS_CHANGE', 'BACKUP_CREATED',
        'BACKUP_RESTORED'
    ]
};

// Metadata for filters: distinct actions and active operators
router.get('/meta', async (_req, res) => {
    try {
        const [users, actionGroups] = await Promise.all([
            prisma.user.findMany({
                select: { id: true, name: true, role: true, username: true },
                orderBy: { name: 'asc' }
            }),
            prisma.auditLog.groupBy({
                by: ['action'],
                _count: { action: true },
                orderBy: { _count: { action: 'desc' } }
            })
        ]);

        res.json({
            users,
            actions: actionGroups.map(g => ({ action: g.action, count: g._count.action })),
            categories: Object.keys(CATEGORY_MAP)
        });
    } catch (error) {
        console.error('Failed to fetch activity meta:', error);
        res.status(500).json({ error: 'Failed to fetch activity metadata' });
    }
});

// Get activity logs with rich filtering & pagination
router.get('/', async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            action,
            category,
            userId,
            search,
            severity
        } = req.query;

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = req.query.limit === 'all' || req.query.limit === '0' 
            ? undefined 
            : Math.min(2000, Math.max(1, parseInt(req.query.limit as string) || 200));
        
        const includeSystem = req.query.includeSystem !== 'false';
        const isPaginated = req.query.paginate === 'true';

        // Build Prisma WHERE condition dynamically
        const where: any = {};

        // 1. Date range filter
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                const start = new Date(startDate as string);
                if (!isNaN(start.getTime())) {
                    where.createdAt.gte = start;
                }
            }
            if (endDate) {
                const end = new Date(endDate as string);
                if (!isNaN(end.getTime())) {
                    where.createdAt.lte = end;
                }
            }
        }

        // 2. Action filter (single or comma-separated)
        if (action && typeof action === 'string' && action !== 'ALL') {
            const actionList = action.split(',').map(a => a.trim().toUpperCase()).filter(Boolean);
            if (actionList.length === 1) {
                where.action = actionList[0];
            } else if (actionList.length > 1) {
                where.action = { in: actionList };
            }
        }

        // 3. Category filter
        if (category && typeof category === 'string' && category.toLowerCase() !== 'all') {
            const catActions = CATEGORY_MAP[category.toLowerCase()];
            if (catActions && !where.action) {
                where.action = { in: catActions };
            }
        }

        // 4. User filter
        if (userId && typeof userId === 'string' && userId !== 'ALL') {
            where.userId = userId;
        }

        // 5. System actions handling
        if (!includeSystem && !where.action) {
            where.NOT = [
                { action: { startsWith: 'SYNC_' } },
                { action: { startsWith: 'DATA_SYNC' } }
            ];
        }

        // 6. Search keyword
        if (search && typeof search === 'string' && search.trim()) {
            const term = search.trim();
            where.OR = [
                { details: { contains: term, mode: 'insensitive' } },
                { action: { contains: term, mode: 'insensitive' } },
                { user: { name: { contains: term, mode: 'insensitive' } } },
                { user: { username: { contains: term, mode: 'insensitive' } } }
            ];
        }

        // Execute count and query
        const [total, logs] = await Promise.all([
            prisma.auditLog.count({ where }),
            prisma.auditLog.findMany({
                where,
                take: limit,
                skip: limit ? (page - 1) * limit : undefined,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: { id: true, name: true, role: true, username: true }
                    }
                }
            })
        ]);

        res.set('X-Total-Count', String(total));

        if (isPaginated) {
            res.json({
                logs,
                total,
                page,
                limit: limit || total,
                totalPages: limit ? Math.ceil(total / limit) : 1
            });
        } else {
            res.json(logs);
        }
    } catch (error) {
        console.error('Activity logs error:', error);
        res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
});

export default router;
