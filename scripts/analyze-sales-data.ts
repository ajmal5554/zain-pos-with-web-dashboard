import { PrismaClient } from '../prisma/generated/client/index.js';

const prisma = new PrismaClient();

async function main() {
    console.log('📊 Analyzing Sales Data\n');

    // Count total sales
    const totalSales = await prisma.sale.count();
    console.log(`Total Sales in DB: ${totalSales}`);

    // Count historical vs new
    const historicalSales = await prisma.sale.count({
        where: { isHistorical: true }
    });
    const newSales = totalSales - historicalSales;
    console.log(`  - Historical (MaxSell): ${historicalSales}`);
    console.log(`  - New (Zain POS): ${newSales}\n`);

    // Get invoice number range
    const minBill = await prisma.sale.findFirst({
        orderBy: { billNo: 'asc' }
    });
    const maxBill = await prisma.sale.findFirst({
        orderBy: { billNo: 'desc' }
    });
    console.log(`Invoice Number Range: ${minBill?.billNo} to ${maxBill?.billNo}\n`);

    // Calculate total revenue
    const allSales = await prisma.sale.findMany({
        select: {
            grandTotal: true,
            isHistorical: true,
            createdAt: true
        }
    });

    const totalRevenue = allSales.reduce((sum, sale) => sum + sale.grandTotal, 0);
    const historicalRevenue = allSales
        .filter(s => s.isHistorical)
        .reduce((sum, sale) => sum + sale.grandTotal, 0);
    const newRevenue = totalRevenue - historicalRevenue;

    console.log(`Total Revenue:`);
    console.log(`  - All Time: ₹${totalRevenue.toFixed(2)}`);
    console.log(`  - Historical: ₹${historicalRevenue.toFixed(2)}`);
    console.log(`  - New: ₹${newRevenue.toFixed(2)}\n`);

    // Get date range
    const oldestSale = await prisma.sale.findFirst({
        orderBy: { createdAt: 'asc' }
    });
    const newestSale = await prisma.sale.findFirst({
        orderBy: { createdAt: 'desc' }
    });

    console.log(`Date Range:`);
    console.log(`  - Oldest: ${oldestSale?.createdAt}`);
    console.log(`  - Newest: ${newestSale?.createdAt}\n`);

    // Today's sales
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySales = await prisma.sale.findMany({
        where: {
            createdAt: {
                gte: today.toISOString()
            }
        }
    });

    const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.grandTotal, 0);
    console.log(`Today's Sales:`);
    console.log(`  - Count: ${todaySales.length}`);
    console.log(`  - Revenue: ₹${todayRevenue.toFixed(2)}`);

    await prisma.$disconnect();
}

main();
