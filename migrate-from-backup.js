/**
 * migrate-from-backup.js
 * Reads all data from the backup SQLite file and merges missing records
 * into the current pos.db. Safe to run multiple times (idempotent).
 *
 * Usage: node migrate-from-backup.js [--dry-run]
 */

const { PrismaClient } = require('./prisma/generated/client');
const path = require('path');

const BACKUP_PATH = 'C:/Users/admin/Downloads/backup_zain_pos_2026-03-16 (migration).db';
const CURRENT_PATH = path.join(__dirname, 'prisma', 'pos.db').replace(/\\/g, '/');

const backup = new PrismaClient({
  datasources: { db: { url: `file:${BACKUP_PATH}` } },
  log: [],
});

const current = new PrismaClient({
  datasources: { db: { url: `file:${CURRENT_PATH}` } },
  log: [],
});

const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) console.log('=== DRY RUN MODE — no writes will happen ===\n');

async function main() {
  // ──────────────────────────────────────────────
  // 0. Inspect backup
  // ──────────────────────────────────────────────
  let backupCounts;
  try {
    backupCounts = {
      categories: await backup.category.count(),
      products:   await backup.product.count(),
      variants:   await backup.productVariant.count(),
      customers:  await backup.customer.count(),
      sales:      await backup.sale.count(),
      saleItems:  await backup.saleItem.count(),
      users:      await backup.user.count(),
    };
  } catch (e) {
    console.error('ERROR reading backup DB:', e.message);
    console.error('Make sure the backup file exists at:', BACKUP_PATH);
    process.exit(1);
  }

  const currentCounts = {
    categories: await current.category.count(),
    products:   await current.product.count(),
    variants:   await current.productVariant.count(),
    customers:  await current.customer.count(),
    sales:      await current.sale.count(),
    saleItems:  await current.saleItem.count(),
    users:      await current.user.count(),
  };

  console.log('=== DATABASE COMPARISON ===');
  console.log('Table               Backup   Current');
  console.log('─────────────────────────────────────');
  for (const k of Object.keys(backupCounts)) {
    const b = String(backupCounts[k]).padStart(7);
    const c = String(currentCounts[k]).padStart(7);
    console.log(`${k.padEnd(20)}${b}  ${c}`);
  }
  console.log('');

  // ──────────────────────────────────────────────
  // 1. Categories
  // ──────────────────────────────────────────────
  console.log('── Migrating Categories ──');
  const backupCats = await backup.category.findMany();
  const currentCatNames = new Set(
    (await current.category.findMany({ select: { name: true } })).map(c => c.name.trim().toLowerCase())
  );

  let catAdded = 0, catSkipped = 0;
  for (const cat of backupCats) {
    if (currentCatNames.has(cat.name.trim().toLowerCase())) {
      catSkipped++;
      continue;
    }
    if (!DRY_RUN) {
      await current.category.create({
        data: {
          id:        cat.id,
          name:      cat.name,
          createdAt: cat.createdAt,
          updatedAt: cat.updatedAt,
        },
      });
    }
    catAdded++;
    console.log(`  + Category: ${cat.name}`);
  }
  console.log(`  Categories: ${catAdded} added, ${catSkipped} skipped\n`);

  // ──────────────────────────────────────────────
  // 2. Products
  // ──────────────────────────────────────────────
  console.log('── Migrating Products ──');
  const backupProducts = await backup.product.findMany({ include: { category: true } });
  const currentProductIds = new Set(
    (await current.product.findMany({ select: { id: true } })).map(p => p.id)
  );
  // also check by name+category to avoid inserting with a duplicate ID that belongs to different data
  const currentCatMap = Object.fromEntries(
    (await current.category.findMany()).map(c => [c.name.trim().toLowerCase(), c.id])
  );

  let prodAdded = 0, prodSkipped = 0;
  for (const prod of backupProducts) {
    if (currentProductIds.has(prod.id)) {
      // Check if it actually matches (same ID = same product)
      prodSkipped++;
      continue;
    }
    // ID not in current — find correct categoryId in current DB
    const catNameKey = prod.category.name.trim().toLowerCase();
    let catId = currentCatMap[catNameKey];
    if (!catId) {
      // Category was just added in step 1 — or name mismatch
      const found = await current.category.findFirst({ where: { name: { equals: prod.category.name } } });
      catId = found?.id;
    }
    if (!catId) {
      console.log(`  SKIP Product "${prod.name}" — category "${prod.category.name}" not found`);
      continue;
    }
    if (!DRY_RUN) {
      await current.product.create({
        data: {
          id:          prod.id,
          name:        prod.name,
          description: prod.description,
          categoryId:  catId,
          hsn:         prod.hsn,
          taxRate:     prod.taxRate,
          isActive:    prod.isActive,
          createdAt:   prod.createdAt,
          updatedAt:   prod.updatedAt,
        },
      });
    }
    prodAdded++;
    console.log(`  + Product: ${prod.name}`);
  }
  console.log(`  Products: ${prodAdded} added, ${prodSkipped} skipped\n`);

  // ──────────────────────────────────────────────
  // 3. Product Variants
  // ──────────────────────────────────────────────
  console.log('── Migrating Product Variants ──');
  const backupVariants = await backup.productVariant.findMany();
  const currentVariantIds = new Set(
    (await current.productVariant.findMany({ select: { id: true } })).map(v => v.id)
  );
  const currentVariantBarcodes = new Set(
    (await current.productVariant.findMany({ select: { barcode: true } })).map(v => v.barcode)
  );
  const currentVariantSkus = new Set(
    (await current.productVariant.findMany({ select: { sku: true } })).map(v => v.sku)
  );

  let varAdded = 0, varSkipped = 0, varUpdated = 0;
  for (const v of backupVariants) {
    // Completely skip if barcode or sku already exists
    if (currentVariantBarcodes.has(v.barcode) || currentVariantSkus.has(v.sku)) {
      varSkipped++;
      continue;
    }
    // Check product exists in current
    const prodExists = await current.product.findUnique({ where: { id: v.productId } });
    if (!prodExists) {
      console.log(`  SKIP Variant ${v.sku} — product ${v.productId} not found in current DB`);
      continue;
    }
    if (!DRY_RUN) {
      await current.productVariant.create({
        data: {
          id:           v.id,
          productId:    v.productId,
          sku:          v.sku,
          barcode:      v.barcode,
          size:         v.size,
          color:        v.color,
          mrp:          v.mrp,
          sellingPrice: v.sellingPrice,
          costPrice:    v.costPrice,
          stock:        v.stock,
          minStock:     v.minStock,
          isActive:     v.isActive,
          createdAt:    v.createdAt,
          updatedAt:    v.updatedAt,
        },
      });
    }
    varAdded++;
    if (varAdded <= 10 || varAdded % 50 === 0) console.log(`  + Variant: ${v.sku} (${v.barcode})`);
  }
  console.log(`  Variants: ${varAdded} added, ${varSkipped} skipped\n`);

  // ──────────────────────────────────────────────
  // 4. Customers
  // ──────────────────────────────────────────────
  console.log('── Migrating Customers ──');
  const backupCustomers = await backup.customer.findMany();
  const currentCustomerPhones = new Set(
    (await current.customer.findMany({ select: { phone: true } })).map(c => c.phone).filter(Boolean)
  );
  const currentCustomerIds = new Set(
    (await current.customer.findMany({ select: { id: true } })).map(c => c.id)
  );

  let custAdded = 0, custSkipped = 0;
  for (const cust of backupCustomers) {
    if (currentCustomerIds.has(cust.id) || (cust.phone && currentCustomerPhones.has(cust.phone))) {
      custSkipped++;
      continue;
    }
    if (!DRY_RUN) {
      await current.customer.create({
        data: {
          id:        cust.id,
          name:      cust.name,
          phone:     cust.phone,
          email:     cust.email,
          address:   cust.address,
          gstin:     cust.gstin,
          createdAt: cust.createdAt,
          updatedAt: cust.updatedAt,
        },
      });
    }
    custAdded++;
    console.log(`  + Customer: ${cust.name} (${cust.phone || 'no phone'})`);
  }
  console.log(`  Customers: ${custAdded} added, ${custSkipped} skipped\n`);

  // ──────────────────────────────────────────────
  // 5. Sales + SaleItems
  // ──────────────────────────────────────────────
  console.log('── Migrating Sales & Items ──');
  // Get first admin user in current DB to use for restored sales
  const adminUser = await current.user.findFirst({ where: { role: 'ADMIN' } });
  if (!adminUser) { console.error('ERROR: No admin user found in current DB'); process.exit(1); }

  const currentBillNos = new Set(
    (await current.sale.findMany({ select: { billNo: true } })).map(s => String(s.billNo))
  );

  const backupSales = await backup.sale.findMany({ include: { items: true } });
  let saleAdded = 0, saleSkipped = 0, saleErrors = 0;

  for (const sale of backupSales) {
    const billNoStr = String(sale.billNo);
    if (currentBillNos.has(billNoStr)) {
      saleSkipped++;
      continue;
    }

    // Resolve variants for items
    const itemsData = [];
    let itemError = false;
    for (const item of sale.items) {
      const variantInCurrent = await current.productVariant.findUnique({ where: { id: item.variantId } });
      if (!variantInCurrent) {
        // Try to find by ID in backup then look up by barcode in current
        const backupVariant = await backup.productVariant.findUnique({ where: { id: item.variantId } });
        if (backupVariant) {
          const byBarcode = await current.productVariant.findUnique({ where: { barcode: backupVariant.barcode } });
          if (byBarcode) {
            itemsData.push({ ...item, variantId: byBarcode.id });
            continue;
          }
        }
        console.log(`  WARN Bill #${billNoStr}: variant ${item.variantId} not found — skipping item`);
        itemError = true;
        continue;
      }
      itemsData.push(item);
    }

    // Build payment data — check if backup has InvoicePayment records
    let paymentsData = [];
    try {
      const backupPayments = await backup.invoicePayment.findMany({ where: { saleId: sale.id } });
      paymentsData = backupPayments.map(p => ({ paymentMode: p.paymentMode, amount: p.amount }));
    } catch (_) {}
    if (paymentsData.length === 0) {
      paymentsData = [{ paymentMode: sale.paymentMethod || 'CASH', amount: sale.grandTotal }];
    }

    if (!DRY_RUN) {
      try {
        await current.sale.create({
          data: {
            id:             sale.id,
            billNo:         billNoStr,
            userId:         adminUser.id,
            customerName:   sale.customerName,
            customerPhone:  sale.customerPhone,
            subtotal:       sale.subtotal,
            discount:       sale.discount,
            discountPercent: sale.discountPercent,
            taxAmount:      sale.taxAmount,
            cgst:           sale.cgst,
            sgst:           sale.sgst,
            grandTotal:     sale.grandTotal,
            paymentMethod:  sale.paymentMethod || 'CASH',
            paidAmount:     sale.paidAmount,
            changeAmount:   sale.changeAmount,
            status:         sale.status,
            remarks:        sale.remarks,
            isHistorical:   true,
            importedFrom:   'DB Backup',
            createdAt:      sale.createdAt,
            updatedAt:      sale.updatedAt,
            items: {
              create: itemsData.map(item => ({
                id:          item.id,
                variantId:   item.variantId,
                productName: item.productName,
                variantInfo: item.variantInfo,
                quantity:    item.quantity,
                mrp:         item.mrp,
                sellingPrice: item.sellingPrice,
                discount:    item.discount,
                taxRate:     item.taxRate,
                taxAmount:   item.taxAmount,
                total:       item.total,
                createdAt:   item.createdAt,
              })),
            },
            payments: {
              create: paymentsData,
            },
          },
        });
        saleAdded++;
        if (saleAdded <= 5 || saleAdded % 100 === 0)
          console.log(`  + Bill #${billNoStr} (${itemsData.length} items)`);
      } catch (e) {
        saleErrors++;
        console.log(`  ERROR Bill #${billNoStr}: ${e.message}`);
      }
    } else {
      saleAdded++;
    }
  }
  console.log(`  Sales: ${saleAdded} added, ${saleSkipped} skipped, ${saleErrors} errors\n`);

  // ──────────────────────────────────────────────
  // Final counts
  // ──────────────────────────────────────────────
  if (!DRY_RUN) {
    const finalCounts = {
      categories: await current.category.count(),
      products:   await current.product.count(),
      variants:   await current.productVariant.count(),
      customers:  await current.customer.count(),
      sales:      await current.sale.count(),
      saleItems:  await current.saleItem.count(),
    };
    console.log('=== FINAL CURRENT DB STATE ===');
    for (const [k, v] of Object.entries(finalCounts)) {
      console.log(`  ${k.padEnd(15)}: ${v}`);
    }
  }

  await backup.$disconnect();
  await current.$disconnect();
  console.log('\nDone.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
