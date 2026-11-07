import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const EXPENSES_SETTING_KEY = 'STORE_EXPENSES';

async function getStoredExpenses(): Promise<any[]> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: EXPENSES_SETTING_KEY } });
        if (row?.value) {
            const parsed = JSON.parse(row.value);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch {}
    return [];
}

async function saveStoredExpenses(items: any[]): Promise<void> {
    const value = JSON.stringify(items);
    await prisma.setting.upsert({
        where: { key: EXPENSES_SETTING_KEY },
        create: { key: EXPENSES_SETTING_KEY, value },
        update: { value }
    });
}

// GET all expenses
router.get('/', async (req, res) => {
    try {
        const items = await getStoredExpenses();
        res.json({ items });
    } catch (error) {
        console.error('Failed to get expenses:', error);
        res.status(500).json({ error: 'Failed to fetch expenses' });
    }
});

// POST a new expense
router.post('/', async (req, res) => {
    try {
        const { date, category, amount, note, paymentSource } = req.body;
        const amt = parseFloat(amount);
        if (isNaN(amt) || amt <= 0) {
            return res.status(400).json({ error: 'Invalid expense amount' });
        }

        const items = await getStoredExpenses();
        const newRecord = {
            id: `exp-${Date.now()}`,
            expenseDate: date || new Date().toISOString().slice(0, 10),
            category: category || 'OTHER',
            amountPaise: Math.round(amt * 100),
            note: note || '',
            paymentSource: paymentSource || 'CASH_DRAWER',
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
        };

        items.unshift(newRecord);
        await saveStoredExpenses(items);

        res.status(201).json(newRecord);
    } catch (error) {
        console.error('Failed to save expense:', error);
        res.status(500).json({ error: 'Failed to record expense' });
    }
});

// PATCH void an expense
router.patch('/:id/void', async (req, res) => {
    try {
        const { id } = req.params;
        const items = await getStoredExpenses();
        const updated = items.map((e) => (e.id === id ? { ...e, status: 'VOIDED' } : e));
        await saveStoredExpenses(updated);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to void expense' });
    }
});

export default router;

