import axios from 'axios';
import { PrismaClient } from '@prisma/client';

// We need a local prisma client instance here since we're in the electron process
// Using 'any' to avoid strict type checks against the generated client if paths differ
// In a real app, we'd import the generated client properly
let prisma: any;

// Initializer to inject prisma instance from main.ts
export const setPrismaInstance = (p: any) => {
    prisma = p;
};

class CloudSyncService {
    private apiUrl: string = '';
    private isSyncing: boolean = false;
    private isRealtimeSyncing: boolean = false;
    private syncSecret: string = process.env.CLOUD_SYNC_SECRET || '';
    private bulkSyncProgress: { total: number; synced: number; percentage: number } | null = null;

    setApiUrl(url: string) {
        this.apiUrl = url;
    }

    setSyncSecret(secret: string) {
        this.syncSecret = secret.trim();
    }

    setPrismaInstance(p: any) {
        setPrismaInstance(p);
    }

    private getSyncHeaders() {
        if (!this.syncSecret) {
            throw new Error('Cloud sync secret is not configured');
        }

        return {
            'Content-Type': 'application/json',
            'x-sync-secret': this.syncSecret
        };
    }

    getBulkSyncProgress() {
        return this.bulkSyncProgress;
    }

    // Queue a sale for sync (with instant real-time sync)
    async queueSale(sale: any) {
        if (!prisma) return;
        try {
            // Immediately sync in real-time (don't wait for batch)
            await this.syncSaleRealtime(sale);
        } catch (error) {
            console.error('Failed to sync sale in real-time:', error);
            // Fallback: Add to queue for retry
            try {
                await prisma.syncQueue.create({
                    data: {
                        action: 'CREATE',
                        model: 'Sale',
                        data: JSON.stringify(sale),
                        status: 'PENDING'
                    }
                });
            } catch (queueError) {
                console.error('Failed to queue sale:', queueError);
            }
        }
    }

    // Real-time sync for immediate upload (no batching)
    async syncSaleRealtime(sale: any) {
        if (!this.apiUrl || !prisma || this.isRealtimeSyncing) return;
        
        this.isRealtimeSyncing = true;
        
        try {
            console.log(`⚡ Real-time syncing sale ${sale.billNo}...`);
            
            // Send single sale to cloud
            await axios.post(`${this.apiUrl}/api/sync/sales`, { sales: [sale] }, {
                headers: this.getSyncHeaders(),
                timeout: 10000 // 10 second timeout
            });

            // Mark sale as synced in local database
            await prisma.sale.update({
                where: { id: sale.id },
                data: { 
                    isSynced: true,
                    lastSyncedAt: new Date()
                }
            });

            console.log(`✅ Real-time sync completed for ${sale.billNo}`);
        } catch (error: any) {
            console.error('Real-time sync failed:', error.message);
            throw error; // Let caller handle fallback to queue
        } finally {
            this.isRealtimeSyncing = false;
        }
    }

    // Process the Sync Queue
    async processQueue() {
        if (this.isSyncing || !this.apiUrl || !prisma) return;

        this.isSyncing = true;

        try {
            // 1. Fetch sales pending sync
            const pendingSales = await prisma.syncQueue.findMany({
                where: {
                    status: 'PENDING',
                    model: 'Sale'
                },
                take: 10
            });

            if (pendingSales.length === 0) {
                this.isSyncing = false;
                return;
            }

            console.log(`Processing ${pendingSales.length} queued sales...`);

            // 2. Prepare payload
            const sales = pendingSales.map((item: any) => JSON.parse(item.data));

            // 3. Send to Cloud
            await axios.post(`${this.apiUrl}/api/sync/sales`, { sales }, {
                headers: this.getSyncHeaders()
            });

            // 4. Mark as Synced (Delete from queue)
            const ids = pendingSales.map((p: any) => p.id);
            await prisma.syncQueue.deleteMany({
                where: { id: { in: ids } }
            });

            console.log(`✅ Successfully synced ${ids.length} sales.`);

            // 5. Check if more items exist
            const remaining = await prisma.syncQueue.count({ where: { status: 'PENDING' } });
            if (remaining > 0) {
                setTimeout(() => {
                    this.isSyncing = false;
                    this.processQueue();
                }, 1000); // Process next batch after 1s
                return;
            }

        } catch (error: any) {
            console.error('Queue sync failed:', error.message);

            // Optional: Increment retry count
            // await prisma.syncQueue.updateMany({ ... })
        } finally {
            this.isSyncing = false;
        }
    }

