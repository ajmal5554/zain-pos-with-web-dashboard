import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const CASH_DRAWER_KEY = 'STORE_CASH_DRAWER';

interface DrawerState {
    current: {
        id: string;
        date: string;
        status: 'OPEN' | 'CLOSED';
        openingFloat: number;
        cashSalesTotal: number;
        cashOutsTotal: number;
        expectedCash: number;
        openedAt: string;
    };
    history: any[];
}

const getTodayStr = () => new Date().toISOString().slice(0, 10);

async function getDrawerState(): Promise<DrawerState> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: CASH_DRAWER_KEY } });
        if (row?.value) {
            const parsed = JSON.parse(row.value);
            if (parsed.current) return parsed;
        }
    } catch {}

    return {
        current: {
            id: `reg-${getTodayStr()}`,
            date: getTodayStr(),
            status: 'OPEN',
            openingFloat: 5000,
            cashSalesTotal: 0,
            cashOutsTotal: 0,
            expectedCash: 5000,
            openedAt: new Date().toISOString()
        },
        history: []
    };
}

async function saveDrawerState(state: DrawerState): Promise<void> {
    const value = JSON.stringify(state);
    await prisma.setting.upsert({
        where: { key: CASH_DRAWER_KEY },
        create: { key: CASH_DRAWER_KEY, value },
        update: { value }
    });
}

// GET current register
router.get('/current', async (req, res) => {
    try {
        const state = await getDrawerState();
        res.json(state.current);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch register' });
    }
});

// GET shift history
router.get('/history', async (req, res) => {
    try {
        const state = await getDrawerState();
        res.json({ items: state.history });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch register history' });
    }
});

// POST cash out
router.post('/cash-out', async (req, res) => {
    try {
        const { amount, category, note } = req.body;
        const amt = parseFloat(amount);
        if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

        const state = await getDrawerState();
        state.current.cashOutsTotal += amt;
        state.current.expectedCash -= amt;
        await saveDrawerState(state);

        res.json(state.current);
    } catch (error) {
        res.status(500).json({ error: 'Failed to record cash out' });
    }
});

// POST close register
router.post('/close', async (req, res) => {
    try {
        const { actualCash, notes } = req.body;
        const counted = parseFloat(actualCash);
        if (isNaN(counted)) return res.status(400).json({ error: 'Invalid counted amount' });

        const state = await getDrawerState();
        const diff = counted - state.current.expectedCash;

        const closedRecord = {
            id: state.current.id,
            date: state.current.date,
            status: 'CLOSED',
            openingFloat: state.current.openingFloat,
            expectedCash: state.current.expectedCash,
            actualCash: counted,
            difference: diff,
            closedAt: new Date().toISOString(),
            notes: notes || (diff === 0 ? 'Balanced' : `Variance ₹${diff}`)
        };

        state.history.unshift(closedRecord);
        state.current = {
            id: `reg-${getTodayStr()}`,
            date: getTodayStr(),
            status: 'CLOSED',
            openingFloat: state.current.openingFloat,
            cashSalesTotal: 0,
            cashOutsTotal: 0,
            expectedCash: 0,
            openedAt: state.current.openedAt
        };

        await saveDrawerState(state);
        res.json(closedRecord);
    } catch (error) {
        res.status(500).json({ error: 'Failed to close register' });
    }
});

export default router;

