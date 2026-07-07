const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkBill() {
  try {
    const totalCount = await prisma.sale.count();
    const voidedCount = await prisma.sale.count({ where: { status: 'VOIDED' } });
    
    console.log(`Total Sales in Cloud:  ${totalCount}`);
    console.log(`Voided Sales in Cloud: ${voidedCount}`);
    
    const billsToCheck = ['1172', '1173', '1174', '1175'];
    console.log('\nChecking status of bills in cloud:', billsToCheck);
    
    const sales = await prisma.sale.findMany({
      where: { billNo: { in: billsToCheck } }
    });
    
    for (const s of sales) {
      console.log(`Bill #${s.billNo}: id=${s.id}, status=${s.status}, updatedAt=${s.updatedAt.toISOString()}, createdAt=${s.createdAt.toISOString()}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkBill();
