/**
 * migrate-from-v1.ts
 *
 * Safely merges 2-month production sales data from the shop PC's v1 app
 * into the current dev database on this machine.
 *
 * ─── SETUP (do this first) ───────────────────────────────────────────────────
 *
 * 1. On the SHOP PC, go to:
 *      C:\Users\<username>\AppData\Roaming\zain-pos-v3\
 *    Copy "pos.db" to a USB drive or send to yourself (WhatsApp, email, OneDrive).
 *
 * 2. On THIS (dev) PC, paste the copied file as:
 *      <project>/migration/shop-v1.db
 *
 * 3. Run:
 *      npx ts-node scripts/migrate-from-v1.ts
 *
 *    Or pass a custom path:
 *      npx ts-node scripts/migrate-from-v1.ts "D:/my-backup/pos.db"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Source (read-only): migration/shop-v1.db  (copied from shop PC)
 * Target (write):     prisma/pos.db         (this dev machine)
 *
 * Both databases use the SAME Prisma schema — no schema conversion needed.
 */

import { PrismaClient } from '../prisma/generated/client/index.js';
import * as fs from 'fs';
import * as path from 'path';

// ─── Connection setup ────────────────────────────────────────────────────────

// Accept an optional command-line path override:  npx ts-node ... "D:/pos.db"
const customPath = process.argv[2];
const DEFAULT_V1_PATH = path.join(process.cwd(), 'migration', 'shop-v1.db');
const V1_DB_PATH = (customPath ?? DEFAULT_V1_PATH).replace(/\\/g, '/');
const DEV_DB_PATH = path.join(process.cwd(), 'prisma', 'pos.db').replace(/\\/g, '/');

console.log('\n════════════════════════════════════════════════════');
console.log('  Zain POS — V1 → Dev Database Migration');
console.log('════════════════════════════════════════════════════');
console.log(`  Source (shop v1): ${V1_DB_PATH}`);
console.log(`  Target (dev):     ${DEV_DB_PATH}`);
console.log('════════════════════════════════════════════════════\n');

