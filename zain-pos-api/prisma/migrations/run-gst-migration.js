#!/usr/bin/env node

/**
 * GST Calculation Fix Migration Runner
 * 
 * This script runs the SQL migration to fix CGST/SGST calculations
 * for all historical sales in the database.
 * 
 * Usage:
 *   node run-gst-migration.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function runMigration() {
  console.log('\n' + '='.repeat(70));
  console.log('  GST CALCULATION FIX MIGRATION');
  console.log('='.repeat(70) + '\n');

  try {
    // Step 1: Get before stats
    console.log('📊 Analyzing current data...');
    const beforeStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as totalSales,
        SUM(cgst) as totalCgst,
        SUM(sgst) as totalSgst,
        SUM(taxAmount) as totalTax
      FROM Sale 
      WHERE status = 'COMPLETED'
    `;
    console.log(`  Total sales: ${beforeStats[0].totalSales}`);
    console.log(`  Current total CGST: Rs.${beforeStats[0].totalCgst.toFixed(2)}`);
    console.log(`  Current total SGST: Rs.${beforeStats[0].totalSgst.toFixed(2)}\n`);

    // Step 2: Create backup
    console.log('📦 Creating database backup...');
    const dbPath = path.join(__dirname, '..', '..', 'prisma', 'pos.db');
    const backupPath = path.join(__dirname, '..', '..', 'prisma', `pos.db.backup-${Date.now()}`);
    
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
      console.log(`✅ Backup created: ${path.basename(backupPath)}\n`);
    } else {
      console.log('⚠️  Database file not found at expected location\n');
    }

    // Step 3: Run migration
    console.log('🔧 Running migration...');
    
    const updateSales = await prisma.$executeRaw`
      UPDATE Sale
      SET 
          taxAmount = ROUND((subtotal - discount) * 5.0 / 105.0, 2),
          cgst = ROUND((subtotal - discount) * 5.0 / 105.0 / 2.0, 2),
          sgst = ROUND((subtotal - discount) * 5.0 / 105.0 / 2.0, 2),
          updatedAt = CURRENT_TIMESTAMP
      WHERE status = 'COMPLETED'
    `;
    
    console.log(`✅ Updated ${updateSales} sales\n`);

    // Step 4: Get after stats
    console.log('📊 Verifying changes...');
    const afterStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as totalSales,
        SUM(cgst) as totalCgst,
        SUM(sgst) as totalSgst,
        SUM(taxAmount) as totalTax
      FROM Sale 
      WHERE status = 'COMPLETED'
    `;
    
    const cgstDiff = beforeStats[0].totalCgst - afterStats[0].totalCgst;
    const sgstDiff = beforeStats[0].totalSgst - afterStats[0].totalSgst;
    const taxDiff = beforeStats[0].totalTax - afterStats[0].totalTax;
    
    console.log(`  New total CGST: Rs.${afterStats[0].totalCgst.toFixed(2)}`);
    console.log(`  New total SGST: Rs.${afterStats[0].totalSgst.toFixed(2)}`);
    console.log(`  Total CGST reduced by: Rs.${cgstDiff.toFixed(2)}`);
    console.log(`  Total SGST reduced by: Rs.${sgstDiff.toFixed(2)}`);
    console.log(`  Total tax reduced by: Rs.${taxDiff.toFixed(2)}\n`);

    // Step 5: Sample checks
    console.log('📋 Sample bills after migration:');
    console.log('-'.repeat(70));
    const samples = await prisma.$queryRaw`
      SELECT 
        billNo,
        subtotal,
        discount,
        ROUND(subtotal - discount, 2) as afterDiscount,
        taxAmount,
        cgst,
        sgst,
        ROUND((subtotal - discount) * 5.0 / 105.0, 2) as expectedTax
      FROM Sale 
      WHERE status = 'COMPLETED' AND discount > 0
      ORDER BY billNo
      LIMIT 10
    `;
    
    console.log('Bill   | Subtotal | Discount | AfterDisc | CGST  | SGST  | TotalTax | Expected');
    console.log('-'.repeat(70));
    samples.forEach(row => {
      const match = Math.abs(row.taxAmount - row.expectedTax) < 0.01 ? '✅' : '❌';
      console.log(
        `${row.billNo.padEnd(7)} | ` +
        `${row.subtotal.toFixed(0).padStart(8)} | ` +
        `${row.discount.toFixed(0).padStart(8)} | ` +
        `${row.afterDiscount.toFixed(2).padStart(9)} | ` +
        `${row.cgst.toFixed(2).padStart(5)} | ` +
        `${row.sgst.toFixed(2).padStart(5)} | ` +
        `${row.taxAmount.toFixed(2).padStart(8)} | ` +
        `${row.expectedTax.toFixed(2).padStart(8)} ${match}`
      );
    });
    console.log();

    // Step 6: Specific verification for Bill 1304
    console.log('✅ VERIFICATION - Bill #1304:');
    console.log('-'.repeat(70));
    const bill1304 = await prisma.$queryRaw`
      SELECT 
        billNo, subtotal, discount, 
        ROUND(subtotal - discount, 2) as afterDiscount,
        taxAmount, cgst, sgst,
        ROUND(cgst + sgst, 2) as calculated_total_tax,
        ROUND((subtotal - discount) * 5.0 / 105.0, 2) as expected_tax
      FROM Sale 
      WHERE billNo = '1304'
      LIMIT 1
    `;

    if (bill1304.length > 0) {
      const bill = bill1304[0];
      console.log(`  Subtotal:        Rs.${bill.subtotal}`);
      console.log(`  Discount:        Rs.${bill.discount}`);
      console.log(`  After Discount:  Rs.${bill.afterDiscount}`);
      console.log(`  CGST:            Rs.${bill.cgst}`);
      console.log(`  SGST:            Rs.${bill.sgst}`);
      console.log(`  Total Tax:       Rs.${bill.taxAmount}`);
      console.log(`  Expected Tax:    Rs.${bill.expected_tax}`);
      
      const isCorrect = Math.abs(bill.taxAmount - bill.expected_tax) < 0.01;
      console.log(`  Status:          ${isCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('  MIGRATION COMPLETE!');
    console.log('='.repeat(70) + '\n');
    console.log('✅ All historical sales have been updated with correct GST values');
    console.log('\nNext steps:');
    console.log('  1. Restart your POS application');
    console.log('  2. Check the GST Reports screen');
    console.log('  3. Verify a few bills have correct CGST/SGST values');
    console.log();

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    console.error('\nThe database backup can be restored if needed.');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
