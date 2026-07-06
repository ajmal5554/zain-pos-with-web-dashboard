import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function ensureLocalDefaults() {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = 'zain-pos-local-dev-secret';
        console.warn('JWT_SECRET is not set. Using a local development fallback.');
    }

    const userCount = await prisma.user.count();
    if (userCount > 0) return;

    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
        data: {
            username: 'admin',
            password: passwordHash,
            name: 'Administrator',
            role: 'ADMIN',
            isActive: true,
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
            permViewInsights: true
        }
    });

    console.log('Created default dashboard login: admin / admin123');
}
