const { PrismaClient } = require('./prisma/generated/client');
const path = require('path');
const fs = require('fs');

async function main() {
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
    const dbPath = path.join(appData, 'zain-pos-v3', 'pos.db');
    console.log('Production DB path:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('❌ Production database file not found!');
        return;
    }

    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: `file:${dbPath}`
            }
        }
    });

    try {
        // Find how many voided sales have isSynced: true
        const voidedSyncedCount = await prisma.sale.count({
            where: { status: 'VOIDED', isSynced: true }
        });
        console.log(`Found ${voidedSyncedCount} voided sales that are marked as synced.`);

        if (voidedSyncedCount > 0) {
            console.log('Resetting isSynced: false for all voided sales...');
            const updateResult = await prisma.sale.updateMany({
                where: { status: 'VOIDED' },
                data: { isSynced: false }
            });
            console.log(`✅ Successfully reset isSynced to false for ${updateResult.count} voided sales.`);
        } else {
            console.log('No voided sales need their sync status reset.');
        }

    } catch (e) {
        console.error('Error executing script:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
