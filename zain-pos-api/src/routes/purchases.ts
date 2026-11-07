import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const PURCHASES_KEY = 'STORE_PURCHASES';

async function getStoredPurchases(): Promise<any[]> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: PURCHASES_KEY } });
        if (row?.value) {
            const parsed = JSON.parse(row.value);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch {}
    return [];
}

async function saveStoredPurchases(items: any[]): Promise<void> {
    const value = JSON.stringify(items);
    await prisma.setting.upsert({
        where: { key: PURCHASES_KEY },
        create: { key: PURCHASES_KEY, value },
        update: { value }
    });
}

// GET purchases
router.get('/', async (req, res) => {
    try {
        const items = await getStoredPurchases();
        res.json({ items });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch purchases' });
    }
});

// POST new purchase delivery
router.post('/', async (req, res) => {
    try {
        const { supplier, invoiceNumber, invoiceDate, batchName, lines, paid } = req.body;
        if (!supplier || !invoiceNumber) {
            return res.status(400).json({ error: 'Missing supplier or invoice number' });
        }

        const validLines = Array.isArray(lines) ? lines : [];
        const total = validLines.reduce((sum: number, l: any) => sum + (Number(l.qty || 0) * Number(l.unitCost || 0)), 0);
        const paidAmount = Number(paid || 0);

        const newRecord = {
            id: `pur-${Date.now()}`,
            supplier,
            invoiceNumber,
            invoiceDate: invoiceDate || new Date().toISOString().slice(0, 10),
            batchName: batchName || `${supplier} · ${invoiceNumber}`,
            totalPaise: Math.round(total * 100),
            paidPaise: Math.round(paidAmount * 100),
            duePaise: Math.max(0, Math.round((total - paidAmount) * 100)),
            linesCount: validLines.length,
            createdAt: new Date().toISOString()
        };

        const items = await getStoredPurchases();
        items.unshift(newRecord);
        await saveStoredPurchases(items);

        res.status(201).json(newRecord);
    } catch (error) {
        res.status(500).json({ error: 'Failed to record purchase' });
    }
});

export default router;

