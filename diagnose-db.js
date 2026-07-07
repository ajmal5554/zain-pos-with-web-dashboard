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
        const settings = await prisma.setting.findMany();
        for (const s of settings) {
            console.log(`Setting: key=${s.key}, value=${s.value}`);
        }
    } catch (e) {
        console.error('Error querying DB:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
