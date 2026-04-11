import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all customers
router.get('/', async (req, res) => {
    try {
        const { search, page = '1', limit = '10' } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const skip = (pageNum - 1) * limitNum;

        const where = search ? {
            OR: [
                { name: { contains: search as string } },
                { phone: { contains: search as string } },
                { email: { contains: search as string } }
            ]
        } : {};

        const [customers, total] = await Promise.all([
            prisma.customer.findMany({
                where,
                skip,
                take: limitNum,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.customer.count({ where })
        ]);

        res.json({
            customers,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Fetch customers error:', error);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

export default router;
