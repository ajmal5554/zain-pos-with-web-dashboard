const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkBill() {
  try {
    console.log('\n🔍 Checking Bill #1304...\n');
    
    const bill = await prisma.sale.findFirst({
      where: { billNo: '1304' },
      include: { items: true }
    });
    
    if (!bill) {
      console.log('❌ Bill #1304 not found');
      return;
    }
    
    console.log('Current values in database:');
    console.log('─'.repeat(50));
    console.log(`Bill No:         ${bill.billNo}`);
    console.log(`Subtotal:        Rs.${bill.subtotal}`);
    console.log(`Discount:        Rs.${bill.discount}`);
    console.log(`After Discount:  Rs.${bill.subtotal - bill.discount}`);
    console.log(`CGST (stored):   Rs.${bill.cgst}`);
    console.log(`SGST (stored):   Rs.${bill.sgst}`);
    console.log(`Tax (stored):    Rs.${bill.taxAmount}`);
    console.log();
    
    // Calculate what it should be
    const afterDiscount = bill.subtotal - bill.discount;
    const expectedTax = (afterDiscount * 5) / 105;
    const expectedCgst = expectedTax / 2;
    
    console.log('Expected values (correct formula):');
    console.log('─'.repeat(50));
    console.log(`Expected Tax:    Rs.${expectedTax.toFixed(2)}`);
    console.log(`Expected CGST:   Rs.${expectedCgst.toFixed(2)}`);
    console.log(`Expected SGST:   Rs.${expectedCgst.toFixed(2)}`);
    console.log();
    
    // Calculate from items
    console.log('Items breakdown:');
    console.log('─'.repeat(50));
    let totalTaxFromItems = 0;
    bill.items.forEach((item, i) => {
      const itemSubtotal = item.sellingPrice * item.quantity;
      const itemAfterDiscount = itemSubtotal - item.discount;
      const itemTax = (itemAfterDiscount * item.taxRate) / (100 + item.taxRate);
      totalTaxFromItems += itemTax;
      
      console.log(`Item ${i+1}: ${item.productName}`);
      console.log(`  Qty: ${item.quantity}, MRP: Rs.${item.sellingPrice}, Discount: Rs.${item.discount}`);
      console.log(`  After discount: Rs.${itemAfterDiscount}`);
      console.log(`  Tax stored: Rs.${item.taxAmount.toFixed(2)}`);
      console.log(`  Tax should be: Rs.${itemTax.toFixed(2)}`);
      console.log();
    });
    
    console.log(`Total tax from items: Rs.${totalTaxFromItems.toFixed(2)}`);
    console.log(`Total CGST should be: Rs.${(totalTaxFromItems / 2).toFixed(2)}`);
    console.log(`Total SGST should be: Rs.${(totalTaxFromItems / 2).toFixed(2)}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkBill();
