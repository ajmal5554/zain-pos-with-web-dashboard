const { PrismaClient } = require('./prisma/generated/client');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

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
        // 1. Load Sync Settings
        const urlSetting = await prisma.setting.findUnique({ where: { key: 'CLOUD_API_URL' } });
        const secretSetting = await prisma.setting.findUnique({ where: { key: 'CLOUD_SYNC_SECRET' } });

        const apiUrl = urlSetting?.value;
        const syncSecret = secretSetting?.value;

        if (!apiUrl || !syncSecret) {
            console.error('❌ Sync settings not configured in local database!');
            return;
        }

        console.log('API URL:', apiUrl);
        console.log('Sync Secret configured: YES');

        // 2. Query Unsynced Sales
        const unsyncedSales = await prisma.sale.findMany({
            where: { isSynced: false },
            include: {
                items: true,
                payments: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        name: true,
                        role: true,
                        isActive: true
                    }
                }
            }
        });

        console.log(`\nFound ${unsyncedSales.length} unsynced sales in SQLite.`);

        if (unsyncedSales.length === 0) {
            console.log('✅ Nothing to sync!');
            return;
        }

        // 3. Batch Sync
        const batchSize = 10;
        for (let i = 0; i < unsyncedSales.length; i += batchSize) {
            const batch = unsyncedSales.slice(i, i + batchSize);
            console.log(`Syncing batch ${i / batchSize + 1} (${batch.length} sales)...`);

            try {
                const response = await axios.post(`${apiUrl}/api/sync/sales`, { sales: batch }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-sync-secret': syncSecret
                    },
                    timeout: 60000
                });

                console.log(`  Sync response:`, response.data);

                // Update isSynced in local SQLite database
                const saleIds = batch.map(s => s.id);
                const updatedCount = await prisma.sale.updateMany({
                    where: { id: { in: saleIds } },
                    data: {
                        isSynced: true,
                        lastSyncedAt: new Date()
                    }
                });
                console.log(`  ✅ Marked ${updatedCount.count} sales as synced locally.`);

            } catch (err) {
                console.error(`  ❌ Sync failed for batch:`, err.message);
                if (err.response) {
                    console.error('  Response Data:', err.response.data);
                }
            }
        }

        console.log('\n🎉 Sync execution completed!');

    } catch (e) {
        console.error('Error executing sync script:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
