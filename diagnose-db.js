const { PrismaClient } = require('./prisma/generated/client');
const path = require('path');
const fs = require('fs');

async function main() {
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
    const dbPath = path.join(appData, 'zain-pos-v3', 'pos.db');
    console.log('Checking Production DB at:', dbPath);
    console.log('Exists:', fs.existsSync(dbPath));

    if (!fs.existsSync(dbPath)) return;

    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: `file:${dbPath}`
            }
        }
    });

    try {
        const latestVoided = await prisma.sale.findFirst({
            where: { status: 'VOIDED' },
            orderBy: { updatedAt: 'desc' }
        });
        if (latestVoided) {
            console.log('Most Recently Updated Voided Sale in SQLite:', {
                id: latestVoided.id,
                billNo: latestVoided.billNo,
                status: latestVoided.status,
                createdAt: latestVoided.createdAt.toISOString(),
                updatedAt: latestVoided.updatedAt.toISOString(),
                isSynced: latestVoided.isSynced
            });
        } else {
            console.log('No voided sales found in SQLite.');
        }
    } catch (e) {
        console.error('Error querying DB:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
