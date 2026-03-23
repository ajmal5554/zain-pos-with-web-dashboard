const { PrismaClient } = require('./prisma/generated/client');
const XLSX = require('xlsx');
const prisma = new PrismaClient();

function excelDateToJS(serial) {
    const epoch = new Date(1899, 11, 30);
    const days = Math.floor(serial);
    const fraction = serial - days;
    const date = new Date(epoch.getTime() + days * 86400000);
    date.setTime(date.getTime() + Math.round(fraction * 86400000));
    return date;
}

async function run() {
    try {
        console.log('Step 1: Recreating Sale table with TEXT billNo...');

        // Disable foreign key checks
        await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;

        // Create new table with TEXT billNo
        await prisma.$executeRaw`
            CREATE TABLE IF NOT EXISTS "Sale_new" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "billNo" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "customerName" TEXT,
                "customerPhone" TEXT,
                "subtotal" REAL NOT NULL,
                "discount" REAL NOT NULL DEFAULT 0,
                "discountPercent" REAL NOT NULL DEFAULT 0,
                "taxAmount" REAL NOT NULL,
                "cgst" REAL NOT NULL,
                "sgst" REAL NOT NULL,
                "grandTotal" REAL NOT NULL,
                "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
                "paidAmount" REAL NOT NULL,
                "changeAmount" REAL NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'COMPLETED',
                "remarks" TEXT,
                "isHistorical" BOOLEAN NOT NULL DEFAULT false,
                "importedFrom" TEXT,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL,
                CONSTRAINT "Sale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
            )
        `;

        // Copy all data, converting integer billNo to text
        const copied = await prisma.$executeRaw`
            INSERT INTO "Sale_new" SELECT
                id, CAST(billNo AS TEXT), userId, customerName, customerPhone,
                subtotal, discount, discountPercent, taxAmount, cgst, sgst,
                grandTotal, paymentMethod, paidAmount, changeAmount, status,
                remarks, isHistorical, importedFrom, createdAt, updatedAt
            FROM "Sale"
        `;
        console.log(`  Copied ${copied} rows to new table`);

        // Swap tables
        await prisma.$executeRaw`DROP TABLE "Sale"`;
        await prisma.$executeRaw`ALTER TABLE "Sale_new" RENAME TO "Sale"`;

        // Recreate indexes
        await prisma.$executeRaw`CREATE UNIQUE INDEX "Sale_billNo_key" ON "Sale"("billNo")`;
        await prisma.$executeRaw`CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt")`;

        await prisma.$executeRaw`PRAGMA foreign_keys = ON`;

        console.log('  Table recreated with TEXT billNo');

        // Verify
        const rows = await prisma.$queryRaw`SELECT billNo, typeof(billNo) as t FROM Sale LIMIT 3`;
        console.log('  Sample billNo types:', rows);

        const count = await prisma.sale.count();
        console.log(`  Total sales in DB: ${count}`);

        // Step 2: Import missing sales from Excel
        console.log('\nStep 2: Importing missing sales from Excel...');
        const wb = XLSX.readFile('C:/Users/admin/Downloads/zain_pos_data_2026-03-08.xlsx');
        const sheet = wb.Sheets['Sales'];
        const excelRows = XLSX.utils.sheet_to_json(sheet);

        const existingSales = await prisma.sale.findMany({ select: { billNo: true } });
        const existingBillNos = new Set(existingSales.map(s => String(s.billNo)));
        const newSales = excelRows.filter(r => !existingBillNos.has(String(r['Bill No'])));
        console.log(`  Found ${newSales.length} new sales to import`);

        const users = await prisma.user.findMany();
        const userMap = {};
        users.forEach(u => {
            userMap[u.name.toLowerCase()] = u.id;
            userMap[u.username.toLowerCase()] = u.id;
        });
        const defaultUserId = users[0]?.id;

        let imported = 0, errors = 0;
        for (const row of newSales) {
            try {
                const billNo = String(row['Bill No']);
                const date = excelDateToJS(row['Date']);
                const total = parseFloat(row['Total']) || 0;
                const paymentMode = row['Payment Mode'] || 'CASH';
                const cashier = row['Cashier'] || '';
                const userId = userMap[cashier.toLowerCase()] || defaultUserId;

                await prisma.sale.create({
                    data: {
                        billNo,
                        createdAt: date,
                        customerName: row['Customer'] || 'Walk-in Customer',
                        subtotal: total,
                        discount: 0,
                        taxAmount: 0,
                        cgst: 0,
                        sgst: 0,
                        grandTotal: total,
                        paidAmount: total,
                        changeAmount: 0,
                        paymentMethod: paymentMode,
                        isHistorical: true,
                        status: row['Status'] || 'COMPLETED',
                        userId,
                        payments: { create: [{ paymentMode, amount: total }] }
                    }
                });
                imported++;
                if (imported % 20 === 0) console.log(`  Imported ${imported}/${newSales.length}...`);
            } catch (err) {
                errors++;
                console.error(`  Error on bill ${row['Bill No']}: ${err.message}`);
            }
        }

        console.log(`\nDone! Imported ${imported} new sales, ${errors} errors`);

        const finalCount = await prisma.sale.count();
        const newest = await prisma.sale.findFirst({ orderBy: { createdAt: 'desc' }, select: { billNo: true, createdAt: true } });
        console.log(`\nFinal database state:`);
        console.log(`  Total sales: ${finalCount}`);
        console.log(`  Newest: Bill #${newest?.billNo} on ${newest?.createdAt?.toDateString()}`);

    } catch (err) {
        console.error('FAILED:', err.message);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

run();
