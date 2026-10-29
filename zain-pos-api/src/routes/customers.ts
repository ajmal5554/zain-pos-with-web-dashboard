import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();
router.use(authMiddleware);

// Get customer analytics stats
router.get('/stats', async (req, res) => {
    try {
        const [total, gstinCount, sales] = await Promise.all([
            prisma.customer.count(),
            prisma.customer.count({
                where: {
                    gstin: { not: null }
                }
            }),
            prisma.sale.findMany({
                where: { status: 'COMPLETED' },
                select: {
                    customerPhone: true,
                    customerName: true,
                    grandTotal: true
                }
            })
        ]);

        // Calculate repeat buyers and customer revenue
        const customerPurchases: Record<string, { count: number; total: number }> = {};
        let totalRevenue = 0;

        sales.forEach(s => {
            const key = s.customerPhone || (s.customerName && s.customerName.toLowerCase() !== 'walk-in customer' ? s.customerName : null);
            if (key) {
                if (!customerPurchases[key]) {
                    customerPurchases[key] = { count: 0, total: 0 };
                }
                customerPurchases[key].count += 1;
                customerPurchases[key].total += Number(s.grandTotal || 0);
                totalRevenue += Number(s.grandTotal || 0);
            }
        });

        const repeatBuyers = Object.values(customerPurchases).filter(p => p.count >= 2).length;

        res.json({
            total,
            repeatBuyers,
            totalRevenue,
            gstinCount
        });
    } catch (error) {
        console.error('Fetch customer stats error:', error);
        res.status(500).json({ error: 'Failed to fetch customer stats' });
    }
});

// Get all customers
router.get('/', async (req, res) => {
    try {
        const { search, page = '1', limit = '10', sortBy = 'newest' } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const skip = (pageNum - 1) * limitNum;

        const where = search ? {
            OR: [
                { name: { contains: search as string } },
                { phone: { contains: search as string } },
                { email: { contains: search as string } },
                { gstin: { contains: search as string } }
            ]
        } : {};

        let orderBy: any = { createdAt: 'desc' };
        if (sortBy === 'name_asc') orderBy = { name: 'asc' };
        if (sortBy === 'name_desc') orderBy = { name: 'desc' };
        if (sortBy === 'oldest') orderBy = { createdAt: 'asc' };

        const [customers, total] = await Promise.all([
            prisma.customer.findMany({
                where,
                skip,
                take: limitNum,
                orderBy
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

// Get single customer by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const customer = await prisma.customer.findUnique({
            where: { id }
        });

        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        // Fetch recent sales for this customer
        const sales = await prisma.sale.findMany({
            where: {
                OR: [
                    ...(customer.phone ? [{ customerPhone: customer.phone }] : []),
                    { customerName: customer.name }
                ]
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                billNo: true,
                grandTotal: true,
                status: true,
                paymentMethod: true,
                createdAt: true
            }
        });

        res.json({ customer, sales });
    } catch (error) {
        console.error('Fetch customer details error:', error);
        res.status(500).json({ error: 'Failed to fetch customer details' });
    }
});

// Create new customer
router.post('/', async (req, res) => {
    try {
        const { name, phone, email, address, gstin } = req.body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Customer name is required' });
        }

        const trimmedPhone = phone ? String(phone).trim() : null;

        // Check if phone already exists
        if (trimmedPhone) {
            const existing = await prisma.customer.findFirst({
                where: { phone: trimmedPhone }
            });
            if (existing) {
                return res.status(400).json({ error: `Phone number already registered for ${existing.name}` });
            }
        }

        const customer = await prisma.customer.create({
            data: {
                name: name.trim(),
                phone: trimmedPhone || null,
                email: email ? String(email).trim() : null,
                address: address ? String(address).trim() : null,
                gstin: gstin ? String(gstin).trim().toUpperCase() : null
            }
        });

        res.status(201).json(customer);
    } catch (error: any) {
        console.error('Create customer error:', error);
        res.status(500).json({ error: error.message || 'Failed to create customer' });
    }
});

// Update customer
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, email, address, gstin } = req.body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Customer name is required' });
        }

        const trimmedPhone = phone ? String(phone).trim() : null;

        if (trimmedPhone) {
            const existing = await prisma.customer.findFirst({
                where: {
                    phone: trimmedPhone,
                    NOT: { id }
                }
            });
            if (existing) {
                return res.status(400).json({ error: `Phone number already registered for ${existing.name}` });
            }
        }

        const customer = await prisma.customer.update({
            where: { id },
            data: {
                name: name.trim(),
                phone: trimmedPhone || null,
                email: email ? String(email).trim() : null,
                address: address ? String(address).trim() : null,
                gstin: gstin ? String(gstin).trim().toUpperCase() : null
            }
        });

        res.json(customer);
    } catch (error: any) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: error.message || 'Failed to update customer' });
    }
});

// Delete customer
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.customer.delete({
            where: { id }
        });

        res.json({ success: true, message: 'Customer deleted successfully' });
    } catch (error: any) {
        console.error('Delete customer error:', error);
        res.status(500).json({ error: error.message || 'Failed to delete customer' });
    }
});

export default router;
