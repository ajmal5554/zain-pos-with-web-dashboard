import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { authMiddleware, type AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

async function getActor(req: AuthRequest) {
    if (!req.userId) return null;

    return prisma.user.findUnique({
        where: { id: req.userId }
    });
}

async function requireManageUsers(req: AuthRequest, res: any) {
    const actor = await getActor(req);
    if (!actor) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
    if (actor.role !== 'ADMIN' && !actor.permManageUsers) {
        res.status(403).json({ error: 'Missing permission: manage users' });
        return null;
    }
    return actor;
}

async function requireEditSettings(req: AuthRequest, res: any) {
    const actor = await getActor(req);
    if (!actor) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
    if (actor.role !== 'ADMIN' && !actor.permEditSettings) {
        res.status(403).json({ error: 'Missing permission: edit settings' });
        return null;
    }
    return actor;
}

router.get('/users', async (req: AuthRequest, res) => {
    const actor = await requireManageUsers(req, res);
    if (!actor) return;

    const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            username: true,
            name: true,
            role: true,
            isActive: true,
            permPrintSticker: true,
            permAddItem: true,
            permDeleteProduct: true,
            permVoidSale: true,
            permViewReports: true,
            permEditSettings: true,
            permManageProducts: true,
            permViewSales: true,
            permViewGstReports: true,
            permEditSales: true,
            permManageInventory: true,
            permManageUsers: true,
            permViewCostPrice: true,
            permChangePayment: true,
            permDeleteAudit: true,
            permBulkUpdate: true,
            permBackDateSale: true,
            permViewInsights: true,
            maxDiscount: true,
            createdAt: true,
            updatedAt: true
        }
    });

    res.json(users);
});

router.post('/users', async (req: AuthRequest, res) => {
    const actor = await requireManageUsers(req, res);
    if (!actor) return;

    const { username, password, name, role = 'CASHIER' } = req.body || {};
    if (!username || !password || !name) {
        return res.status(400).json({ error: 'username, password, and name are required' });
    }

    const existing = await prisma.user.findFirst({ where: { username } });
    if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
        data: {
            username,
            password: passwordHash,
            name,
            role: role === 'ADMIN' ? 'ADMIN' : 'CASHIER'
        },
        select: {
            id: true,
            username: true,
            name: true,
            role: true,
            isActive: true
        }
    });

    await prisma.auditLog.create({
        data: {
            action: 'REMOTE_USER_CREATED',
            details: `User ${user.username} created from web dashboard by ${actor.username}`,
            userId: actor.id
        }
    });

    res.status(201).json(user);
});

router.patch('/users/:id', async (req: AuthRequest, res) => {
    const actor = await requireManageUsers(req, res);
    if (!actor) return;

    const id = String(req.params.id);
    const allowedFields = [
        'name', 'role', 'isActive',
        'permPrintSticker', 'permAddItem', 'permDeleteProduct', 'permVoidSale', 'permViewReports',
        'permEditSettings', 'permManageProducts', 'permViewSales', 'permViewGstReports',
        'permEditSales', 'permManageInventory', 'permManageUsers', 'permViewCostPrice',
        'permChangePayment', 'permDeleteAudit', 'permBulkUpdate', 'permBackDateSale',
        'permViewInsights', 'maxDiscount'
    ] as const;

    const data = Object.fromEntries(
        Object.entries(req.body || {}).filter(([key]) => (allowedFields as readonly string[]).includes(key))
    );

    if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'No allowed fields provided' });
    }

    const updated = await prisma.user.update({
        where: { id },
        data,
        select: {
            id: true,
            username: true,
            name: true,
            role: true,
            isActive: true,
            permPrintSticker: true,
            permAddItem: true,
            permDeleteProduct: true,
            permVoidSale: true,
            permViewReports: true,
            permEditSettings: true,
            permManageProducts: true,
            permViewSales: true,
            permViewGstReports: true,
            permEditSales: true,
            permManageInventory: true,
            permManageUsers: true,
            permViewCostPrice: true,
            permChangePayment: true,
            permDeleteAudit: true,
            permBulkUpdate: true,
            permBackDateSale: true,
            permViewInsights: true,
            maxDiscount: true
        }
    });

    await prisma.auditLog.create({
        data: {
            action: 'REMOTE_USER_UPDATED',
            details: `User ${updated.username} updated from web dashboard by ${actor.username}`,
            userId: actor.id
        }
    });

    res.json(updated);
});

router.patch('/users/:id/password', async (req: AuthRequest, res) => {
    const actor = await requireManageUsers(req, res);
    if (!actor) return;

    const id = String(req.params.id);
    const { password } = req.body || {};
    if (!password) {
        return res.status(400).json({ error: 'password is required' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
        where: { id },
        data: { password: passwordHash }
    });

    await prisma.auditLog.create({
        data: {
            action: 'REMOTE_PASSWORD_UPDATED',
            details: `Password updated from web dashboard by ${actor.username}`,
            userId: actor.id
        }
    });

    res.json({ success: true });
});

router.get('/settings', async (req: AuthRequest, res) => {
    const actor = await requireEditSettings(req, res);
    if (!actor) return;

    const keys = typeof req.query.keys === 'string'
        ? req.query.keys.split(',').map((key) => key.trim()).filter(Boolean)
        : [];

    const settings = await prisma.setting.findMany({
        where: keys.length ? { key: { in: keys } } : undefined,
        orderBy: { key: 'asc' }
    });

    res.json(settings);
});

router.put('/settings/:key', async (req: AuthRequest, res) => {
    const actor = await requireEditSettings(req, res);
    if (!actor) return;

    const key = String(req.params.key);
    const { value } = req.body || {};
    if (typeof value !== 'string') {
        return res.status(400).json({ error: 'value must be a string' });
    }

    const setting = await prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value }
    });

    await prisma.auditLog.create({
        data: {
            action: 'REMOTE_SETTING_UPDATED',
            details: `Setting ${key} updated from web dashboard by ${actor.username}`,
            userId: actor.id
        }
    });

    res.json(setting);
});

export default router;