// Verify source file exists before proceeding
if (!fs.existsSync(V1_DB_PATH.replace(/\//g, '\\'))) {
    console.error(`❌ Shop database not found at:\n   ${V1_DB_PATH}\n`);
    console.error('   Steps to fix:');
    console.error('   1. On the SHOP PC open:  C:\\Users\\<name>\\AppData\\Roaming\\zain-pos-v3\\');
    console.error('   2. Copy "pos.db" to USB or send to yourself');
    console.error('   3. Paste it here as:  migration/shop-v1.db');
    console.error('   4. Re-run:  npx ts-node scripts/migrate-from-v1.ts\n');
    process.exit(1);
}

const v1 = new PrismaClient({
    datasources: { db: { url: `file:${V1_DB_PATH}` } },
});

const dev = new PrismaClient({
    datasources: { db: { url: `file:${DEV_DB_PATH}` } },
});

// ─── Stats tracking ──────────────────────────────────────────────────────────

interface MigrationStats {
    salesMigrated: number;
    salesSkipped: number;        // already in dev (same billNo + date)
    salesFailed: number;         // error during insert
    itemsTotal: number;
    itemsUnmatchedVariant: number;
    stockAdjustments: number;
    unmatchedVariants: Array<{ sku: string; barcode: string; productName: string }>;
    errors: string[];
}

const stats: MigrationStats = {
    salesMigrated: 0,
    salesSkipped: 0,
    salesFailed: 0,
    itemsTotal: 0,
    itemsUnmatchedVariant: 0,
    stockAdjustments: 0,
    unmatchedVariants: [],
    errors: [],
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function toDateKey(d: Date | string): string {
    return new Date(d).toISOString().split('T')[0]; // "YYYY-MM-DD"
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    // ── PHASE 1: Inspect both databases ──────────────────────────────────────
    console.log('📊 Phase 1 — Inspecting both databases...\n');

    const [
        v1Products, v1Variants, v1Sales, v1Customers,
        devProducts, devVariants, devSales, devCustomers,
    ] = await Promise.all([
        v1.product.count(),
        v1.productVariant.count(),
        v1.sale.count(),
        v1.customer.count(),
        dev.product.count(),
        dev.productVariant.count(),
        dev.sale.count(),
        dev.customer.count(),
    ]);

    console.log('┌──────────────────────┬──────────┬──────────┐');
    console.log('│ Model                │ V1 (src) │ Dev (dst)│');
    console.log('├──────────────────────┼──────────┼──────────┤');
    console.log(`│ Products             │ ${String(v1Products).padStart(8)} │ ${String(devProducts).padStart(8)} │`);
    console.log(`│ ProductVariants      │ ${String(v1Variants).padStart(8)} │ ${String(devVariants).padStart(8)} │`);
    console.log(`│ Sales                │ ${String(v1Sales).padStart(8)} │ ${String(devSales).padStart(8)} │`);
    console.log(`│ Customers            │ ${String(v1Customers).padStart(8)} │ ${String(devCustomers).padStart(8)} │`);
    console.log('└──────────────────────┴──────────┴──────────┘\n');

    if (v1Sales === 0) {
        console.log('⚠️  V1 database has no sales. Nothing to migrate. Exiting.');
        return;
    }

    // ── PHASE 2: Build variant ID remap table ─────────────────────────────────
    console.log('🗺️  Phase 2 — Building variant ID map (barcode / SKU lookup)...\n');

    const [v1AllVariants, devAllVariants] = await Promise.all([
        v1.productVariant.findMany({ select: { id: true, barcode: true, sku: true } }),
        dev.productVariant.findMany({ select: { id: true, barcode: true, sku: true } }),
    ]);

    const devByBarcode = new Map<string, string>(); // barcode → dev variantId
    const devBySku     = new Map<string, string>(); // sku     → dev variantId
    for (const v of devAllVariants) {
        if (v.barcode) devByBarcode.set(v.barcode, v.id);
        if (v.sku)     devBySku.set(v.sku, v.id);
    }

    // v1VariantId → devVariantId
    const variantIdMap = new Map<string, string>();
    for (const v of v1AllVariants) {
        const devId = devByBarcode.get(v.barcode) ?? devBySku.get(v.sku);
        if (devId) {
            variantIdMap.set(v.id, devId);
        }
        // Unmatched variants are discovered during sale item processing below
    }
    console.log(`   Mapped ${variantIdMap.size} / ${v1AllVariants.length} variants by barcode/SKU.\n`);

    // ── PHASE 3: Identify sales to migrate ───────────────────────────────────
    console.log('🔍 Phase 3 — Identifying new sales in V1...\n');

    const [v1AllSales, devAllSaleSummary] = await Promise.all([
        v1.sale.findMany({
            include: {
                items: true,
                payments: true,
            },
            orderBy: { createdAt: 'asc' },
        }),
        dev.sale.findMany({
            select: { billNo: true, createdAt: true },
        }),
    ]);

    // Build a set of "billNo::YYYY-MM-DD" keys already in dev
    const devBillDateKeys = new Set(
        devAllSaleSummary.map(s => `${s.billNo}::${toDateKey(s.createdAt)}`)
    );
    // Also track all existing dev billNos (for collision detection)
    const devBillNoSet = new Set(devAllSaleSummary.map(s => s.billNo));
    const maxDevBillNo = devAllSaleSummary.reduce((m, s) => Math.max(m, s.billNo), 0);

    const toMigrate = v1AllSales.filter(
        s => !devBillDateKeys.has(`${s.billNo}::${toDateKey(s.createdAt)}`)
    );

    console.log(`   V1 total sales:          ${v1AllSales.length}`);
    console.log(`   Already in dev (skipped): ${v1AllSales.length - toMigrate.length}`);
    console.log(`   To migrate:               ${toMigrate.length}\n`);

    stats.salesSkipped = v1AllSales.length - toMigrate.length;

    if (toMigrate.length === 0) {
        console.log('✅ All V1 sales already exist in dev. Nothing to do.\n');
        return;
    }

    // ── PHASE 4: Insert migrated sales ───────────────────────────────────────
    console.log('⬆️  Phase 4 — Migrating sales into dev database...\n');

    // Find default user to fall back on for userId
    const defaultUser = await dev.user.findFirst({ where: { role: 'ADMIN' } });
    const defaultUserId = defaultUser?.id ?? '';
    if (!defaultUserId) {
        console.warn('   ⚠️  No ADMIN user found in dev DB. userId will be empty for migrated sales.');
    }

    // Build dev userId lookup by username (best-effort remap)
    const devUsers = await dev.user.findMany({ select: { id: true, username: true, name: true } });
    const v1Users  = await v1.user.findMany({ select: { id: true, username: true, name: true } });
    const v1UserById = new Map(v1Users.map(u => [u.id, u]));
    const devUserByUsername = new Map(devUsers.map(u => [u.username, u.id]));
    const devUserByName     = new Map(devUsers.map(u => [u.name, u.id]));

    // Remap v1 userId → dev userId
    function remapUserId(v1UserId: string): string {
        const v1User = v1UserById.get(v1UserId);
        if (v1User) {
            const devId = devUserByUsername.get(v1User.username) ?? devUserByName.get(v1User.name);
            if (devId) return devId;
        }
        return defaultUserId;
    }

    let batchIndex = 0;
    for (const sale of toMigrate) {
        batchIndex++;
        process.stdout.write(`\r   Processing sale ${batchIndex}/${toMigrate.length}...`);

        try {
            // Resolve billNo (check for collision with different-date sale in dev)
            let finalBillNo = sale.billNo;
            if (devBillNoSet.has(finalBillNo)) {
                // billNo exists in dev but on a different date — offset it
                finalBillNo = maxDevBillNo + 100000 + batchIndex;
                stats.errors.push(
                    `BillNo ${sale.billNo} (${toDateKey(sale.createdAt)}) collides in dev — reassigned to ${finalBillNo}`
                );
            }

            // Remap sale items
            const remappedItems: any[] = [];
            for (const item of sale.items) {
                stats.itemsTotal++;
                const devVariantId = variantIdMap.get(item.variantId);
                if (!devVariantId) {
                    // Log for manual review
                    stats.itemsUnmatchedVariant++;
                    const v1Variant = v1AllVariants.find(v => v.id === item.variantId);
                    if (v1Variant) {
                        const alreadyLogged = stats.unmatchedVariants.some(
                            u => u.sku === v1Variant.sku
                        );
                        if (!alreadyLogged) {
                            stats.unmatchedVariants.push({
                                sku: v1Variant.sku,
                                barcode: v1Variant.barcode,
                                productName: item.productName,
                            });
                        }
                    }
                    // Still include the item but with a placeholder variantId
                    // so the sale totals remain accurate
                    remappedItems.push({
                        variantId: item.variantId,  // will be a dangling ref — acceptable for history
                        productName: item.productName,
                        variantInfo: item.variantInfo ?? '',
                        quantity: item.quantity,
                        mrp: item.mrp,
                        sellingPrice: item.sellingPrice,
                        discount: item.discount,
                        taxRate: item.taxRate,
                        taxAmount: item.taxAmount,
                        total: item.total,
                        createdAt: new Date(item.createdAt),
                    });
                } else {
                    remappedItems.push({
                        variantId: devVariantId,
                        productName: item.productName,
                        variantInfo: item.variantInfo ?? '',
                        quantity: item.quantity,
                        mrp: item.mrp,
                        sellingPrice: item.sellingPrice,
                        discount: item.discount,
                        taxRate: item.taxRate,
                        taxAmount: item.taxAmount,
                        total: item.total,
                        createdAt: new Date(item.createdAt),
                    });
                }
            }

            // Build invoice payments array
            const paymentsArr: any[] = sale.payments.map(p => ({
                paymentMode: p.paymentMode,
                amount: p.amount,
                createdAt: new Date(p.createdAt),
            }));

            // Insert sale
            await dev.sale.create({
                data: {
                    billNo: finalBillNo,
                    userId: remapUserId(sale.userId),
                    customerName: sale.customerName,
                    customerPhone: sale.customerPhone,
                    subtotal: sale.subtotal,
                    discount: sale.discount,
                    discountPercent: sale.discountPercent,
                    taxAmount: sale.taxAmount,
                    cgst: sale.cgst,
                    sgst: sale.sgst,
                    grandTotal: sale.grandTotal,
                    paymentMethod: sale.paymentMethod,
                    paidAmount: sale.paidAmount,
                    changeAmount: sale.changeAmount,
                    status: sale.status,
                    remarks: sale.remarks,
                    isHistorical: false,          // these are real sales
                    importedFrom: 'v1-migration', // audit trail
                    createdAt: new Date(sale.createdAt),
                    updatedAt: new Date(sale.updatedAt),
                    items: { create: remappedItems },
                    payments: { create: paymentsArr },
                },
            });

            stats.salesMigrated++;
        } catch (error: any) {
            stats.salesFailed++;
            stats.errors.push(
                `Sale billNo=${sale.billNo} (${toDateKey(sale.createdAt)}): ${error.message}`
            );
        }
    }

    console.log(`\n\n   ✅ Inserted ${stats.salesMigrated} sales.\n`);

    // ── PHASE 5: Adjust stock levels ─────────────────────────────────────────
    console.log('📦 Phase 5 — Adjusting stock levels for migrated sales...\n');

    // Aggregate quantity sold per dev variantId across all migrated sales
    const stockDeductions = new Map<string, number>(); // devVariantId → total qty sold

    for (const sale of toMigrate) {
        for (const item of sale.items) {
            const devVariantId = variantIdMap.get(item.variantId);
            if (!devVariantId) continue; // skip unmatched — can't adjust
            stockDeductions.set(devVariantId, (stockDeductions.get(devVariantId) ?? 0) + item.quantity);
        }
    }

    for (const [devVariantId, qty] of stockDeductions.entries()) {
        try {
            await dev.productVariant.update({
                where: { id: devVariantId },
                data: { stock: { decrement: qty } },
            });
            stats.stockAdjustments++;
        } catch (error: any) {
            stats.errors.push(`Stock adjust variantId=${devVariantId}: ${error.message}`);
        }
    }

    console.log(`   Updated stock for ${stats.stockAdjustments} variants.\n`);

    // ── PHASE 6: Print & save report ─────────────────────────────────────────
    const reportLines: string[] = [
        '',
        '════════════════════════════════════════════════════',
        '  MIGRATION REPORT — V1 → Dev',
        `  Run at: ${new Date().toLocaleString()}`,
        '════════════════════════════════════════════════════',
        '',
        '  DATABASE COUNTS BEFORE MIGRATION:',
        `    V1  Sales: ${v1AllSales.length}`,
        `    Dev Sales: ${devSales}`,
        '',
        '  RESULTS:',
        `    Sales migrated:       ${stats.salesMigrated}`,
        `    Sales skipped:        ${stats.salesSkipped}  (already in dev)`,
        `    Sales failed:         ${stats.salesFailed}`,
        `    Items total:          ${stats.itemsTotal}`,
        `    Items unmatched:      ${stats.itemsUnmatchedVariant}  (variant not found in dev)`,
        `    Stock adjustments:    ${stats.stockAdjustments}  (variants decremented)`,
        '',
    ];

    if (stats.unmatchedVariants.length > 0) {
        reportLines.push('  ⚠️  UNMATCHED VARIANTS (sale items kept with original variantId):');
        for (const v of stats.unmatchedVariants) {
            reportLines.push(`    - ${v.productName}  SKU: ${v.sku}  Barcode: ${v.barcode}`);
        }
        reportLines.push('');
    }

    if (stats.errors.length > 0) {
        reportLines.push('  ⚠️  ERRORS / NOTES:');
        for (const e of stats.errors) {
            reportLines.push(`    - ${e}`);
        }
        reportLines.push('');
    }

    reportLines.push('════════════════════════════════════════════════════');
    reportLines.push('');

    const reportText = reportLines.join('\n');
    console.log(reportText);

    // Save report to migration/
    const migrationDir = path.join(process.cwd(), 'migration');
    if (!fs.existsSync(migrationDir)) fs.mkdirSync(migrationDir, { recursive: true });
    const reportPath = path.join(migrationDir, 'v1-migration-report.txt');
    fs.writeFileSync(reportPath, reportText, 'utf8');
    console.log(`📄 Report saved to: ${reportPath}\n`);

    if (stats.salesFailed > 0 || stats.itemsUnmatchedVariant > 0) {
        console.log('⚠️  Some items need manual review. Check the report above.\n');
    } else {
        console.log('✅ Migration completed successfully with no errors.\n');
    }

    console.log('👉 Next steps:');
    console.log('   1. Run:  npm run dev');
    console.log('   2. Open Sales History → All Time → verify migrated bills');
    console.log('   3. Check product stock levels look correct');
    console.log('   4. When ready: npm run electron:build  →  install the new .exe\n');
}

main()
    .catch(err => {
        console.error('\n❌ Migration failed with unexpected error:', err);
        process.exit(1);
    })
    .finally(async () => {
        await v1.$disconnect();
        await dev.$disconnect();
    });
