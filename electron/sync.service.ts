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
            console.error('Failed to sync sale in real-time, queuing offline:', error);
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

    // Real-time sync for immediate upload
    async syncSaleRealtime(sale: any) {
        if (!this.apiUrl || !prisma || this.isRealtimeSyncing) return;
        this.isRealtimeSyncing = true;
        
        try {
            console.log(`⚡ Real-time syncing sale ${sale.billNo}...`);
            await axios.post(`${this.apiUrl}/api/sync/sales`, { sales: [sale] }, {
                headers: this.getSyncHeaders(),
                timeout: 10000
            });

            await prisma.sale.update({
                where: { id: sale.id },
                data: { 
                    isSynced: true,
                    lastSyncedAt: new Date()
                }
            });

            console.log(`✅ Real-time sync completed for ${sale.billNo}`);
        } catch (error: any) {
            console.error('Real-time sale sync failed:', error.message);
            throw error;
        } finally {
            this.isRealtimeSyncing = false;
        }
    }

    // Queue an exchange for sync
    async queueExchange(exchange: any) {
        if (!prisma) return;
        try {
            await this.syncExchangeRealtime(exchange);
        } catch (error) {
            console.error('Failed to sync exchange in real-time, queuing offline:', error);
            try {
                await prisma.syncQueue.create({
                    data: {
                        action: 'CREATE',
                        model: 'Exchange',
                        data: JSON.stringify(exchange),
                        status: 'PENDING'
                    }
                });
            } catch (queueError) {
                console.error('Failed to queue exchange:', queueError);
            }
        }
    }

    async syncExchangeRealtime(exchange: any) {
        if (!this.apiUrl || !prisma) return;
        try {
            console.log(`⚡ Real-time syncing exchange ${exchange.id}...`);
            await axios.post(`${this.apiUrl}/api/sync/exchanges`, { exchanges: [exchange] }, {
                headers: this.getSyncHeaders(),
                timeout: 10000
            });

            await prisma.exchange.update({
                where: { id: exchange.id },
                data: { 
                    isSynced: true,
                    lastSyncedAt: new Date()
                }
            });
            console.log(`✅ Real-time exchange sync completed for ${exchange.id}`);
        } catch (error: any) {
            console.error('Real-time exchange sync failed:', error.message);
            throw error;
        }
    }

    // Queue a refund for sync
    async queueRefund(refund: any) {
        if (!prisma) return;
        try {
            await this.syncRefundRealtime(refund);
        } catch (error) {
            console.error('Failed to sync refund in real-time, queuing offline:', error);
            try {
                await prisma.syncQueue.create({
                    data: {
                        action: 'CREATE',
                        model: 'Refund',
                        data: JSON.stringify(refund),
                        status: 'PENDING'
                    }
                });
            } catch (queueError) {
                console.error('Failed to queue refund:', queueError);
            }
        }
    }

    async syncRefundRealtime(refund: any) {
        if (!this.apiUrl || !prisma) return;
        try {
            console.log(`⚡ Real-time syncing refund ${refund.id}...`);
            await axios.post(`${this.apiUrl}/api/sync/refunds`, { refunds: [refund] }, {
                headers: this.getSyncHeaders(),
                timeout: 10000
            });

            await prisma.refund.update({
                where: { id: refund.id },
                data: { 
                    isSynced: true,
                    lastSyncedAt: new Date()
                }
            });
            console.log(`✅ Real-time refund sync completed for ${refund.id}`);
        } catch (error: any) {
            console.error('Real-time refund sync failed:', error.message);
            throw error;
        }
    }

    // Handshake: Fetch Cloud State
    async getCloudStatus() {
        if (!this.apiUrl) return null;
        try {
            const res = await axios.get(`${this.apiUrl}/api/sync/status`, {
                headers: this.getSyncHeaders(),
                timeout: 6000
            });
            return res.data;
        } catch (err: any) {
            console.warn('Could not fetch cloud sync status:', err.message);
            return null;
        }
    }

    // Verify candidate sales with cloud
    async verifySales(sales: { id: string; billNo: string; status: string; updatedAt: any }[]) {
        if (!this.apiUrl) return null;
        try {
            const res = await axios.post(`${this.apiUrl}/api/sync/verify-sales`, { sales }, {
                headers: this.getSyncHeaders(),
                timeout: 8000
            });
            return res.data;
        } catch (err: any) {
            console.warn('Could not verify sales with cloud:', err.message);
            return null;
        }
    }

    // Drain pending offline items across all models
    async drainQueueInternal() {
        if (!prisma || !this.apiUrl) return;
        try {
            const pending = await prisma.syncQueue.findMany({
                where: { status: 'PENDING' },
                take: 100
            });

            if (pending.length === 0) return;

            console.log(`Processing ${pending.length} queued offline records...`);

            const sales = pending.filter((i: any) => i.model === 'Sale').map((i: any) => JSON.parse(i.data));
            const exchanges = pending.filter((i: any) => i.model === 'Exchange').map((i: any) => JSON.parse(i.data));
            const refunds = pending.filter((i: any) => i.model === 'Refund').map((i: any) => JSON.parse(i.data));

            if (sales.length > 0) {
                await axios.post(`${this.apiUrl}/api/sync/sales`, { sales }, { headers: this.getSyncHeaders() });
                const saleIds = sales.map((s: any) => s.id);
                await prisma.sale.updateMany({
                    where: { id: { in: saleIds } },
                    data: { isSynced: true, lastSyncedAt: new Date() }
                });
            }

            if (exchanges.length > 0) {
                await axios.post(`${this.apiUrl}/api/sync/exchanges`, { exchanges }, { headers: this.getSyncHeaders() });
                const exIds = exchanges.map((e: any) => e.id);
                await prisma.exchange.updateMany({
                    where: { id: { in: exIds } },
                    data: { isSynced: true, lastSyncedAt: new Date() }
                });
            }

            if (refunds.length > 0) {
                await axios.post(`${this.apiUrl}/api/sync/refunds`, { refunds }, { headers: this.getSyncHeaders() });
                const refIds = refunds.map((r: any) => r.id);
                await prisma.refund.updateMany({
                    where: { id: { in: refIds } },
                    data: { isSynced: true, lastSyncedAt: new Date() }
                });
            }

            const idsToDelete = pending.map((p: any) => p.id);
            await prisma.syncQueue.deleteMany({
                where: { id: { in: idsToDelete } }
            });
            console.log(`✅ Successfully drained ${idsToDelete.length} offline records.`);
        } catch (error: any) {
            console.error('Drain queue error:', error.message);
        }
    }

    // Process the Sync Queue (background interval worker)
    async processQueue() {
        if (this.isSyncing || !this.apiUrl || !prisma) return;
        this.isSyncing = true;
        try {
            await this.drainQueueInternal();
        } finally {
            this.isSyncing = false;
        }
    }

    // Smart Verification & Delta Sync (Main sync function)
    async verifyAndSync() {
        if (!this.apiUrl || !prisma) {
            return { success: false, error: 'Cloud API URL is not configured in Settings.' };
        }
        if (this.isSyncing) {
            return { success: false, error: 'Sync already in progress.' };
        }

        this.isSyncing = true;
        try {
            console.log('⚡ [Smart Sync] Starting verification and delta sync...');

            // 1. Flush offline queue first
            await this.drainQueueInternal();

            // 2. Fetch cloud status
            const cloudStatus = await this.getCloudStatus();
            console.log('⚡ [Smart Sync] Cloud Status:', cloudStatus ? 'Online' : 'Offline / Unavailable');

            let salesCount = 0;
            let productsCount = 0;
            let exchangesCount = 0;
            let refundsCount = 0;

            // 3. Delta Sync: Products (only unsynced products or products with updated variant stock)
            const unsyncedProducts = await prisma.product.findMany({
                where: {
                    OR: [
                        { isSynced: false },
                        { variants: { some: { isSynced: false } } }
                    ]
                },
                include: { category: true, variants: true },
                take: 100
            });

            if (unsyncedProducts.length > 0) {
                console.log(`⚡ [Smart Sync] Syncing ${unsyncedProducts.length} unsynced products...`);
                await this.syncInventory(unsyncedProducts);
                const pIds = unsyncedProducts.map((p: any) => p.id);
                await prisma.product.updateMany({
                    where: { id: { in: pIds } },
                    data: { isSynced: true, lastSyncedAt: new Date() }
                });
                await prisma.productVariant.updateMany({
                    where: { productId: { in: pIds } },
                    data: { isSynced: true, lastSyncedAt: new Date() }
                });
                productsCount += unsyncedProducts.length;
            }

            // 4. Delta Sync: Sales & Voids
            const unsyncedSales = await prisma.sale.findMany({
                where: { isSynced: false },
                include: {
                    items: true,
                    payments: true,
                    user: { select: { id: true, username: true, name: true, role: true, isActive: true } }
                },
                take: 100,
                orderBy: { createdAt: 'asc' }
            });

            const salesToSyncMap = new Map<string, any>(unsyncedSales.map((s: any) => [s.id, s]));

            // Verify with cloud: inspect recent 50 sales for missing bills or status mismatches (e.g. offline voids)
            const candidateSales = await prisma.sale.findMany({
                select: { id: true, billNo: true, status: true, updatedAt: true },
                orderBy: { createdAt: 'desc' },
                take: 50
            });

            if (candidateSales.length > 0) {
                const verification = await this.verifySales(candidateSales);
                if (verification?.success) {
                    const idsToFetch = [
                        ...(verification.missingIds || []),
                        ...(verification.statusMismatchIds || [])
                    ].filter((id: string) => !salesToSyncMap.has(id));

                    if (idsToFetch.length > 0) {
                        console.log(`⚡ [Smart Sync] Cloud verification identified ${idsToFetch.length} missing/mismatched sales.`);
                        const fullSales = await prisma.sale.findMany({
                            where: { id: { in: idsToFetch } },
                            include: {
                                items: true,
                                payments: true,
                                user: { select: { id: true, username: true, name: true, role: true, isActive: true } }
                            }
                        });
                        for (const s of fullSales) {
                            salesToSyncMap.set(s.id, s);
                        }
                    }
                }
            }

            const finalSalesToSync = Array.from(salesToSyncMap.values());
            if (finalSalesToSync.length > 0) {
                console.log(`⚡ [Smart Sync] Syncing ${finalSalesToSync.length} sales/voids...`);
                await axios.post(`${this.apiUrl}/api/sync/sales`, { sales: finalSalesToSync }, {
                    headers: this.getSyncHeaders()
                });

                const syncedIds = finalSalesToSync.map((s: any) => s.id);
                await prisma.sale.updateMany({
                    where: { id: { in: syncedIds } },
                    data: { isSynced: true, lastSyncedAt: new Date() }
                });
                salesCount += finalSalesToSync.length;
            }

            // 5. Delta Sync: Exchanges
            const unsyncedExchanges = await prisma.exchange.findMany({
                where: { isSynced: false },
                include: { items: true, payments: true },
                take: 50
            });

            if (unsyncedExchanges.length > 0) {
                console.log(`⚡ [Smart Sync] Syncing ${unsyncedExchanges.length} exchanges...`);
                await axios.post(`${this.apiUrl}/api/sync/exchanges`, { exchanges: unsyncedExchanges }, {
                    headers: this.getSyncHeaders()
                });

                const exIds = unsyncedExchanges.map((e: any) => e.id);
                await prisma.exchange.updateMany({
                    where: { id: { in: exIds } },
                    data: { isSynced: true, lastSyncedAt: new Date() }
                });
                exchangesCount += unsyncedExchanges.length;
            }

            // 6. Delta Sync: Refunds
            const unsyncedRefunds = await prisma.refund.findMany({
                where: { isSynced: false },
                include: { items: true, payments: true },
                take: 50
            });

            if (unsyncedRefunds.length > 0) {
                console.log(`⚡ [Smart Sync] Syncing ${unsyncedRefunds.length} refunds...`);
                await axios.post(`${this.apiUrl}/api/sync/refunds`, { refunds: unsyncedRefunds }, {
                    headers: this.getSyncHeaders()
                });

                const refIds = unsyncedRefunds.map((r: any) => r.id);
                await prisma.refund.updateMany({
                    where: { id: { in: refIds } },
                    data: { isSynced: true, lastSyncedAt: new Date() }
                });
                refundsCount += unsyncedRefunds.length;
            }

            const totalSynced = salesCount + productsCount + exchangesCount + refundsCount;
            const message = totalSynced === 0
                ? 'All data is fully synchronized with cloud.'
                : `Synced: ${salesCount} sales/voids, ${productsCount} products, ${exchangesCount} exchanges, ${refundsCount} refunds.`;

            console.log(`✅ [Smart Sync] Finished. ${message}`);
            return {
                success: true,
                message,
                salesSynced: salesCount,
                productsSynced: productsCount,
                exchangesSynced: exchangesCount,
                refundsSynced: refundsCount
            };
        } catch (error: any) {
            console.error('[Smart Sync] Error during sync:', error.message);
            return { success: false, error: error.message };
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
