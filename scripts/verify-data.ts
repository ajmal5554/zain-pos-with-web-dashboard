import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔍 verifying Database Integrity...');

    const products = await prisma.product.count();
    const variants = await prisma.productVariant.count();
    const sales = await prisma.sale.count();
    const saleItems = await prisma.saleItem.count();
    const customers = await prisma.customer.count();
    const auditLogs = await prisma.auditLog.count();

    console.log('\n📊 Database Stats:');
    console.log(`  • Products: ${products}`);
    console.log(`  • Variants: ${variants}`);
    console.log(`  • Sales: ${sales}`);
    console.log(`  • Sale Items: ${saleItems}`);
    console.log(`  • Customers: ${customers}`);
    console.log(`  • Audit Logs: ${auditLogs}`);

    if (sales > 0 && products > 0) {
        console.log('\n✅ Data looks good! Migration successful.');
    } else {
        console.log('\n⚠️ WARNING: Some data might be missing.');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
