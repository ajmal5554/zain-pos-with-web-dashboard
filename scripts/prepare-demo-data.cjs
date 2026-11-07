const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PrismaClient } = require('../prisma/generated/client');

const prismaDir = path.resolve(__dirname, '../prisma');
const demoPath = path.join(prismaDir, 'pos-demo.db');
const demoUrl = 'file:./pos-demo.db';

function loadTypeScriptModule(sourcePath, cache = new Map()) {
    if (cache.has(sourcePath)) return cache.get(sourcePath).exports;
    const source = fs.readFileSync(sourcePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    cache.set(sourcePath, mod);
    const sourceRequire = require('node:module').createRequire(sourcePath);
    const localRequire = (name) => {
        if (name.startsWith('.')) {
            const absolute = path.resolve(path.dirname(sourcePath), name);
            const tsPath = absolute.endsWith('.ts') ? absolute : `${absolute}.ts`;
            if (fs.existsSync(tsPath)) return loadTypeScriptModule(tsPath, cache);
        }
        return sourceRequire(name);
    };
    new Function('require', 'exports', 'module', compiled)(localRequire, mod.exports, mod);
    return mod.exports;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const isoDay = (date) => date.toISOString().slice(0, 10);
const asLocalSaleDate = (day) => new Date(`${day}T12:00:00+05:30`);

async function prepare() {
    if (!fs.existsSync(demoPath)) {
        const source = new PrismaClient();
        try {
            await source.$executeRawUnsafe('VACUUM INTO ?', demoPath);
        } finally {
            await source.$disconnect();
        }
        console.log('Created isolated demo database from the current development database snapshot.');
    }

    const db = new PrismaClient({ datasources: { db: { url: demoUrl } } });
    try {
        const ready = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='DemoDataMetadata'");
        if (ready.length) {
            console.log('Demo data is already prepared. Existing records were left unchanged.');
            return;
        }

        const admins = await db.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true }, take: 1 });
        if (!admins.length) throw new Error('The database snapshot has no active owner account to attribute sample records to.');
        const user = { id: admins[0].id, role: 'ADMIN', isActive: true, permManageInventory: true, permViewCostPrice: true, permManageCashDrawer: true };

        // Keep existing real bills available in Sales History, but out of demo forecast/P&L calculations.
        await db.sale.updateMany({ where: { isHistorical: false }, data: { isHistorical: true } });

        const category = await db.category.upsert({ where: { name: 'Test Data' }, update: {}, create: { name: 'Test Data' } });
        const catalog = [
            { name: 'TEST Forecast Shirt', sku: 'TEST-FC-SHIRT-M', barcode: '998700000001', size: 'M', sellingPrice: 700, mrp: 700, costs: [320, 330, 340, 350, 360], fabric: 'Cotton', pattern: 'Checks' },
            { name: 'TEST Forecast T-Shirt', sku: 'TEST-FC-TEE-L', barcode: '998700000002', size: 'L', sellingPrice: 425, mrp: 425, costs: [190, 195, 205, 210, 220], fabric: 'Cotton Blend', pattern: 'Prints' },
            { name: 'TEST Forecast Pant', sku: 'TEST-FC-PANT-32', barcode: '998700000003', size: '32', sellingPrice: 1000, mrp: 1000, costs: [480, 490, 500, 510, 525], fabric: 'Denim', pattern: 'Plain' },
        ];
        const variants = [];
        for (const item of catalog) {
            const product = await db.product.create({ data: { name: item.name, description: 'Clearly labelled sample product for testing only.', categoryId: category.id, taxRate: 5, isActive: true } });
            const variant = await db.productVariant.create({ data: { productId: product.id, sku: item.sku, barcode: item.barcode, size: item.size, mrp: item.mrp, sellingPrice: item.sellingPrice, costPrice: item.costs[0], stock: 0, minStock: 8, isActive: true } });
            await db.$executeRawUnsafe('INSERT INTO StockVariantTracking (variantId, activatedAt) VALUES (?, ?)', variant.id, '2025-10-28T10:00:00.000Z');
            await db.$executeRawUnsafe(`INSERT INTO ProductVariantGarmentDetail (variantId,isPrepared,brand,fabric,quality,pattern,sleeve,fit,collar,pocket,styleRef,formattedDescription,metadata) VALUES (?,0,'TEST DATA',?,'Standard',?,'Full Sleeve','Regular','Regular Collar','Single Pocket',?,?,?)`, variant.id, item.fabric, item.pattern, item.sku, `${item.name} ${item.size}`, JSON.stringify({ sample: true }));
            variants.push({ ...item, id: variant.id });
        }

        const purchases = requireTsService(path.resolve(__dirname, '../electron/purchases.service.ts')).receivePurchase;
        const purchaseDates = ['2024-09-30', '2025-03-15', '2025-08-15', '2026-01-15', '2026-06-15'];
        for (let batch = 0; batch < purchaseDates.length; batch++) {
            const lines = variants.map((item) => ({
                variantId: item.id, quantity: 100, unitCost: item.costs[batch], sellingPrice: item.sellingPrice,
                mrp: item.mrp, expectedSellingPrice: item.sellingPrice, expectedMrp: item.mrp,
            }));
            await purchases(db, {
                operationId: `test-data-purchase-op-${batch + 1}`,
                supplier: 'TEST Sample Supplier', invoiceNumber: `TEST-PUR-${batch + 1}`,
                invoiceDate: purchaseDates[batch], batchName: `TEST batch ${batch + 1}`,
                discount: 0, charges: 0, paid: batch === 4 ? 0 : 25000,
                paymentMode: 'BANK', lines,
            }, user);
        }

        const existingExpenseTable = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='ShopExpense'");
        if (existingExpenseTable.length) {
            await db.$executeRawUnsafe("UPDATE ShopExpense SET status='VOIDED',updatedAt=?", new Date().toISOString());
        }
        const createExpense = requireTsService(path.resolve(__dirname, '../electron/expenses.service.ts')).createExpense;
        for (let year = 2024, month = 10; year < new Date().getFullYear() || (year === new Date().getFullYear() && month <= new Date().getMonth() + 1);) {
            const expenseDate = `${year}-${String(month).padStart(2, '0')}-01`;
            await createExpense(db, { operationId: `test-data-expense-rent-${expenseDate}`, date: expenseDate, category: 'RENT', amount: 7000, note: 'TEST DATA — sample monthly rent', paymentSource: 'BANK' }, user);
            await createExpense(db, { operationId: `test-data-expense-power-${expenseDate}`, date: expenseDate, category: 'ELECTRICITY', amount: 1800, note: 'TEST DATA — sample monthly electricity', paymentSource: 'BANK' }, user);
            month++;
            if (month > 12) { month = 1; year++; }
        }

        const syncSaleCosts = requireTsService(path.resolve(__dirname, '../electron/stock-cost.service.ts')).syncSaleCosts;
        const start = new Date('2024-10-01T00:00:00.000Z');
        const today = new Date();
        const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
        const salesDays = Math.floor((yesterday - start) / 86400000) + 1;
        const soldByVariant = new Map(variants.map((item) => [item.id, 0]));
        for (let offset = 0; offset < salesDays; offset++) {
            const day = isoDay(new Date(start.getTime() + offset * 86400000));
            const variant = variants[(offset + Math.floor(offset / 17)) % variants.length];
            const quantity = offset % 5 === 0 ? 2 : 1;
            soldByVariant.set(variant.id, soldByVariant.get(variant.id) + quantity);
            const gross = variant.sellingPrice * quantity;
            const discount = offset % 9 === 0 ? 25 : 0;
            const net = gross - discount;
            const tax = round2(net - net / 1.05);
            const cgst = round2(tax / 2);
            const saleId = `test-sale-${day}`;
            const createdAt = asLocalSaleDate(day);
            const method = offset % 4 === 0 ? 'UPI' : 'CASH';
            await db.$transaction(async (tx) => {
                const sale = await tx.sale.create({
                    data: {
                        id: saleId, billNo: `TEST-FC-${day.replaceAll('-', '')}`, userId: user.id,
                        customerName: 'TEST Sample Customer', subtotal: gross, discount, discountPercent: gross ? discount / gross * 100 : 0,
                        taxAmount: tax, cgst, sgst: round2(tax - cgst), grandTotal: net, paymentMethod: method,
                        paidAmount: net, changeAmount: 0, status: 'COMPLETED', remarks: 'TEST DATA — generated sample for forecast and profit page validation.',
                        isHistorical: false, actualSaleDate: createdAt, createdAt,
                        items: { create: [{ variantId: variant.id, productName: variant.name, variantInfo: variant.size, quantity,
                            mrp: variant.mrp, sellingPrice: variant.sellingPrice, discount, taxRate: 5, taxAmount: tax, total: net }] },
                        payments: { create: [{ paymentMode: method, amount: net }] },
                    },
                });
                await syncSaleCosts(tx, sale.id, new Map([[variant.id, quantity]]));
                await tx.productVariant.update({ where: { id: variant.id }, data: { stock: { decrement: quantity } } });
                await tx.inventoryMovement.create({ data: { variantId: variant.id, type: 'OUT', quantity: -quantity,
                    reason: 'TEST DATA — generated sample sale', reference: sale.id, createdBy: user.id, createdAt, isSynced: false } });
            });
        }

        const oversold = [...soldByVariant].find(([, sold]) => sold > 500);
        if (oversold) throw new Error('Demo sales exceeded sample purchases; no test totals should be used until this dataset is rebuilt.');
        await db.$executeRawUnsafe('CREATE TABLE DemoDataMetadata (id INTEGER PRIMARY KEY CHECK(id=1), label TEXT NOT NULL, createdAt TEXT NOT NULL, saleCount INTEGER NOT NULL, purchaseCount INTEGER NOT NULL)');
        await db.$executeRawUnsafe('INSERT INTO DemoDataMetadata VALUES (1, ?, ?, ?, ?)', 'Isolated forecast and profit test dataset', new Date().toISOString(), salesDays, purchaseDates.length);
        console.log(`Prepared demo database: ${salesDays} cost-captured sample sales, ${purchaseDates.length} purchase batches, 2 sample expenses per month and ${variants.length} test items.`);
        console.log('All pre-existing sales in this separate demo copy are preserved in Sales History but marked historical so they do not contaminate forecast or profit totals.');
        console.log('The original prisma/pos.db was not changed.');
    } finally {
        await db.$disconnect();
    }
}

function requireTsService(file) {
    const exports = loadTypeScriptModule(file);
    return exports;
}

if (require.main === module) {
    prepare().catch((error) => {
        console.error('Could not prepare the isolated demo dataset:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { prepare };
