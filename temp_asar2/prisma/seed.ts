import { PrismaClient } from './generated/client/index.js';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting database seed...');

    // Create admin user
    const hashedPassword = await bcrypt.hash('admin123', 10);

    const admin = await prisma.user.upsert({
        where: { username: 'admin' },
        update: {},
        create: {
            username: 'admin',
            password: hashedPassword,
            name: 'Administrator',
            role: 'ADMIN',
            isActive: true,
        },
    });

    console.log('Created admin user:', admin.username);

    // Create cashier user
    const cashierPassword = await bcrypt.hash('cashier123', 10);

    const cashier = await prisma.user.upsert({
        where: { username: 'cashier' },
        update: {},
        create: {
            username: 'cashier',
            password: cashierPassword,
            name: 'Cashier',
            role: 'CASHIER',
            isActive: true,
        },
    });

    console.log('Created cashier user:', cashier.username);

    // Create categories
    const categories = await Promise.all([
        prisma.category.upsert({
            where: { name: 'Shirts' },
            update: {},
            create: { name: 'Shirts' },
        }),
        prisma.category.upsert({
            where: { name: 'Pants' },
            update: {},
            create: { name: 'Pants' },
        }),
        prisma.category.upsert({
            where: { name: 'T-Shirts' },
            update: {},
            create: { name: 'T-Shirts' },
        }),
        prisma.category.upsert({
            where: { name: 'Jeans' },
            update: {},
            create: { name: 'Jeans' },
        }),
    ]);

    console.log('Created categories:', categories.length);

    // Create sample products
    const shirtsCategory = categories[0];

    const product1 = await prisma.product.create({
        data: {
            name: 'Formal Shirt',
            description: 'Premium cotton formal shirt',
            categoryId: shirtsCategory.id,
            hsn: '6205',
            taxRate: 5.0,
            variants: {
                create: [
                    {
                        sku: 'SHIRT-001-M-WHITE',
                        barcode: '4649350000001',
                        size: 'M',
                        color: 'White',
                        mrp: 1200,
                        sellingPrice: 999,
                        costPrice: 600,
                        stock: 20,
                        minStock: 5,
                    },
                    {
                        sku: 'SHIRT-001-L-WHITE',
                        barcode: '4649350000002',
                        size: 'L',
                        color: 'White',
                        mrp: 1200,
                        sellingPrice: 999,
                        costPrice: 600,
                        stock: 15,
                        minStock: 5,
                    },
                    {
                        sku: 'SHIRT-001-M-BLUE',
                        barcode: '4649350000003',
                        size: 'M',
                        color: 'Blue',
                        mrp: 1200,
                        sellingPrice: 999,
                        costPrice: 600,
                        stock: 18,
                        minStock: 5,
                    },
                ],
            },
        },
    });

    console.log('Created sample product:', product1.name);

    // Create shop settings
    await prisma.setting.upsert({
        where: { key: 'shop_name' },
        update: {},
        create: {
            key: 'shop_name',
            value: 'ZAIN GENTS PALACE',
        },
    });

    await prisma.setting.upsert({
        where: { key: 'shop_address' },
        update: {},
        create: {
            key: 'shop_address',
            value: 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR',
        },
    });

    await prisma.setting.upsert({
        where: { key: 'shop_phone' },
        update: {},
        create: {
            key: 'shop_phone',
            value: '9037106449, 7907026827',
        },
    });

    await prisma.setting.upsert({
        where: { key: 'shop_gstin' },
        update: {},
        create: {
            key: 'shop_gstin',
            value: '32PVGPS0686J1ZV',
        },
    });

    console.log('Created shop settings');

    console.log('Database seed completed successfully!');
}

main()
    .catch((e) => {
        console.error('Error seeding database:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
