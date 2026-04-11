const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyzeSales() {
  try {
    console.log('\n🔍 Analyzing sale discount patterns...\n');
    
    // Get a few sales with discounts
    const sales = await prisma.sale.findMany({
      where: { 
        discount: { gt: 0 },
        status: 'COMPLETED'
      },
      include: { items: true },
      take: 5,
      orderBy: { billNo: 'asc' }
    });
    
    console.log(`Found ${sales.length} sales with discounts\n`);
    
    sales.forEach(sale => {
      const itemDiscountSum = sale.items.reduce((sum, item) => sum + item.discount, 0);
      const saleDiscount = sale.discount;
      
      console.log(`Bill #${sale.billNo}:`);
      console.log(`  Sale-level discount: Rs.${saleDiscount}`);
      console.log(`  Sum of item discounts: Rs.${itemDiscountSum}`);
      console.log(`  Pattern: ${saleDiscount === itemDiscountSum ? 'Item-level' : 'Sale-level'}`);
      console.log(`  Items: ${sale.items.length}`);
      sale.items.forEach((item, i) => {
        console.log(`    Item ${i+1}: ${item.productName} - Disc: Rs.${item.discount}`);
      });
      console.log();
    });
    
    // Check total sales
    const totalSales = await prisma.sale.count({
      where: { status: 'COMPLETED' }
    });
    
    const salesWithDiscount = await prisma.sale.count({
      where: { 
        discount: { gt: 0 },
        status: 'COMPLETED'
      }
    });
    
    console.log('\n📊 Summary:');
    console.log(`  Total completed sales: ${totalSales}`);
    console.log(`  Sales with discount: ${salesWithDiscount}`);
    console.log(`  Sales without discount: ${totalSales - salesWithDiscount}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeSales();