    // Legacy/Manual Sync methods
    async syncSales(sales: any[]) {
        if (!this.apiUrl) return;
        try {
            console.log(`Bulk syncing ${sales.length} sales...`);
            await axios.post(`${this.apiUrl}/api/sync/sales`, { sales }, {
                headers: this.getSyncHeaders()
            });
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async syncInventory(products: any[]) {
        if (!this.apiUrl) return;
        try {
            await axios.post(`${this.apiUrl}/api/sync/inventory`, { products }, {
                headers: this.getSyncHeaders()
            });
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async syncSettings(settings: any[]) {
        if (!this.apiUrl) return;
        try {
            console.log(`Syncing ${settings.length} settings to cloud...`);
            await axios.post(`${this.apiUrl}/api/sync/settings`, { settings }, {
                headers: this.getSyncHeaders()
            });
            return { success: true };
        } catch (error: any) {
            console.error('Settings sync failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    async syncUsers(users: any[]) {
        if (!this.apiUrl) return;
        try {
            console.log(`Syncing ${users.length} users to cloud...`);
            await axios.post(`${this.apiUrl}/api/sync/users`, { users }, {
                headers: this.getSyncHeaders()
            });
            return { success: true };
        } catch (error: any) {
            console.error('Users sync failed:', error.message);
            return { success: false, error: error?.response?.data?.error || error.message };
        }
    }

    async syncAuditLogs(logs: any[]) {
        if (!this.apiUrl) return;
        try {
            await axios.post(`${this.apiUrl}/api/sync/audit`, { logs }, {
                headers: this.getSyncHeaders()
            });
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    // Initial Bulk Sync - Upload all historical unsynced data
    async bulkSyncAll(onProgress?: (progress: { total: number; synced: number; percentage: number; message: string }) => void) {
        if (!this.apiUrl || !prisma) {
            throw new Error('Sync not configured');
        }

        console.log('🚀 Starting initial bulk sync...');

        try {
            // 1. Count unsynced records
            const [unsyncedSales, unsyncedProducts, unsyncedVariants, unsyncedCustomers, unsyncedInventory, unsyncedExchanges, unsyncedRefunds] = await Promise.all([
                prisma.sale.count({ where: { isSynced: false } }),
                prisma.product.count({ where: { isSynced: false } }),
                prisma.productVariant.count({ where: { isSynced: false } }),
                prisma.customer.count({ where: { isSynced: false } }),
                prisma.inventoryMovement.count({ where: { isSynced: false } }),
                prisma.exchange.count({ where: { isSynced: false } }),
                prisma.refund.count({ where: { isSynced: false } })
            ]);

            const totalRecords = unsyncedSales + unsyncedProducts + unsyncedVariants + unsyncedCustomers + unsyncedInventory + unsyncedExchanges + unsyncedRefunds;
            let syncedRecords = 0;

            console.log(`📊 Found ${totalRecords} unsynced records:`, {
                sales: unsyncedSales,
                products: unsyncedProducts,
                variants: unsyncedVariants,
                customers: unsyncedCustomers,
                inventory: unsyncedInventory,
                exchanges: unsyncedExchanges,
                refunds: unsyncedRefunds
            });

            if (totalRecords === 0) {
                return { success: true, message: 'All data already synced' };
            }

            const updateProgress = (message: string) => {
                const percentage = totalRecords > 0 ? Math.round((syncedRecords / totalRecords) * 100) : 0;
                this.bulkSyncProgress = { total: totalRecords, synced: syncedRecords, percentage };
                if (onProgress) {
                    onProgress({ ...this.bulkSyncProgress, message });
                }
            };

            // 2. Sync Products and Variants first (dependencies)
            if (unsyncedProducts > 0 || unsyncedVariants > 0) {
                updateProgress('Syncing products...');
                const products = await prisma.product.findMany({
                    where: { isSynced: false },
                    include: { variants: true, category: true }
                });

                const batchSize = 100;
                for (let i = 0; i < products.length; i += batchSize) {
                    const batch = products.slice(i, i + batchSize);
                    await this.syncInventory(batch);
                    
                    // Mark products and variants as synced
                    const productIds = batch.map((p: any) => p.id);
                    const variantIds = batch.flatMap((p: any) => p.variants.map((v: any) => v.id));
                    
                    await prisma.product.updateMany({
                        where: { id: { in: productIds } },
                        data: { isSynced: true, lastSyncedAt: new Date() }
                    });
                    
                    if (variantIds.length > 0) {
                        await prisma.productVariant.updateMany({
                            where: { id: { in: variantIds } },
                            data: { isSynced: true, lastSyncedAt: new Date() }
                        });
                    }

                    syncedRecords += productIds.length + variantIds.length;
                    updateProgress(`Syncing products... ${syncedRecords}/${totalRecords}`);
                }
            }

            // 3. Sync Customers
            if (unsyncedCustomers > 0) {
                updateProgress('Syncing customers...');
                const customers = await prisma.customer.findMany({
                    where: { isSynced: false }
                });

                // Send all customers (usually not too many)
                if (customers.length > 0) {
                    await axios.post(`${this.apiUrl}/api/sync/customers`, { customers }, {
                        headers: this.getSyncHeaders()
                    });

                    await prisma.customer.updateMany({
                        where: { id: { in: customers.map((c: any) => c.id) } },
                        data: { isSynced: true, lastSyncedAt: new Date() }
                    });

                    syncedRecords += customers.length;
                    updateProgress(`Syncing customers... ${syncedRecords}/${totalRecords}`);
                }
            }

            // 4. Sync Sales (with items)
            if (unsyncedSales > 0) {
                updateProgress('Syncing sales...');
                const batchSize = 100;
                let skip = 0;

                while (skip < unsyncedSales) {
                    const sales = await prisma.sale.findMany({
                        where: { isSynced: false },
                        include: { 
                            items: true,
                            payments: true,
                            user: { select: { username: true, name: true } }
                        },
                        take: batchSize,
                        skip
                    });

                    if (sales.length === 0) break;

                    await axios.post(`${this.apiUrl}/api/sync/sales`, { sales }, {
                        headers: this.getSyncHeaders()
                    });

                    const saleIds = sales.map((s: any) => s.id);
                    await prisma.sale.updateMany({
                        where: { id: { in: saleIds } },
                        data: { isSynced: true, lastSyncedAt: new Date() }
                    });

                    syncedRecords += sales.length;
                    skip += batchSize;
                    updateProgress(`Syncing sales... ${syncedRecords}/${totalRecords}`);
                }
            }

            // 5. Sync Exchanges
            if (unsyncedExchanges > 0) {
                updateProgress('Syncing exchanges...');
                const exchanges = await prisma.exchange.findMany({
                    where: { isSynced: false },
                    include: { items: true, payments: true }
                });

                if (exchanges.length > 0) {
                    await axios.post(`${this.apiUrl}/api/sync/exchanges`, { exchanges }, {
                        headers: this.getSyncHeaders()
                    });

                    await prisma.exchange.updateMany({
                        where: { id: { in: exchanges.map((e: any) => e.id) } },
                        data: { isSynced: true, lastSyncedAt: new Date() }
                    });

                    syncedRecords += exchanges.length;
                    updateProgress(`Syncing exchanges... ${syncedRecords}/${totalRecords}`);
                }
            }

            // 6. Sync Refunds
            if (unsyncedRefunds > 0) {
                updateProgress('Syncing refunds...');
                const refunds = await prisma.refund.findMany({
                    where: { isSynced: false },
                    include: { items: true, payments: true }
                });

                if (refunds.length > 0) {
                    await axios.post(`${this.apiUrl}/api/sync/refunds`, { refunds }, {
                        headers: this.getSyncHeaders()
                    });

                    await prisma.refund.updateMany({
                        where: { id: { in: refunds.map((r: any) => r.id) } },
                        data: { isSynced: true, lastSyncedAt: new Date() }
                    });

                    syncedRecords += refunds.length;
                    updateProgress(`Syncing refunds... ${syncedRecords}/${totalRecords}`);
                }
            }

            // 7. Sync Inventory Movements
            if (unsyncedInventory > 0) {
                updateProgress('Syncing inventory movements...');
                const movements = await prisma.inventoryMovement.findMany({
                    where: { isSynced: false }
                });

                const batchSize = 100;
                for (let i = 0; i < movements.length; i += batchSize) {
                    const batch = movements.slice(i, i + batchSize);
                    
                    await axios.post(`${this.apiUrl}/api/sync/inventory-movements`, { movements: batch }, {
                        headers: this.getSyncHeaders()
                    });

                    await prisma.inventoryMovement.updateMany({
                        where: { id: { in: batch.map((m: any) => m.id) } },
                        data: { isSynced: true, lastSyncedAt: new Date() }
                    });

                    syncedRecords += batch.length;
                    updateProgress(`Syncing inventory... ${syncedRecords}/${totalRecords}`);
                }
            }

            updateProgress('Bulk sync complete!');
            this.bulkSyncProgress = null;

            console.log(`✅ Bulk sync completed! ${syncedRecords} records synced.`);
            return { success: true, message: `Successfully synced ${syncedRecords} records` };

        } catch (error: any) {
            console.error('Bulk sync failed:', error);
            this.bulkSyncProgress = null;
            return { success: false, error: error.message };
        }
    }
}

export const cloudSync = new CloudSyncService();
