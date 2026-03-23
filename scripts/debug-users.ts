import { PrismaClient } from '../prisma/generated/client/index.js';
import path from 'path';

async function main() {
    const dbPath = path.join(process.cwd(), 'prisma', 'pos.db');
    console.log("Checking DB at:", dbPath);

    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: `file:${dbPath}`
            }
        }
    });

    try {
        const userCount = await prisma.user.count();
        console.log(`User Count: ${userCount}`);

        const users = await prisma.user.findMany();
        console.log("Users:", users);

        const saleCount = await prisma.sale.count();
        console.log(`Sale Count: ${saleCount}`);

    } catch (e) {
        console.error("Error querying DB:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
