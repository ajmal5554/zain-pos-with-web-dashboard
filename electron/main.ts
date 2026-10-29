import { sendReceipt } from './receipt-printer.service';
import {getBusinessInsights} from './insights.service';
import {getProfitReport} from './profit.service';
import { app, BrowserWindow, ipcMain, dialog, screen, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import * as bcrypt from 'bcryptjs';
import { format as fmtDate, parse as parseDate } from 'date-fns';
import { cloudSync } from './sync.service';
import { logger } from './logger';
import { getNetworkStatusService, cleanupNetworkStatusService, type NetworkStatus } from './networkStatus.service';
import { PermissionService, PermissionMiddleware, type UserPermissions } from './permission.service';
import { quoteRefund, toPaise, validateRefundPayments, validateReturnQuantities } from '../src/lib/refund';
import { getSaleEditLockReason } from '../src/lib/saleEdit';
import { getStockOverview, getStockMovements } from './stock.service';
import { getInventoryWorkspace } from './inventory-workspace.service';
import { assertTrackedStockAvailable } from './tracked-stock.service';
import {prepareStockCosts,syncSaleCosts,restoreSaleCosts,getSaleCosts} from './stock-cost.service';
import { prepareAuditStyle, postStockBatch, adjustTrackedStock, getAuditRowStatuses, saveStockEntry } from './stock-conversion.service';
import { getStockAuditSetup, saveStockAuditSetup } from './stock-audit-setup.service';
import { saveLabelTemplate } from './label-template.service';
import { receivePurchase, payPurchase, listPurchases, purchaseDetail, purchaseItems } from './purchases.service';
import { adjustPurchase, refundPurchase } from './purchase-adjustments.service';
import {createExpense,actOnExpense,listExpenses,expenseDetail,exportExpenses} from './expenses.service';
import { getReturnStockOptions, resolveReturnStockRoutes, recordReturnStockRoutes } from './return-stock.service';
import { createExcelAuditService } from './excel-audit.service';
import {
    listDrafts as stockDraftList,
    getDraft as stockDraftGet,
    createDraft as stockDraftCreate,
    saveDraft as stockDraftSave,
    cancelDraft as stockDraftCancel,
    searchPreparedVariants as stockDraftSearchVariants,
} from './stock-draft.service';
import { escapeHtml, formatVariantDescription } from '../src/lib/catalogueDescription';
import {
    bindElectronSession, clearElectronSession, resolveElectronSessionUser,
    maskSessionResult, containsSensitiveQueryField
} from './session-auth.service';
import {
    saveProduct as catalogueSaveProduct,
    getProduct as catalogueGetProduct,
    listProducts as catalogueListProducts,
    checkBarcode as catalogueCheckBarcode,
    listVariants as catalogueListVariants,
    reserveBarcode as catalogueReserveBarcode,
    enrichCatalogueVariants,
    ensureCatalogueSchema,
    checkAnyVariantPrepared
} from './catalogue.service';

// Global error handling - MUST BE FIRST
process.on('uncaughtException', (error) => {
    dialog.showErrorBox('Main Process Error', error.stack || error.message);
});
// Custom Prisma Import for Production
let PrismaClient: any;
try {
    const isPackaged = app.isPackaged;
    if (isPackaged) {
        // Load from the app bundle (manual copy strategy)
        // In manual build, we copied 'prisma' folder to 'resources/app/prisma'
        const clientPath = path.join(app.getAppPath(), 'prisma', 'generated', 'client');

        console.log('Loading Prisma from:', clientPath);

        try {
            const prismaModule = require(clientPath);
            console.log('Loaded module keys:', Object.keys(prismaModule));

            // Robust extraction: Handle named export or default export
            PrismaClient = prismaModule.PrismaClient || prismaModule.default?.PrismaClient || prismaModule;

        } catch (requireErr: any) {
            console.error('Require failed:', requireErr);
            dialog.showErrorBox('Prisma Missing', `Could not load Prisma Client from: \n${clientPath} \n\nError: ${requireErr.message} `);
            throw requireErr;
        }

        // Verify if it is a constructor (class/function)
        const typeStr = typeof PrismaClient;
        const isFunc = typeStr === 'function';

        if (!isFunc) {
            console.error('PrismaClient is not a function!', PrismaClient);
            dialog.showErrorBox('Prisma Type Error', `Loaded PrismaClient is ${typeStr}, expected function.\nPath: ${clientPath} `);
        }

    } else {
        // In development, load from the local generated folder
        PrismaClient = require('../prisma/generated/client').PrismaClient;
    }
} catch (err) {
    console.error('Failed to load Prisma Client:', err);
    dialog.showErrorBox('Prisma Load Error', 'Failed to load database client:\n' + (err instanceof Error ? err.stack : String(err)));
}

let prisma: any; // Type as any to avoid TS errors with dynamic require
let dbBootstrappedFromResource = false;
let excelAuditService: ReturnType<typeof createExcelAuditService> | null = null;

// --- PERMISSION SYSTEM ---

/**
 * Get user permissions from database for permission checking
 */
async function getUserPermissions(userId: string): Promise<UserPermissions | null> {
    try {
        if (!prisma || !userId) return null;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                role: true,
                isActive: true,
                permPrintSticker: true,
                permAddItem: true,
                permDeleteProduct: true,
                permVoidSale: true,
                permViewReports: true,
                permEditSettings: true,
                permManageProducts: true,
                permViewSales: true,
                permViewGstReports: true,
                permEditSales: true,
                permManageInventory: true,
                permManageUsers: true,
                permViewCostPrice: true,
                permChangePayment: true,
                permDeleteAudit: true,
                permBulkUpdate: true,
                permBackDateSale: true,
                permViewInsights: true,
                maxDiscount: true
            }
        });

        return user as UserPermissions;
    } catch (error) {
        logger.error('Permission', 'Failed to get detailed user permissions, attempting safe fallback:', error);
        try {
            const fallbackUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, role: true, isActive: true }
            });
            if (fallbackUser) {
                logger.warn('Permission', 'Recovered user session with baseline permissions fallback');
                return fallbackUser as UserPermissions;
            }
        } catch (fallbackError) {
            logger.error('Permission', 'Fallback permission query also failed:', fallbackError);
        }
        return null;
    }
}

/**
 * Validate IPC request with permission checking
 */
async function validateIpcRequest(
    middleware: (user: UserPermissions | null, context?: any) => Promise<any>,
    userId: string,
    context?: any
): Promise<{ success: boolean; error?: string; user?: UserPermissions | null }> {
    try {
        const user = await getUserPermissions(userId);
        const result = await middleware(user, context);

        if (!result.allowed) {
            return {
                success: false,
                error: result.reason || 'Permission denied',
                user
            };
        }

        return { success: true, user };
    } catch (error) {
        logger.error('Permission', 'IPC permission validation failed:', error);
        return {
            success: false,
            error: 'Permission validation failed'
        };
    }
}

/**
 * Create a secure IPC handler with permission validation
 */
function createSecureIpcHandler<T>(
    channel: string,
    middleware: (user: UserPermissions | null, context?: any) => Promise<any>,
    handler: (event: any, args: T, user: UserPermissions) => Promise<any>,
    options: {
        extractUserId?: (args: T) => string;
        extractContext?: (args: T) => any;
        requiresValidation?: boolean;
        trustedSession?: boolean;
    } = {}
) {
    ipcMain.handle(channel, async (event, args: T) => {
        try {
            // Extract user ID from args (default to args.userId)
            const userId = options.extractUserId ?
                options.extractUserId(args) :
                (args as any)?.userId;

            if (!options.trustedSession && !userId && (options.requiresValidation !== false)) {
                logger.warn('Permission', `No userId provided for ${channel}`);
                return {
                    success: false,
                    error: 'User authentication required'
                };
            }

            // Extract context for permission checking
            const context = options.extractContext ?
                options.extractContext(args) :
                undefined;

            // Validate permissions
            let validation: { success: boolean; error?: string; user?: UserPermissions | null };
            if (options.trustedSession) {
                const sessionUser = await resolveElectronSessionUser(prisma, event);
                const permission = await middleware(sessionUser, context);
                validation = { success: permission.allowed, error: permission.reason, user: sessionUser };
            } else {
                validation = await validateIpcRequest(middleware, userId, context);
            }

            if (!validation.success) {
                logger.warn('Permission', `Access denied for ${channel}: ${validation.error}`);
                return {
                    success: false,
                    error: validation.error
                };
            }

            // Execute the actual handler
            return await handler(event, args, validation.user!);

        } catch (error: any) {
            logger.error('IPC', `Handler ${channel} failed:`, error);
            return {
                success: false,
                error: error.message || 'Internal server error'
            };
        }
    });
}

// --- Input Validation Helpers ---
function validateSaleData(saleData: any): string | null {
    if (!saleData) return 'Sale data is required';
    if (!saleData.userId) return 'User ID is required';
    if (!Array.isArray(saleData.items) || saleData.items.length === 0) return 'Sale must have at least one item';
    if (typeof saleData.grandTotal !== 'number' || saleData.grandTotal <= 0) return 'Invalid grand total';
    if (typeof saleData.paidAmount !== 'number') return 'Paid amount is required';
    for (const item of saleData.items) {
        if (!item.variantId) return 'Each item must have a variant ID';
        if (typeof item.quantity !== 'number' || item.quantity <= 0) return 'Each item must have a valid quantity';
        if (typeof item.sellingPrice !== 'number' || item.sellingPrice < 0) return 'Each item must have a valid price';
    }

    const payments = Array.isArray(saleData.payments) ? saleData.payments : [];
    if (payments.length === 0) return 'At least one payment entry is required';

    const roundedPaidAmount = roundCurrency(saleData.paidAmount);
    const roundedGrandTotal = roundCurrency(saleData.grandTotal);
    const roundedChangeAmount = roundCurrency(saleData.changeAmount || 0);
    const paymentsTotal = roundCurrency(
        payments.reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0)
    );

    if (payments.some((payment: any) => !payment.paymentMode)) {
        return 'Each payment entry must have a payment mode';
    }

    if (payments.some((payment: any) => typeof payment.amount !== 'number' || payment.amount < 0)) {
        return 'Each payment entry must have a valid amount';
    }

    if (paymentsTotal !== roundedGrandTotal) {
        return 'Payment entries do not match the bill total';
    }

    if (roundedPaidAmount < roundedGrandTotal) {
        return 'Paid amount cannot be less than the grand total';
    }

    if (roundCurrency(roundedPaidAmount - roundedGrandTotal) !== roundedChangeAmount) {
        return 'Change amount does not match the payment total';
    }

    return null;
}

async function checkAnyVariantPreparedSafe(tx: any, variantIds: string[]): Promise<boolean> {
    if (!variantIds || variantIds.length === 0) return false;
    try {
        const tableCheck: any[] = await tx.$queryRawUnsafe(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ProductVariantGarmentDetail'`
        );
        const hasGdTable = tableCheck && tableCheck.length > 0;

        const pvCols: any[] = await tx.$queryRawUnsafe(`PRAGMA table_info("ProductVariant")`);
        const hasPvCol = pvCols && pvCols.some((c: any) => c.name === 'isPrepared');

        if (!hasGdTable && !hasPvCol) {
            return false;
        }

        if (!hasGdTable || !hasPvCol) {
            throw new Error('Catalogue preparation schema is incomplete.');
        }
        for (let offset = 0; offset < variantIds.length; offset += 200) {
            const ids = variantIds.slice(offset, offset + 200);
            const matches: any[] = await tx.$queryRawUnsafe(
                `SELECT pv.id FROM "ProductVariant" pv
                 LEFT JOIN "ProductVariantGarmentDetail" gd ON pv.id = gd.variantId
                 WHERE pv.id IN (${ids.map(() => '?').join(',')})
                   AND (COALESCE(pv.isPrepared, 0) <> 0 OR COALESCE(gd.isPrepared, 0) <> 0) LIMIT 1`, ...ids
            );
            if (matches && matches.length > 0) return true;
        }
        return false;
    } catch {
        throw new Error('Unable to verify stock preparation status. Please retry before billing.');
    }
}

function validateProductData(data: any): string | null {
    if (!data) return 'Product data is required';
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) return 'Product name is required';
    if (data.taxRate !== undefined && (typeof data.taxRate !== 'number' || data.taxRate < 0)) return 'Invalid tax rate';
    return null;
}

function sanitizeString(value: unknown, maxLength = 500): string | undefined {
    if (value === null || value === undefined) return undefined;
    return String(value).slice(0, maxLength).trim();
}

function roundCurrency(value: unknown): number {
    const numericValue = Number(value || 0);
    return Math.round(numericValue * 100) / 100;
}

function stripPasswords<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => stripPasswords(item)) as T;
    }

    if (value instanceof Date) {
        return value;
    }

    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            if (key === 'password') continue;
            result[key] = stripPasswords(nestedValue);
        }
        return result as T;
    }

    return value;
}

// --- Bill Number Generation ---
// Format: Sequential numbers (1350, 1351, 1352...)
// Finds the highest existing bill number and increments by 1.
async function getNextBillNoForDate(invoiceDate: Date, tx?: any): Promise<string> {
    const client = tx || prisma;

    // Get all bill numbers to find the highest
    const allBills = await client.sale.findMany({
        select: { billNo: true },
        orderBy: { createdAt: 'desc' },
        take: 1000, // Check recent bills for performance
    });

    let maxBillNo = 0;
    for (const bill of allBills) {
        const billNoStr = String(bill.billNo);
        // Handle old sequential format: "1349"
        const numericMatch = billNoStr.match(/^(\d+)$/);
        if (numericMatch) {
            const num = parseInt(numericMatch[1], 10);
            if (num > maxBillNo) maxBillNo = num;
        }
        // Handle date-based format: "260318-001" -> extract 001
        const dateMatch = billNoStr.match(/^\d{6}-(\d+)$/);
        if (dateMatch) {
            // For date-based bills, we'll convert the whole thing to continue sequence
            // e.g., if highest is 260318-003, that's like bill #3 for that day
            // We want to continue from the highest overall number
            const num = parseInt(dateMatch[1], 10);
            // These are small numbers (001-999), so they won't affect max if sequential bills exist
            if (num > maxBillNo && maxBillNo < 1000) maxBillNo = num;
        }
    }

    return String(maxBillNo + 1);
}

// --- System Safety ---
let saleCounterSinceLastBackup = 0;

/**
 * Enhanced WAL flush with retry logic and verification.
 * Returns true if WAL checkpoint succeeded, false if it failed.
 */
async function flushDatabaseForBackup(): Promise<boolean> {
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Checkpoint WAL to main database file - TRUNCATE mode clears the WAL after checkpoint
            await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');

            // Verify WAL is actually empty/minimal after checkpoint
            const walPath = getDatabasePath() + '-wal';
            if (fs.existsSync(walPath)) {
                const walSize = fs.statSync(walPath).size;
                if (walSize < 1024) {
                    logger.info('Backup', `WAL checkpoint completed (attempt ${i+1})`);
                    return true; // Success: WAL is minimal
                }
            } else {
                // WAL file doesn't exist, checkpoint succeeded
                logger.info('Backup', `WAL checkpoint completed (attempt ${i+1}, no WAL file)`);
                return true;
            }

            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        } catch (err) {
            logger.warn('Backup', `WAL checkpoint attempt ${i+1} failed:`, err);
        }
    }

    logger.error('Backup', 'WAL checkpoint failed after all retries');
    return false; // Failed to checkpoint
}

/**
 * Verifies that a backup file is a valid SQLite database.
 */
async function verifyBackupIntegrity(backupPath: string): Promise<boolean> {
    try {
        const tempPrisma = new PrismaClient({
            datasources: { db: { url: `file:${backupPath}` } }
        });

        // Quick integrity check - just try to count users
        await tempPrisma.$queryRawUnsafe('PRAGMA integrity_check');
        await tempPrisma.$disconnect();

        logger.info('Backup', 'Integrity check passed');
        return true;
    } catch (err) {
        logger.error('Backup', 'Integrity check failed', err);
        return false;
    }
}

/**
 * Copies database files including WAL and SHM for fail-safe backup.
 */
async function copyDatabaseWithWAL(sourcePath: string, destinationPath: string): Promise<void> {
    // Copy main database file
    await fs.promises.copyFile(sourcePath, destinationPath);
    logger.info('Backup', 'Copied main database file');

    // Copy WAL file if exists
    const walPath = sourcePath + '-wal';
    if (fs.existsSync(walPath)) {
        await fs.promises.copyFile(walPath, destinationPath + '-wal');
        logger.info('Backup', 'Copied WAL file for fail-safe backup');
    }

    // Copy SHM file if exists
    const shmPath = sourcePath + '-shm';
    if (fs.existsSync(shmPath)) {
        await fs.promises.copyFile(shmPath, destinationPath + '-shm');
        logger.info('Backup', 'Copied SHM file for fail-safe backup');
    }
}

/**
 * Verifies backup contains recent data by checking for sales in the last hour.
 */
async function verifyBackupFreshness(backupPath: string): Promise<boolean> {
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const backupClient = new PrismaClient({
            datasources: { db: { url: `file:${backupPath}` } }
        });

        const recentSales = await backupClient.sale.count({
            where: {
                OR: [
                    { createdAt: { gte: oneHourAgo } },
                    { actualSaleDate: { gte: oneHourAgo } }
                ]
            }
        });

        await backupClient.$disconnect();

        if (recentSales > 0) {
            logger.info('Backup', `Freshness verified: ${recentSales} recent sales found`);
            return true;
        } else {
            logger.warn('Backup', 'No recent sales found - backup may be stale');
            return false;
        }
    } catch (err) {
        logger.error('Backup', 'Freshness verification failed:', err);
        return false;
    }
}

async function performAutoBackup() {
    try {
        const actualDbPath = getDatabasePath();

        if (!fs.existsSync(actualDbPath)) return;

        const backupDir = path.join(app.getPath('userData'), 'backups');
        await fs.promises.mkdir(backupDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `backup-${timestamp}.db`);

        // Enhanced backup strategy with WAL checkpoint verification
        const walCheckpointSuccess = await flushDatabaseForBackup();

        if (!walCheckpointSuccess) {
            // Fallback: Copy both main DB and WAL files
            logger.warn('Backup', 'WAL checkpoint failed - using WAL-inclusive backup strategy');
            await copyDatabaseWithWAL(actualDbPath, backupPath);
        } else {
            // Standard backup of main DB only (WAL was successfully checkpointed)
            logger.info('Backup', 'WAL checkpoint succeeded - using standard backup');
            await fs.promises.copyFile(actualDbPath, backupPath);

            // Still copy SHM file if exists for completeness
            const shmPath = actualDbPath + '-shm';
            if (fs.existsSync(shmPath)) {
                await fs.promises.copyFile(shmPath, backupPath + '-shm');
            }
        }

        logger.info('Backup', `Created: ${backupPath}`);

        // Verify backup integrity
        const integrityOk = await verifyBackupIntegrity(backupPath);
        if (!integrityOk) {
            logger.error('Backup', 'Backup failed integrity check - removing corrupt backup');
            await fs.promises.unlink(backupPath).catch(() => {});
            return;
        }

        // Verify backup contains recent data
        await verifyBackupFreshness(backupPath);

        // Keep last 10 backups
        const fileNames = await fs.promises.readdir(backupDir);
        const files = (await Promise.all(
            fileNames
                .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
                .map(async f => ({
                    name: f,
                    time: (await fs.promises.stat(path.join(backupDir, f))).mtime.getTime()
                }))
        )).sort((a, b) => b.time - a.time);

        if (files.length > 10) {
            await Promise.all(
                files.slice(10).map(async f => {
                    // Delete main file and any WAL/SHM files
                    const basePath = path.join(backupDir, f.name);
                    await fs.promises.unlink(basePath).catch(() => { });
                    await fs.promises.unlink(basePath + '-wal').catch(() => { });
                    await fs.promises.unlink(basePath + '-shm').catch(() => { });
                })
            );
        }

        // Update latest backup pointers for disaster recovery
        const userDataLatest = getUserDataLatestBackupPath();
        const persistentLatest = getPersistentBackupPath();

        await fs.promises.mkdir(path.dirname(userDataLatest), { recursive: true });
        await fs.promises.mkdir(path.dirname(persistentLatest), { recursive: true });

        await fs.promises.copyFile(backupPath, userDataLatest);
        await fs.promises.copyFile(backupPath, persistentLatest);

        logger.info('Backup', 'Auto-backup completed successfully');

    } catch (err) {
        logger.error('Backup', 'Auto-backup failed:', err);
    }
}
// ---------------------

function getDatabasePath() {
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

    if (isDev) {
        return path.join(process.cwd(), 'prisma', 'pos.db');
    }

    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'pos.db');

    // In production, the DB is copied to the resources folder via extraResources
    const resourcePath = path.join(process.resourcesPath, 'pos.db');

    if (!fs.existsSync(dbPath)) {
        console.log('Database not found at', dbPath);

        if (fs.existsSync(resourcePath)) {
            try {
                console.log('Copying database from resources:', resourcePath);
                fs.copyFileSync(resourcePath, dbPath);
                dbBootstrappedFromResource = true;
                console.log('Database copied successfully.');
            } catch (err) {
                console.error('Failed to copy database from resources:', err);
                dialog.showErrorBox('Database Error', 'Failed to initialize database. Please contact support.');
            }
        } else {
            console.error('Critical: Resource database not found at', resourcePath);
            dialog.showErrorBox('Critical Error', 'Database file missing from installation. Please reinstall.');
        }
    }

    return dbPath;
}

function getPersistentBackupPath() {
    const backupDir = path.join(app.getPath('documents'), 'ZainPOS');
    return path.join(backupDir, 'backup-latest.db');
}

function getUserDataLatestBackupPath() {
    return path.join(app.getPath('userData'), 'backups', 'backup-latest.db');
}

function getRestoreCandidates() {
    const candidates: string[] = [];

    const envPath = process.env.ZAIN_POS_BACKUP_PATH;
    if (envPath) candidates.push(envPath);

    // Durable backup outside app install/userData (survives reinstalls if user keeps Documents)
    candidates.push(getPersistentBackupPath());

    // Latest backup in userData (if still present)
    candidates.push(getUserDataLatestBackupPath());

    return candidates;
}

function getBundledRestoreCandidates() {
    const candidates: string[] = [];
    candidates.push(path.join(process.resourcesPath, 'pos.db'));

    if (!app.isPackaged) {
        candidates.push(path.join(process.cwd(), 'migration', 'backup_zain_pos_2026-02-04.db'));
    }

    return candidates;
}

function getMtimeMs(filePath: string) {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch {
        return 0;
    }
}

function shouldRestoreFrom(sourcePath: string, targetPath: string) {
    if (!fs.existsSync(sourcePath)) return false;
    if (!fs.existsSync(targetPath)) return true;
    return getMtimeMs(sourcePath) > getMtimeMs(targetPath);
}

function normalizeHeader(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeRowKeys(row: any) {
    const normalized: Record<string, any> = {};
    for (const key of Object.keys(row || {})) {
        normalized[normalizeHeader(String(key))] = row[key];
    }
    return normalized;
}

function getValNormalized(row: any, keys: string[]) {
    const normalizedRow = normalizeRowKeys(row);
    for (const key of keys) {
        const found = normalizedRow[normalizeHeader(key)];
        if (found !== undefined && found !== null && String(found).trim() !== '') {
            return found;
        }
    }
    return null;
}

function parseFlexibleDate(value: any) {
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const date = new Date(excelEpoch.getTime() + value * 86400000);
        if (!isNaN(date.getTime())) return date;
    }
    const asText = (value ?? '').toString().trim();
    if (!asText) return new Date();

    const date = new Date(asText);
    if (!isNaN(date.getTime())) return date;

    // Handles dd/mm/yyyy and dd-mm-yyyy
    const m = asText.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
        const d = Number(m[1]);
        const mm = Number(m[2]);
        const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
        const parsed = new Date(y, mm - 1, d);
        if (!isNaN(parsed.getTime())) return parsed;
    }

    return new Date();
}

async function restoreDatabaseFromSource(sourcePath: string, targetPath: string) {
    await prisma.$disconnect();
    await new Promise(r => setTimeout(r, 1000));

    // Skip copy if source and target are the same (already in place, just re-init Prisma)
    if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
    }

    prisma = new PrismaClient({
        datasources: {
            db: {
                url: `file:${targetPath}`
            }
        }
    });
}

async function ensureSchemaUpdated() {
    try {
        const allTables: any[] = await prisma.$queryRawUnsafe(
            `SELECT name FROM sqlite_master WHERE type = 'table'`
        );
        const tableSet = new Set((allTables || []).map((t: any) => t.name));
        const hasTable = (name: string) => tableSet.has(name);

        // Backfill tables introduced after older app versions so restored DBs remain readable.
        if (!hasTable('InvoicePayment')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "InvoicePayment" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "saleId" TEXT NOT NULL,
                    "paymentMode" TEXT NOT NULL,
                    "amount" REAL NOT NULL,
                    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT "InvoicePayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
                )
            `);
        }

        if (!hasTable('Exchange')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "Exchange" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "originalInvoiceId" TEXT NOT NULL,
                    "exchangeDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "differenceAmount" REAL NOT NULL,
                    "notes" TEXT,
                    "createdBy" TEXT NOT NULL,
                    CONSTRAINT "Exchange_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
                )
            `);
        }

        if (!hasTable('ExchangeItem')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "ExchangeItem" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "exchangeId" TEXT NOT NULL,
                    "returnedItemId" TEXT,
                    "returnedQty" INTEGER NOT NULL DEFAULT 0,
                    "newItemId" TEXT,
                    "newQty" INTEGER NOT NULL DEFAULT 0,
                    "priceDiff" REAL NOT NULL,
                    CONSTRAINT "ExchangeItem_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
                )
            `);
        }

        if (!hasTable('ExchangePayment')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "ExchangePayment" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "exchangeId" TEXT NOT NULL,
                    "paymentMode" TEXT NOT NULL,
                    "amount" REAL NOT NULL,
                    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT "ExchangePayment_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
                )
            `);
        }

        if (!hasTable('Refund')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "Refund" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "originalInvoiceId" TEXT NOT NULL,
                    "refundDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "totalRefundAmount" REAL NOT NULL,
                    "reason" TEXT NOT NULL,
                    "createdBy" TEXT NOT NULL,
                    CONSTRAINT "Refund_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
                )
            `);
        }

        if (!hasTable('RefundItem')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "RefundItem" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "refundId" TEXT NOT NULL,
                    "variantId" TEXT NOT NULL,
                    "quantity" INTEGER NOT NULL,
                    "amount" REAL NOT NULL,
                    CONSTRAINT "RefundItem_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
                )
            `);
        }

        if (!hasTable('RefundPayment')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "RefundPayment" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "refundId" TEXT NOT NULL,
                    "paymentMode" TEXT NOT NULL,
                    "amount" REAL NOT NULL,
                    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT "RefundPayment_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
                )
            `);
        }

        if (!hasTable('SyncQueue')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "SyncQueue" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "action" TEXT NOT NULL DEFAULT 'CREATE',
                    "model" TEXT NOT NULL,
                    "data" TEXT NOT NULL,
                    "status" TEXT NOT NULL DEFAULT 'PENDING',
                    "retryCount" INTEGER NOT NULL DEFAULT 0,
                    "error" TEXT,
                    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `);
        }

        // --- Cash Drawer / Register Reconciliation tables ---
        if (!hasTable('CashRegister')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "CashRegister" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "date" TEXT NOT NULL,
                    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "closedAt" DATETIME,
                    "openingFloat" REAL NOT NULL DEFAULT 0.0,
                    "closingExpected" REAL,
                    "closingActual" REAL,
                    "difference" REAL,
                    "status" TEXT NOT NULL DEFAULT 'OPEN',
                    "notes" TEXT
                )
            `);
            await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CashRegister_date_idx" ON "CashRegister"("date")`);
            await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CashRegister_status_idx" ON "CashRegister"("status")`);
            console.log('Created CashRegister table');
        }

        if (!hasTable('CashDrawerTx')) {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "CashDrawerTx" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "registerId" TEXT NOT NULL,
                    "type" TEXT NOT NULL,
                    "category" TEXT NOT NULL,
                    "amount" REAL NOT NULL,
                    "note" TEXT NOT NULL,
                    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT "CashDrawerTx_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "CashRegister" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
                )
            `);
            await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CashDrawerTx_registerId_idx" ON "CashDrawerTx"("registerId")`);
            console.log('Created CashDrawerTx table');
        }

        // Fix billNo INTEGER → TEXT (v1 databases have INTEGER, v2 requires TEXT)
        const billNoInfo: any[] = await prisma.$queryRawUnsafe(`PRAGMA table_info("Sale")`);
        const billNoCol = billNoInfo.find((c: any) => c.name === 'billNo');
        if (billNoCol && billNoCol.type === 'INTEGER') {
            console.log('Migrating database: Converting billNo from INTEGER to TEXT...');
            await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);

            await prisma.$executeRawUnsafe(`
                CREATE TABLE "Sale_new" (
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
                    "isHistorical" BOOLEAN NOT NULL DEFAULT 0,
                    "importedFrom" TEXT,
                    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" DATETIME NOT NULL,
                    CONSTRAINT "Sale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
                )
            `);

            await prisma.$executeRawUnsafe(`
                INSERT INTO "Sale_new"
                SELECT id, CAST(billNo AS TEXT), userId, customerName, customerPhone,
                       subtotal, discount, discountPercent, taxAmount, cgst, sgst, grandTotal,
                       paymentMethod, paidAmount, changeAmount,
                       COALESCE(status, 'COMPLETED'), remarks,
                       COALESCE(isHistorical, 0), importedFrom,
                       createdAt, updatedAt
                FROM "Sale"
            `);

            await prisma.$executeRawUnsafe(`DROP TABLE "Sale"`);
            await prisma.$executeRawUnsafe(`ALTER TABLE "Sale_new" RENAME TO "Sale"`);
            await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Sale_billNo_key" ON "Sale"("billNo")`);
            await prisma.$executeRawUnsafe(`CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt")`);
            await prisma.$executeRawUnsafe(`CREATE INDEX "Sale_status_idx" ON "Sale"("status")`);
            await prisma.$executeRawUnsafe(`CREATE INDEX "Sale_userId_idx" ON "Sale"("userId")`);

            await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
            console.log('billNo conversion complete.');
        }

        // Ensure Sale table has columns required by newer UI filters/import flags.
        const saleTableInfo: any[] = await prisma.$queryRawUnsafe(`PRAGMA table_info("Sale")`);
        const saleHas = (name: string) => saleTableInfo.some(col => col.name === name);
        if (!saleHas('customerPhone')) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Sale" ADD COLUMN customerPhone TEXT`);
        }
        if (!saleHas('status')) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Sale" ADD COLUMN status TEXT DEFAULT 'COMPLETED'`);
        }
        if (!saleHas('isHistorical')) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Sale" ADD COLUMN isHistorical BOOLEAN DEFAULT 0`);
        }
        if (!saleHas('importedFrom')) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Sale" ADD COLUMN importedFrom TEXT`);
        }

        const tableRows: any[] = await prisma.$queryRawUnsafe(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) IN('user', 'users')`
        );
        const userTable = tableRows?.[0]?.name || 'User';

        const tableInfo: any[] = await prisma.$queryRawUnsafe(`PRAGMA table_info("${userTable}")`);
        const hasColumn = (name: string) => tableInfo.some(col => col.name === name);

        // Add missing permission columns for older databases
        const columnsToAdd = [
            { name: 'permPrintSticker', type: 'BOOLEAN', defaultValue: 1 },
            { name: 'permAddItem', type: 'BOOLEAN', defaultValue: 1 },
            { name: 'permDeleteProduct', type: 'BOOLEAN', defaultValue: 1 },
            { name: 'permVoidSale', type: 'BOOLEAN', defaultValue: 1 },
            { name: 'permViewReports', type: 'BOOLEAN', defaultValue: 1 },
            { name: 'permEditSettings', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permManageProducts', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permViewSales', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permViewGstReports', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permEditSales', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permManageInventory', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permManageUsers', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permViewCostPrice', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permChangePayment', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permDeleteAudit', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permBulkUpdate', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permBackDateSale', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'permViewInsights', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'maxDiscount', type: 'REAL', defaultValue: 0 },
        ];

        for (const col of columnsToAdd) {
            if (!hasColumn(col.name)) {
                console.log(`Migrating database: Adding ${col.name} column...`);
                await prisma.$executeRawUnsafe(
                    `ALTER TABLE "${userTable}" ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue} `
                );
            }
        }

        console.log('User table migration complete.');

        // Add actualSaleDate column to Sale table if it doesn't exist
        const saleInfo: any[] = await prisma.$queryRawUnsafe(`PRAGMA table_info("Sale")`);
        const saleHasActualDate = saleInfo.some((c: any) => c.name === 'actualSaleDate');

        if (!saleHasActualDate) {
            console.log('Migrating database: Adding actualSaleDate column...');
            await prisma.$executeRawUnsafe(`ALTER TABLE "Sale" ADD COLUMN actualSaleDate DATETIME`);
            console.log('actualSaleDate column added successfully.');
        }

        // Add sync tracking columns (isSynced, lastSyncedAt) to support cloud sync
        const syncTables = ['Sale', 'Exchange', 'Refund', 'Product', 'ProductVariant', 'Customer', 'InventoryMovement'];
        for (const tableName of syncTables) {
            try {
                const tableInfo: any[] = await prisma.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`);
                const hasCol = (name: string) => tableInfo.some((c: any) => c.name === name);
                
                if (!hasCol('isSynced')) {
                    await prisma.$executeRawUnsafe(`ALTER TABLE "${tableName}" ADD COLUMN isSynced BOOLEAN DEFAULT 0`);
                    console.log(`Added isSynced to ${tableName}`);
                }
                if (!hasCol('lastSyncedAt')) {
                    await prisma.$executeRawUnsafe(`ALTER TABLE "${tableName}" ADD COLUMN lastSyncedAt DATETIME`);
                    console.log(`Added lastSyncedAt to ${tableName}`);
                }
            } catch (syncErr: any) {
                // Table may not exist in older backups - that's fine
                if (!syncErr.message?.includes('no such table')) {
                    console.warn(`Could not add sync columns to ${tableName}:`, syncErr.message);
                }
            }
        }

        // Ensure ST-02 Catalogue schema (ProductVariantGarmentDetail & isPrepared column)
        await ensureCatalogueSchema(prisma);
    } catch (error) {
        console.error('Migration error:', error);
    }
}

async function ensureUserSchemaReady() {
    await ensureSchemaUpdated();
}

function isBcryptHash(value: unknown) {
    return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

async function ensureDefaultAdmin() {
    await ensureUserSchemaReady();
    const existing = await prisma.user.findFirst({ where: { username: 'admin' } });

    // If admin exists, update to ensure all permissions are set
    if (existing) {
        const passwordRepair = isBcryptHash(existing.password)
            ? {}
            : { password: await bcrypt.hash('admin123', 10) };

        return await prisma.user.update({
            where: { id: existing.id },
            data: {
                ...passwordRepair,
                isActive: true,
                role: 'ADMIN',
                // Set ALL permissions to true for admin
                permPrintSticker: true,
                permAddItem: true,
                permDeleteProduct: true,
                permVoidSale: true,
                permViewReports: true,
                permEditSettings: true,
                permManageProducts: true,
                permViewSales: true,
                permViewGstReports: true,
                permEditSales: true,
                permManageInventory: true,
                permManageUsers: true,
                permViewCostPrice: true,
                permChangePayment: true,
                permDeleteAudit: true,
                permBulkUpdate: true,
                permBackDateSale: true,
                permViewInsights: true,
                maxDiscount: 100
            }
        });
    }
    const hashedPassword = await bcrypt.hash('admin123', 10);

    try {
        return await prisma.user.create({
            data: {
                username: 'admin',
                password: hashedPassword,
                name: 'Admin',
                role: 'ADMIN',
                isActive: true,
                // Set ALL permissions to true for admin
                permPrintSticker: true,
                permAddItem: true,
                permDeleteProduct: true,
                permVoidSale: true,
                permViewReports: true,
                permEditSettings: true,
                permManageProducts: true,
                permViewSales: true,
                permViewGstReports: true,
                permEditSales: true,
                permManageInventory: true,
                permManageUsers: true,
                permViewCostPrice: true,
                permChangePayment: true,
                permDeleteAudit: true,
                permBulkUpdate: true,
                permBackDateSale: true,
                permViewInsights: true,
                maxDiscount: 100
            }
        });
    } catch (e: any) {
        // P2002 = unique constraint: admin was already created between our check and create
        if (e?.code === 'P2002') {
            const admin = await prisma.user.findFirst({ where: { username: 'admin' } });
            if (admin) {
                const passwordRepair = isBcryptHash(admin.password)
                    ? {}
                    : { password: await bcrypt.hash('admin123', 10) };

                return await prisma.user.update({
                    where: { id: admin.id },
                    data: {
                        ...passwordRepair,
                        isActive: true,
                        role: 'ADMIN',
                        permPrintSticker: true,
                        permAddItem: true,
                        permDeleteProduct: true,
                        permVoidSale: true,
                        permViewReports: true,
                        permEditSettings: true,
                        permManageProducts: true,
                        permViewSales: true,
                        permViewGstReports: true,
                        permEditSales: true,
                        permManageInventory: true,
                        permManageUsers: true,
                        permViewCostPrice: true,
                        permChangePayment: true,
                        permDeleteAudit: true,
                        permBulkUpdate: true,
                        permBackDateSale: true,
                        permViewInsights: true,
                        maxDiscount: 100
                    }
                });
            }
            return admin;
        }
        throw e;
    }
}

async function clearBundledDataForFreshInstall() {
    try {
        console.log('Fresh install from bundled DB detected. Clearing bundled shop data...');
        await prisma.saleItem.deleteMany({});
        await prisma.sale.deleteMany({});
        await prisma.inventoryMovement.deleteMany({});
        await prisma.auditLog.deleteMany({});
        await prisma.productVariant.deleteMany({});
        await prisma.product.deleteMany({});
        await prisma.customer.deleteMany({});
        await prisma.category.deleteMany({});
        await prisma.user.deleteMany({});
        await ensureDefaultAdmin();
        console.log('Bundled shop data cleared.');
    } catch (e) {
        console.error('Bundled data cleanup failed:', e);
    }
}

async function initializePrisma() {
    let dbPath = getDatabasePath();
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

    console.log('--- DATABASE DIAGNOSTICS ---');
    console.log('Target DB Path:', dbPath);
    if (isDev) {
        const prodPath = path.join(app.getPath('userData'), 'pos.db');
        console.log('Production DB Path (for reference):', prodPath);
        console.log('Note: Running in DEV mode uses the project folder DB by default.');
    }
    console.log('---------------------------');

    // Guard: If the database file exists but is corrupt (e.g. from a forced Electron restart),
    // delete it and recreate a fresh one so the app can start.
    if (fs.existsSync(dbPath)) {
        try {
            const fd = fs.openSync(dbPath, 'r');
            const header = Buffer.alloc(16);
            fs.readSync(fd, header, 0, 16, 0);
            fs.closeSync(fd);
            const headerStr = header.toString('ascii', 0, 15);
            if (headerStr !== 'SQLite format 3') {
                console.error(`DATABASE CORRUPT: Header is "${headerStr}" instead of "SQLite format 3". Recreating...`);
                fs.unlinkSync(dbPath);
                try { fs.unlinkSync(dbPath + '-wal'); } catch (_) {}
                try { fs.unlinkSync(dbPath + '-shm'); } catch (_) {}
            }
        } catch (headerErr) {
            console.warn('Could not verify DB header, continuing:', headerErr);
        }
    }

    prisma = new PrismaClient({
        datasources: {
            db: {
                url: `file:${dbPath}`
            }
        }
    });

    // ---------------------------------------------------------
    // PERMANENT FIX: Auto-Restore if Database is Empty
    // ---------------------------------------------------------
    try {
        const userCount = await prisma.user.count();
        console.log(`Database User Count: ${userCount} `);

        if (app.isPackaged) {
            const durableCandidates = getRestoreCandidates().filter(p => fs.existsSync(p));
            const bundledCandidates = getBundledRestoreCandidates().filter(p => fs.existsSync(p));
            const newerDurableCandidate = durableCandidates.find(p => shouldRestoreFrom(p, dbPath));
            const firstRunCandidate = [...durableCandidates, ...bundledCandidates][0];
            const sourcePath = userCount === 0 ? firstRunCandidate : newerDurableCandidate;

            if (sourcePath) {
                // Verify backup integrity before auto-restore
                const isValid = await verifyBackupIntegrity(sourcePath);
                if (isValid) {
                    console.log('Attempting auto-restore from known backups...');
                    console.log(`Overwriting ${dbPath} with ${sourcePath}`);
                    await restoreDatabaseFromSource(sourcePath, dbPath);
                    console.log('Database auto-restored successfully.');
                } else {
                    console.warn(`Backup integrity check failed for ${sourcePath}, skipping auto-restore.`);
                }
            } else if (userCount === 0) {
                console.warn('No restore candidates found. Cannot auto-restore.');
            }

            // New install copied from bundled DB with no real backup: clear bundled sample/shop data.
            if (dbBootstrappedFromResource && durableCandidates.length === 0) {
                await clearBundledDataForFreshInstall();
            }

            // If still empty, show a clear message
            const finalUserCount = await prisma.user.count();
            if (finalUserCount === 0) {
                // Create a default admin user so login is always possible
                try {
                    const hashedPassword = await bcrypt.hash('admin123', 10);
                    await prisma.user.create({
                        data: {
                            username: 'admin',
                            password: hashedPassword,
                            name: 'Admin',
                            role: 'ADMIN',
                            isActive: true
                        }
                    });
                    console.log('✅ Default admin user created.');
                } catch (createErr) {
                    console.error('Failed to create default admin user:', createErr);
                }

                dialog.showMessageBoxSync({
                    type: 'warning',
                    title: 'No Users Found',
                    message: 'No users were found after auto-restore. Please make sure your backup file exists at:\n\nC:\\Users\\PC\\Documents\\ZainPOS\\backup-latest.db\n\nThen restart the app.'
                });
            }
        }
    } catch (e) {
        console.error('Auto-restore check failed:', e);
    }
    // ---------------------------------------------------------

    // Always ensure at least one admin exists (dev + production)
    await ensureDefaultAdmin();

    // Run auto-migrations
    await ensureSchemaUpdated();
}
let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
    // Load app icon using nativeImage for reliable loading (works with ASAR and filesystem paths)
    const iconPaths = [
        app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : '',
        path.join(process.cwd(), 'build', 'icon.ico'),
        path.join(__dirname, '../build/icon.ico'),
        path.join(__dirname, '../public/icon.ico'),
    ];
    let appIcon: Electron.NativeImage | undefined;
    for (const iconPath of iconPaths) {
        if (iconPath && fs.existsSync(iconPath)) {
            appIcon = nativeImage.createFromPath(iconPath);
            if (!appIcon.isEmpty()) break;
        }
    }

    mainWindow = new BrowserWindow({
        title: "ZAIN GENTS PALACE - POS System",
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        frame: false,
        backgroundColor: '#FFFFFF', // White background
        webPreferences: {
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false,
        },
        autoHideMenuBar: true,
        icon: appIcon,
    });

    // Add deep debugging listeners
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        dialog.showErrorBox('Renderer Load Failed',
            `Code: ${errorCode} \nDescription: ${errorDescription} \nURL: ${validatedURL} `);
    });

    mainWindow.webContents.on('crashed', () => {
        dialog.showErrorBox('Renderer Crashed', 'The renderer process has crashed.');
    });

    mainWindow.webContents.on('did-finish-load', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            mainWindow.focus();
            mainWindow.webContents.focus();
        }, 50);
    });

    // Load Splash Screen first
    const splashPath = path.join(__dirname, '../public/splash.html');
    if (fs.existsSync(splashPath)) {
        mainWindow.loadFile(splashPath).catch(e => console.error('Splash load failed', e));
    }

    // Delay loading the app to show splash
    setTimeout(() => {
        if (!mainWindow) return;

        if (isDev) {
            mainWindow.loadURL('http://localhost:5173');
            if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
                mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
        } else {
            const indexPath = path.join(__dirname, '../dist/index.html');

            // mainWindow.webContents.openDevTools();

            if (!fs.existsSync(indexPath)) {
                dialog.showErrorBox('Critical Error', `File not found: ${indexPath} `);
            }

            mainWindow.loadFile(indexPath).catch(err => {
                dialog.showErrorBox('Load Error', err.message);
            });
        }
    }, 2500);

    const emitWindowState = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('window:stateChanged', {
            isMaximized: mainWindow.isMaximized()
        });
    };

    mainWindow.on('maximize', emitWindowState);
    mainWindow.on('unmaximize', emitWindowState);
    mainWindow.on('enter-full-screen', emitWindowState);
    mainWindow.on('leave-full-screen', emitWindowState);
    mainWindow.on('restore', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.focus();
        mainWindow.webContents.focus();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(async () => {
    try {
        app.setAppUserModelId('com.zaingentspalace.pos');
        await initializePrisma();

        excelAuditService = createExcelAuditService({
            filePath: path.join(app.getPath('userData'), 'excel-audit.json'),
        });
        try {
            await excelAuditService.initialize();
        } catch {
            logger.warn('StockAudit', 'Excel audit review data could not be loaded. Current billing remains available.');
        }

        // Initialize Sync Service with Prisma
        cloudSync.setPrismaInstance(prisma);

        // ---------------------------------------------------------
        // FIX: Load Cloud Config on Startup
        // ---------------------------------------------------------
        const urlSetting = await prisma.setting.findUnique({ where: { key: 'CLOUD_API_URL' } });
        if (urlSetting && urlSetting.value) {
            cloudSync.setApiUrl(urlSetting.value);
            console.log('✅ Cloud API URL loaded:', urlSetting.value);
        }

        await loadCloudSyncSecret();
        const syncConfig = await prisma.setting.findUnique({ where: { key: 'CLOUD_SYNC_CONFIG' } });
        if (syncConfig && syncConfig.value) {
            const config = JSON.parse(syncConfig.value);
            if (config.intervalMinutes > 0) {
                console.log(`Starting auto - sync every ${config.intervalMinutes} minutes`);
                syncInterval = setInterval(runCloudSync, config.intervalMinutes * 60 * 1000);
            }
        }
        // Run one sync on startup when URL is configured so dashboard gets initial data.
        runCloudSync().catch((e) => console.error('Initial cloud sync failed:', e));
        // ---------------------------------------------------------

        // Start Background Sync Worker (runs every 30 seconds)
        // Checks for offline sales queue and pushes to cloud
        setInterval(() => {
            cloudSync.processQueue();
        }, 30 * 1000);

        createWindow();

        // Initialize Network Status Service and auto-sync on reconnect
        networkService = getNetworkStatusService(mainWindow || undefined);
        let previousOnlineState = networkService.getStatus().online;
        networkService.onChange((status) => {
            if (!previousOnlineState && status.online) {
                console.log('🌐 Internet connection restored! Triggering auto-sync...');
                cloudSync.verifyAndSync().catch(err => console.error('Auto-sync on reconnect failed:', err.message));
            }
            previousOnlineState = status.online;
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    } catch (err: any) {
        dialog.showErrorBox('Startup Error', err.stack || err.message);
    }
});



app.on('window-all-closed', async () => {
    // Attempt Backup on Close
    try {
        const setting = await prisma.setting.findUnique({ where: { key: 'BACKUP_CONFIG' } });
        if (setting && setting.value) {
            const config = JSON.parse(setting.value);
            // If explicit "On Close" is enabled or just default behavior?
            // Let's assume we always backup on close if enabled, or if manual "On Close" option is selected.
            // For now, let's just do it.
            if (config.enabled) await performAutoBackup();
        } else {
            // Default behavior: Backup on close
            await performAutoBackup();
        }
    } catch (e) {
        logger.error('Backup', 'Backup on close failed', e);
    }

    if (process.platform !== 'darwin') {
        // Clean up network status service
        cleanupNetworkStatusService();

        prisma.$disconnect();
        app.quit();
    }
});

let backupInterval: NodeJS.Timeout | null = null;

ipcMain.handle('backup:configure', async (_event, config) => {
    try {
        await prisma.setting.upsert({
            where: { key: 'BACKUP_CONFIG' },
            update: { value: JSON.stringify(config) },
            create: { key: 'BACKUP_CONFIG', value: JSON.stringify(config) }
        });

        // Clear existing scheduler
        if (backupInterval) {
            clearInterval(backupInterval);
            backupInterval = null;
        }

        if (config.enabled && config.intervalMinutes > 0) {
            logger.info('Backup', `Starting auto-backup every ${config.intervalMinutes} minutes`);

            // Run an immediate backup when auto-backup is enabled
            performAutoBackup().catch(err => logger.error('Backup', 'Immediate backup failed', err));

            // Then set up the interval for future backups
            backupInterval = setInterval(async () => {
                await performAutoBackup();
            }, config.intervalMinutes * 60 * 1000);
        } else if (config.enabled) {
            // Backup on close only - no interval needed
            logger.info('Backup', 'Auto-backup enabled (on close only)');
        }

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

let syncInterval: NodeJS.Timeout | null = null;

type CloudSyncCursor = { at: string; id: string };

async function getCloudSyncCursor(key: string): Promise<CloudSyncCursor | null> {
    const setting = await prisma.setting.findUnique({ where: { key } });
    if (!setting?.value) return null;
    try {
        const parsed = JSON.parse(setting.value);
        if (typeof parsed?.at === 'string' && typeof parsed?.id === 'string') {
            return parsed as CloudSyncCursor;
        }
    } catch { }
    return null;
}

async function setCloudSyncCursor(key: string, cursor: CloudSyncCursor) {
    await prisma.setting.upsert({
        where: { key },
        update: { value: JSON.stringify(cursor) },
        create: { key, value: JSON.stringify(cursor) }
    });
}

async function loadCloudSyncSecret(): Promise<string> {
    const setting = await prisma.setting.findUnique({ where: { key: 'CLOUD_SYNC_SECRET' } });
    const secret = setting?.value?.trim() || process.env.CLOUD_SYNC_SECRET || '';
    cloudSync.setSyncSecret(secret);
    return secret;
}

function assertCloudSyncStep(result: any, step: string) {
    if (result && result.success === false) {
        throw new Error(result.error || `${step} failed`);
    }
}

async function syncSalesDelta(batchSize = 500) {
    const cursorKey = 'CLOUD_SALES_CURSOR';
    let cursor = await getCloudSyncCursor(cursorKey);
    let totalSynced = 0;

    while (true) {
        const where: any = cursor
            ? {
                OR: [
                    { updatedAt: { gt: new Date(cursor.at) } },
                    { AND: [{ updatedAt: new Date(cursor.at) }, { id: { gt: cursor.id } }] }
                ]
            }
            : {};

        const sales = await prisma.sale.findMany({
            where,
            include: { items: true, user: true },
            orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
            take: batchSize
        });

        if (sales.length === 0) break;

        const result = await cloudSync.syncSales(sales);
        if (result && (result as any).success === false) {
            throw new Error((result as any).error || 'Sales delta sync failed');
        }

        const last = sales[sales.length - 1];
        cursor = { at: new Date(last.updatedAt).toISOString(), id: last.id };
        await setCloudSyncCursor(cursorKey, cursor);
        totalSynced += sales.length;
    }

    return totalSynced;
}

async function syncAuditDelta(batchSize = 500) {
    const cursorKey = 'CLOUD_AUDIT_CURSOR';
    let cursor = await getCloudSyncCursor(cursorKey);
    let totalSynced = 0;

    while (true) {
        const where: any = cursor
            ? {
                OR: [
                    { createdAt: { gt: new Date(cursor.at) } },
                    { AND: [{ createdAt: new Date(cursor.at) }, { id: { gt: cursor.id } }] }
                ]
            }
            : {};

        const auditLogs = await prisma.auditLog.findMany({
            where,
            include: { user: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: batchSize
        });

        if (auditLogs.length === 0) break;

        const result = await cloudSync.syncAuditLogs(auditLogs);
        if (result && (result as any).success === false) {
            throw new Error((result as any).error || 'Audit delta sync failed');
        }

        const last = auditLogs[auditLogs.length - 1];
        cursor = { at: new Date(last.createdAt).toISOString(), id: last.id };
        await setCloudSyncCursor(cursorKey, cursor);
        totalSynced += auditLogs.length;
    }

    return totalSynced;
}

async function runCloudSync() {
    try {
        const setting = await prisma.setting.findUnique({ where: { key: 'CLOUD_API_URL' } });
        if (!setting || !setting.value) return;

        cloudSync.setApiUrl(setting.value);
        await loadCloudSyncSecret();

        const result = await cloudSync.verifyAndSync();
        const auditSynced = await syncAuditDelta().catch(() => 0);

        console.log(`Background Cloud Sync Complete:`, result?.message || result, `(audit: ${auditSynced})`);
    } catch (e) {
        console.error('Background Sync Failed:', e);
    }
}

ipcMain.handle('cloud:configure', async (_event, { intervalMinutes }) => {
    if (syncInterval) clearInterval(syncInterval);

    if (intervalMinutes > 0) {
        console.log(`Starting auto - sync every ${intervalMinutes} minutes`);
        syncInterval = setInterval(runCloudSync, intervalMinutes * 60 * 1000);
    }

    await prisma.setting.upsert({
        where: { key: 'CLOUD_SYNC_CONFIG' },
        update: { value: JSON.stringify({ intervalMinutes }) },
        create: { key: 'CLOUD_SYNC_CONFIG', value: JSON.stringify({ intervalMinutes }) }
    });
    // Trigger one immediate sync after updating config.
    runCloudSync().catch((e) => console.error('Immediate cloud sync failed:', e));
    return { success: true };
});

let productSyncTimer: NodeJS.Timeout | null = null;
function debouncedProductSync() {
    if (productSyncTimer) clearTimeout(productSyncTimer);
    productSyncTimer = setTimeout(() => {
        cloudSync.verifyAndSync().catch(err => console.warn('Debounced product sync skipped:', err.message));
    }, 4000);
}

// Secure database query handler with permission validation
createSecureIpcHandler(
    'db:secureQuery',
    async (user, context) => {
        const { model, method } = context || {};

        // Define permission requirements for each model/method combination
        const permissionMatrix: Record<string, any> = {
            // User management operations
            'user.findMany': PermissionMiddleware.manageUsers,
            'user.findUnique': async (u: any, ctx: any) => {
                // Users can read their own data, admins can read any user data
                if (u?.id === ctx?.targetId || u?.role === 'ADMIN') {
                    return { allowed: true, auditEvent: { userId: u?.id || 'anonymous', action: 'read-user', success: true } };
                }
                return await PermissionMiddleware.manageUsers(u, ctx);
            },
            'user.create': PermissionMiddleware.manageUsers,
            'user.update': PermissionMiddleware.manageUsers,
            'user.delete': PermissionMiddleware.manageUsers,

            // Product management
            'product.findMany': PermissionMiddleware.authenticated,
            'product.findUnique': PermissionMiddleware.authenticated,
            'product.findFirst': PermissionMiddleware.authenticated,
            'product.create': PermissionMiddleware.manageProducts,
            'product.update': PermissionMiddleware.manageProducts,
            'product.updateMany': PermissionMiddleware.manageProducts,
            'product.delete': PermissionMiddleware.deleteProduct,

            // Product variants
            'productVariant.findMany': PermissionMiddleware.authenticated,
            'productVariant.findUnique': PermissionMiddleware.authenticated,
            'productVariant.findFirst': PermissionMiddleware.authenticated,
            'productVariant.create': PermissionMiddleware.manageProducts,
            'productVariant.update': PermissionMiddleware.manageProducts,
            'productVariant.updateMany': PermissionMiddleware.manageProducts,
            'productVariant.delete': PermissionMiddleware.deleteProduct,

            // Categories
            'category.findMany': PermissionMiddleware.authenticated,
            'category.findUnique': PermissionMiddleware.authenticated,
            'category.create': PermissionMiddleware.manageProducts,
            'category.update': PermissionMiddleware.manageProducts,
            'category.delete': PermissionMiddleware.manageProducts,

            // Sales data (read-only for most users)
            'sale.findMany': PermissionMiddleware.authenticated, // Basic sales viewing
            'sale.findUnique': PermissionMiddleware.authenticated,
            'sale.count': PermissionMiddleware.authenticated,
            'sale.aggregate': PermissionMiddleware.viewReports,
            'sale.groupBy': PermissionMiddleware.viewReports,
            'saleItem.findMany': PermissionMiddleware.authenticated,
            'saleItem.aggregate': PermissionMiddleware.viewReports,
            'invoicePayment.findMany': PermissionMiddleware.authenticated,
            'invoicePayment.aggregate': PermissionMiddleware.viewReports,

            // Audit logs (admin only)
            'auditLog.findMany': PermissionMiddleware.adminOnly,
            'auditLog.findUnique': PermissionMiddleware.adminOnly,
            'auditLog.create': PermissionMiddleware.authenticated,

            // Settings
            'setting.findMany': PermissionMiddleware.editSettings,
            'setting.findUnique': PermissionMiddleware.authenticated,
            'setting.create': PermissionMiddleware.editSettings,
            'setting.update': PermissionMiddleware.editSettings,
            'setting.upsert': PermissionMiddleware.editSettings,

            // Customers
            'customer.findUnique': PermissionMiddleware.authenticated,
            'customer.findMany': PermissionMiddleware.authenticated,
            'customer.count': PermissionMiddleware.authenticated,
            'customer.create': PermissionMiddleware.authenticated,
            'customer.update': PermissionMiddleware.authenticated,
            'customer.delete': PermissionMiddleware.authenticated,

            // Inventory movements
            'inventoryMovement.findMany': PermissionMiddleware.authenticated,
            'inventoryMovement.create': PermissionMiddleware.authenticated
        };

        const key = `${model}.${method}`;
        const middleware = permissionMatrix[key];

        if (!middleware) {
            return {
                allowed: false,
                reason: `Operation ${key} not permitted`,
                auditEvent: {
                    userId: user?.id || 'anonymous',
                    action: 'unauthorized-db-access',
                    resource: key,
                    success: false,
                    reason: 'Operation not in permission matrix'
                }
            };
        }

        return await middleware(user, context);
    },
    async (_event, { model, method, args, userId }, user) => {
        // Whitelist allowed models and methods to prevent arbitrary DB access
        const allowedModels = [
            'user', 'product', 'productVariant', 'category', 'customer',
            'sale', 'saleItem', 'auditLog', 'inventoryMovement', 'setting'
        ];
        const allowedMethods = [
            'findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy',
            'create', 'update', 'updateMany', 'delete', 'upsert'
        ];

        if (!allowedModels.includes(model)) {
            return { success: false, error: `Access to model '${model}' is not permitted` };
        }
        if (!allowedMethods.includes(method)) {
            return { success: false, error: `Method '${method}' is not permitted. Use specific handlers for mutations.` };
        }

        const isMutation = ['create', 'update', 'updateMany', 'delete', 'upsert'].includes(method);
        const mutationData = method === 'upsert' ? [args?.create, args?.update] : [args?.data];
        if (isMutation && mutationData.some(data => data && Object.values(data).some(
            value => value !== null && typeof value === 'object' && !(value instanceof Date)
        ))) {
            return { success: false, error: 'Nested database writes are not permitted. Use the dedicated workflow.' };
        }
        if (isMutation && ['product', 'productVariant'].includes(model)) {
            // Catalogue changes must pass the atomic ST-02 service. Preserve the
            // existing soft-delete UI without reopening stock/barcode write access.
            const keys = Object.keys(args?.data || {});
            const isSoftDeactivate = ['update', 'updateMany'].includes(method)
                && keys.length === 1 && keys[0] === 'isActive' && args.data.isActive === false;
            if (!isSoftDeactivate) {
                return { success: false, error: 'Use Products to save catalogue changes. Stock changes require the stock workflow.' };
            }
        }
        if (isMutation && model === 'category') {
            // Reject nested Product/Variant writes hidden inside category mutations.
            if (!['create', 'update', 'delete'].includes(method)
                || Object.keys(args?.data || {}).some(key => !['id', 'name'].includes(key))
                || Object.values(args?.data || {}).some(value => value !== null && typeof value === 'object')) {
                return { success: false, error: 'Nested catalogue changes are not permitted.' };
            }
        }
        if (user.role !== 'ADMIN' && !user.permViewCostPrice && containsSensitiveQueryField(args, 'costPrice')) {
            return { success: false, error: 'Permission denied: cost prices are restricted.' };
        }
        const result = await (prisma as any)[model][method](args);

        // Auto-sync products when created or updated
        if (['create', 'update', 'updateMany', 'delete', 'upsert'].includes(method) &&
            ['product', 'productVariant', 'category'].includes(model)) {
            debouncedProductSync();
        }

        return { success: true, data: maskSessionResult(result, user) };
    },
    {
        trustedSession: true,
        extractUserId: (args: any) => args.userId,
        extractContext: (args: any) => ({
            model: args.model,
            method: args.method,
            targetId: args.args?.where?.id // For operations targeting specific records
        })
    }
);

// Settings (SECURE VERSIONS)
createSecureIpcHandler<{ key: string }>(
    'settings:get',
    async () => ({
        allowed: true,
        auditEvent: {
            userId: 'system',
            action: 'read-setting',
            success: true,
            reason: 'Read-only settings access allowed'
        }
    }),
    async (_event, { key }, user) => {
        const setting = await prisma.setting.findUnique({ where: { key } });
        return { success: true, data: setting?.value };
    },
    {
        requiresValidation: false
    }
);

createSecureIpcHandler(
    'settings:set',
    PermissionMiddleware.editSettings,
    async (_event, { key, value, userId }, user) => {
        const setting = await prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });

        await prisma.auditLog.create({
            data: {
                action: 'SETTING_UPDATE',
                details: `Setting "${key}" updated by ${user.role} user`,
                userId
            }
        });

        logger.info('Settings', `Setting "${key}" updated by user ${userId} (${user.role})`);
        return { success: true, data: setting };
    },
    {
        extractUserId: (args: any) => args.userId
    }
);

createSecureIpcHandler('settings:saveLabelTemplate', PermissionMiddleware.editSettings, async (_event, input: any, user) => {
    try { return { success: true, data: await saveLabelTemplate(prisma, input, user) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not save label settings.' }; }
}, { trustedSession: true });

// Helper for Local Timestamp (Fixes 5:30 AM Bug)
function getLocalISOString() {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
    const localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, -1);
    return localISOTime;
}

// Bill Number Generation (preview for UI — actual assignment happens at checkout)
ipcMain.handle('sales:getNextBillNo', async () => {
    try {
        const nextBillNo = await getNextBillNoForDate(new Date());
        return { success: true, data: nextBillNo };
    } catch (error: any) {
        console.error('Failed to get next bill number:', error);
        return { success: false, error: error.message };
    }
});

// Sale Checkout (Transaction Support + Mixed Payments)
ipcMain.handle('sales:checkout', async (_event, saleData) => {
    // Validate input before touching the database
    const validationError = validateSaleData(saleData);
    if (validationError) {
        return { success: false, error: validationError };
    }

    // Sanitize free-text fields
    saleData.customerName = sanitizeString(saleData.customerName, 200);
    saleData.customerPhone = sanitizeString(saleData.customerPhone, 20);
    saleData.remarks = sanitizeString(saleData.remarks, 500);

    let result;
    try {
      result = await prisma.$transaction(async (tx: any) => {
        try {
            const createdAt = new Date();  // Always use current timestamp for invoice

            // Validate user permissions and discount allowance
            if (saleData.userId) {
                const checkoutUser = await tx.user.findUnique({
                    where: { id: saleData.userId },
                    select: { role: true, maxDiscount: true, isActive: true }
                });
                if (!checkoutUser || !checkoutUser.isActive) {
                    throw new Error('User account is invalid or deactivated.');
                }
                if (checkoutUser.role !== 'ADMIN') {
                    const subtotalNum = Number(saleData.subtotal || 0);
                    const discountNum = Number(saleData.discount || 0);
                    const discountPercent = subtotalNum > 0 ? (discountNum / subtotalNum) * 100 : 0;
                    const maxAllowedPercent = Number(checkoutUser.maxDiscount || 0);
                    if (discountPercent > maxAllowedPercent + 0.05) {
                        throw new Error(`Discount (${discountPercent.toFixed(1)}%) exceeds allowed limit of ${maxAllowedPercent}%.`);
                    }
                }
            }

            // ST-02: Reject sale of variants in preparation state
            const checkoutVariantIds = (saleData.items || []).map((i: any) => i.variantId).filter(Boolean);
            if (await checkAnyVariantPreparedSafe(tx, checkoutVariantIds)) {
                throw new Error('Stock conversion pending for this item. Cannot be sold until converted.');
            }
            await assertTrackedStockAvailable(tx, (saleData.items || []).map((item: any) => ({
                variantId: item.variantId, quantity: item.quantity,
            })));

            const net = roundCurrency(Number(saleData.subtotal || 0) - Number(saleData.discount || 0));
            const taxable = roundCurrency(net / 1.05);
            const taxAmount = roundCurrency(net - taxable);
            const cgst = roundCurrency(taxAmount / 2);
            const sgst = roundCurrency(taxAmount / 2);

            // Atomically assign next sequential bill number
            const billNo = await getNextBillNoForDate(createdAt, tx);

            // 1. Create Sale
            const sale = await tx.sale.create({
                data: {
                    billNo,
                    userId: saleData.userId,
                    customerName: saleData.customerName,
                    customerPhone: saleData.customerPhone,
                    subtotal: saleData.subtotal,
                    discount: saleData.discount,
                    discountPercent: saleData.discountPercent || 0,
                    taxAmount,
                    cgst,
                    sgst,
                    grandTotal: saleData.grandTotal,
                    paymentMethod: saleData.paymentMethod, // Main method for display
                    paidAmount: saleData.paidAmount,
                    changeAmount: saleData.changeAmount,
                    remarks: saleData.remarks,
                    createdAt: createdAt,
                    items: {
                        create: saleData.items.map((item: any) => ({
                            variantId: item.variantId,
                            productName: item.productName,
                            variantInfo: item.variantInfo,
                            quantity: item.quantity,
                            mrp: item.mrp,
                            sellingPrice: item.sellingPrice,
                            discount: item.discount,
                            taxRate: item.taxRate,
                            taxAmount: item.taxAmount,
                            total: item.total,
                        })),
                    },
                    payments: {
                        create: saleData.payments || [{
                            paymentMode: saleData.paymentMethod,
                            amount: saleData.grandTotal
                        }]
                    }
                },
                include: { items: true, payments: true }
            });

            // Auto-register / sync customer to Customer directory table if not a generic walk-in
            const checkoutCustName = (saleData.customerName || '').trim();
            const checkoutCustPhone = (saleData.customerPhone || '').trim() || null;
            const isCheckoutWalkIn = !checkoutCustName || checkoutCustName.toLowerCase() === 'walk-in customer' || checkoutCustName.toLowerCase() === 'walk-in';

            if (!isCheckoutWalkIn || checkoutCustPhone) {
                try {
                    if (checkoutCustPhone) {
                        const existing = await tx.customer.findUnique({
                            where: { phone: checkoutCustPhone }
                        });
                        if (!existing) {
                            await tx.customer.create({
                                data: {
                                    name: isCheckoutWalkIn ? `Customer ${checkoutCustPhone}` : checkoutCustName,
                                    phone: checkoutCustPhone,
                                    isSynced: false
                                }
                            });
                        } else if (!isCheckoutWalkIn && existing.name.startsWith('Customer ') && checkoutCustName !== existing.name) {
                            await tx.customer.update({
                                where: { id: existing.id },
                                data: { name: checkoutCustName, isSynced: false }
                            });
                        }
                    } else if (!isCheckoutWalkIn) {
                        const existing = await tx.customer.findFirst({
                            where: { name: checkoutCustName }
                        });
                        if (!existing) {
                            await tx.customer.create({
                                data: {
                                    name: checkoutCustName,
                                    phone: null,
                                    isSynced: false
                                }
                            });
                        }
                    }
                } catch (autoCustErr) {
                    console.warn('Customer auto-registration on checkout skipped:', autoCustErr);
                }
            }

            const checkoutCostQuantities=new Map<string,number>();
            for(const item of saleData.items)checkoutCostQuantities.set(item.variantId,(checkoutCostQuantities.get(item.variantId)||0)+item.quantity);
            await syncSaleCosts(tx,sale.id,checkoutCostQuantities);
            // 2. Update Stock and Inventory Movements
            for (const item of saleData.items) {
                await tx.productVariant.update({
                    where: { id: item.variantId },
                    data: { stock: { decrement: item.quantity }, isSynced: false }
                });

                await tx.inventoryMovement.create({
                    data: {
                        variantId: item.variantId,
                        type: 'OUT',
                        quantity: -item.quantity,
                        reason: 'Sale',
                        reference: sale.id,
                        createdBy: saleData.userId,
                        createdAt: createdAt
                    }
                });
            }

            // NOTE: SALE_CREATE audit log removed - redundant with Sales History
            // Activity log is for security-relevant actions, not routine sales
            // Sales are already tracked in Sales History page

            // Trigger Backup every 10 sales
            saleCounterSinceLastBackup++;
            if (saleCounterSinceLastBackup >= 10) {
                performAutoBackup();
                saleCounterSinceLastBackup = 0;
            }

            return { success: true, data: sale };
        } catch (error: any) {
            console.error('Checkout failed:', error);
            throw error; // Transaction will rollback
        }
      });
    } catch (error: any) {
        console.error('sales:checkout transaction error:', error);
        return { success: false, error: error.message };
    }

    if (result?.success && result?.data) {
        cloudSync.queueSale(result.data).catch(err => console.error('Queue Error:', err));
    }
    return result;
});

// Update Payment for Existing Sale
ipcMain.handle('sales:updatePayment', async (_event, { saleId, paymentData, userId }) => {
    let result;
    try {
      result = await prisma.$transaction(async (tx: any) => {
        try {
            // 1. Load user and sale
            const user = await tx.user.findUnique({ where: { id: userId } });
            const originalSale = await tx.sale.findUnique({
                where: { id: saleId },
                include: { payments: true }
            });
            if (!originalSale) throw new Error("Sale not found.");

            const isExchangeGeneratedSale =
                originalSale.paymentMethod === 'EXCHANGE' ||
                (originalSale.remarks || '').includes('Replacement sale for Invoice');

            const canChangePayment =
                user?.role === 'ADMIN' ||
                !!user?.permChangePayment ||
                (isExchangeGeneratedSale && !!user?.permEditSales);

            if (!canChangePayment) {
                throw new Error("Unauthorized: You do not have permission to change payment modes.");
            }

            const normalizePayments = (payments: any[] = []) =>
                payments
                    .map((p: any) => ({
                        paymentMode: p.paymentMode,
                        amount: Number(p.amount || 0)
                    }))
                    .sort((a: any, b: any) => a.paymentMode.localeCompare(b.paymentMode));

            const nextPayments = normalizePayments(paymentData.payments || []);
            const previousPayments = normalizePayments(originalSale.payments || []);
            const paymentChanged =
                originalSale.paymentMethod !== paymentData.paymentMethod ||
                Number(originalSale.paidAmount || 0) !== Number(paymentData.paidAmount || 0) ||
                Number(originalSale.changeAmount || 0) !== Number(paymentData.changeAmount || 0) ||
                JSON.stringify(previousPayments) !== JSON.stringify(nextPayments);

            // 2. Update Sale Record
            const updatedSale = await tx.sale.update({
                where: { id: saleId },
                data: {
                    paymentMethod: paymentData.paymentMethod,
                    paidAmount: paymentData.paidAmount,
                    changeAmount: paymentData.changeAmount,
                    isSynced: false
                }
            });

            // 3. Update Payments (Delete and Re-create)
            await tx.invoicePayment.deleteMany({ where: { saleId } });
            await tx.invoicePayment.createMany({
                data: (paymentData.payments || []).map((p: any) => ({
                    saleId: saleId,
                    paymentMode: p.paymentMode,
                    amount: p.amount
                }))
            });

            // 4. Log Activity only when the persisted payment state changed
            let createdAuditLog = null;
            if (paymentChanged) {
                const paymentPayload = {
                    version: 2,
                    type: 'PAYMENT_UPDATE',
                    invoiceNo: String(originalSale.billNo),
                    summary: `Payment method updated for Bill #${originalSale.billNo}: ${originalSale.paymentMethod} -> ${paymentData.paymentMethod}`,
                    payment: {
                        before: {
                            method: originalSale.paymentMethod,
                            paidAmount: Number(originalSale.paidAmount || 0),
                            payments: previousPayments
                        },
                        after: {
                            method: paymentData.paymentMethod,
                            paidAmount: Number(paymentData.paidAmount || 0),
                            payments: nextPayments
                        }
                    }
                };

                createdAuditLog = await tx.auditLog.create({
                    data: {
                        action: 'PAYMENT_UPDATE',
                        details: JSON.stringify(paymentPayload),
                        userId: userId
                    },
                    include: {
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
            }

            // 5. Return refreshed sale
            return {
                success: true,
                data: await tx.sale.findUnique({
                    where: { id: saleId },
                    include: { items: true, payments: true }
                }),
                auditLog: createdAuditLog
            };
        } catch (error: any) {
            console.error('Update Payment failed:', error);
            return { success: false, error: error.message };
        }
      });
    } catch (error: any) {
        console.error('sales:updatePayment transaction error:', error);
        return { success: false, error: error.message };
    }

    if (result?.success && result?.data) {
        cloudSync.queueSale(result.data).catch(err => console.error('Queue Error:', err));
        if (result.auditLog) {
            cloudSync.syncAuditLogs([result.auditLog]).catch(err => console.error('Audit Sync Error:', err));
        }
    }
    return result;
});

// Get Sale By ID (for change detection before update)
ipcMain.handle('sales:getSaleById', async (_event, saleId) => {
    try {
        const sale = await prisma.sale.findUnique({
            where: { id: saleId },
            include: {
                items: true,
                payments: true,
                exchanges: { select: { id: true } },
                refunds: { select: { id: true } },
                user: {
                    select: { name: true, role: true }
                }
            }
        });

        if (!sale) {
            return { success: false, error: 'Sale not found' };
        }

        return { success: true, data: sale };
    } catch (error: any) {
        console.error('getSaleById error:', error);
        return { success: false, error: error.message };
    }
});

// Update Sale (Items + Amounts + Payments) from POS Edit Screen
ipcMain.handle('sales:updateSale', async (_event, { saleId, saleData, userId }) => {
    const normalizedSaleData = {
        ...saleData,
        userId
    };

    const validationError = validateSaleData(normalizedSaleData);
    if (validationError) {
        return { success: false, error: validationError };
    }

    normalizedSaleData.customerName = sanitizeString(normalizedSaleData.customerName, 200);
    normalizedSaleData.customerPhone = sanitizeString(normalizedSaleData.customerPhone, 20);
    normalizedSaleData.remarks = sanitizeString(normalizedSaleData.remarks, 500);

    let result;
    try {
      result = await prisma.$transaction(async (tx: any) => {
        try {
            // 1. Verify Permission
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user?.isActive || (user?.role !== 'ADMIN' && !user?.permEditSales)) {
                throw new Error("Unauthorized: You do not have permission to edit finalized sales.");
            }

            // 2. Fetch Original Sale
            const originalSale = await tx.sale.findUnique({
                where: { id: saleId },
                include: { items: true, payments: true, exchanges: { select: { id: true } }, refunds: { select: { id: true } } }
            });
            if (!originalSale) throw new Error("Sale not found.");
            const editLockReason = getSaleEditLockReason(originalSale);
            if (editLockReason) throw new Error(editLockReason);

            const oldQtyByVariant = new Map<string, number>();
            for (const item of originalSale.items) {
                oldQtyByVariant.set(item.variantId, (oldQtyByVariant.get(item.variantId) || 0) + item.quantity);
            }

            const newItems = normalizedSaleData.items || [];
            const newQtyByVariant = new Map<string, number>();
            for (const item of newItems) {
                newQtyByVariant.set(item.variantId, (newQtyByVariant.get(item.variantId) || 0) + item.quantity);
            }

            const affectedVariantIds = new Set<string>([
                ...oldQtyByVariant.keys(),
                ...newQtyByVariant.keys()
            ]);

            // ST-02: Reject sale updates that increase/add items in preparation state
            const addedVariantIds = Array.from(affectedVariantIds).filter(vid => {
                const oldQty = oldQtyByVariant.get(vid) || 0;
                const newQty = newQtyByVariant.get(vid) || 0;
                return newQty > oldQty;
            });
            if (addedVariantIds.length > 0 && await checkAnyVariantPreparedSafe(tx, addedVariantIds)) {
                throw new Error('Stock conversion pending for this item. Cannot be sold until converted.');
            }
            await assertTrackedStockAvailable(tx, Array.from(affectedVariantIds).map(variantId => ({
                variantId, quantity: (newQtyByVariant.get(variantId) || 0) - (oldQtyByVariant.get(variantId) || 0),
            })));

            await syncSaleCosts(tx,saleId,newQtyByVariant,oldQtyByVariant);
            // 3. Update stock based on quantity delta
            for (const variantId of affectedVariantIds) {
                const oldQty = oldQtyByVariant.get(variantId) || 0;
                const newQty = newQtyByVariant.get(variantId) || 0;
                const delta = newQty - oldQty;
                if (delta === 0) continue;

                if (delta > 0) {
                    // More items sold now -> reduce stock
                    await tx.productVariant.update({
                        where: { id: variantId },
                        data: { stock: { decrement: delta }, isSynced: false }
                    });
                    await tx.inventoryMovement.create({
                        data: {
                            variantId,
                            type: 'OUT',
                            quantity: -delta,
                            reason: `Sale Update: additional qty on Bill #${originalSale.billNo}`,
                            reference: saleId,
                            createdBy: userId
                        }
                    });
                } else {
                    // Fewer items sold now -> return stock
                    const restockQty = Math.abs(delta);
                    await tx.productVariant.update({
                        where: { id: variantId },
                        data: { stock: { increment: restockQty }, isSynced: false }
                    });
                    await tx.inventoryMovement.create({
                        data: {
                            variantId,
                            type: 'IN',
                            quantity: restockQty,
                            reason: `Sale Update: item removed/reduced on Bill #${originalSale.billNo}`,
                            reference: saleId,
                            createdBy: userId
                        }
                    });
                }
            }

            // 4. Replace sale items with updated set
            await tx.saleItem.deleteMany({ where: { saleId } });
            if (newItems.length > 0) {
                await tx.saleItem.createMany({
                    data: newItems.map((item: any) => ({
                        saleId,
                        variantId: item.variantId,
                        productName: item.productName,
                        variantInfo: item.variantInfo,
                        quantity: item.quantity,
                        mrp: item.mrp,
                        sellingPrice: item.sellingPrice,
                        discount: item.discount || 0,
                        taxRate: item.taxRate || 0,
                        taxAmount: item.taxAmount || 0,
                        total: item.total || 0
                    }))
                });
            }

            // 5. Update sale totals/header
            const oldItemCount = originalSale.items.reduce((sum: number, it: any) => sum + it.quantity, 0);
            const newItemCount = newItems.reduce((sum: number, it: any) => sum + (it.quantity || 0), 0);

            const describeItem = (item: any) => {
                const baseName = item.productName || 'Item';
                const variant = (item.variantInfo || '').trim();
                return variant ? `${baseName} (${variant})` : baseName;
            };

            const oldItemsByVariant = new Map<string, any>(
                (originalSale.items || []).map((item: any) => [item.variantId, item])
            );
            const newItemsByVariant = new Map<string, any>(
                (newItems || []).map((item: any) => [item.variantId, item])
            );

            const itemChanges: string[] = [];
            const structuredItemChanges: Array<{
                type: 'ADDED' | 'REMOVED' | 'QTY_CHANGED' | 'RATE_CHANGED';
                name: string;
                variant?: string;
                oldQty?: number;
                newQty?: number;
                oldRate?: number;
                newRate?: number;
                rate?: number;
            }> = [];

            const changedVariantIds = new Set<string>([
                ...oldItemsByVariant.keys(),
                ...newItemsByVariant.keys()
            ]);

            for (const variantId of changedVariantIds) {
                const oldItem = oldItemsByVariant.get(variantId);
                const newItem = newItemsByVariant.get(variantId);

                if (!oldItem && newItem) {
                    const desc = describeItem(newItem);
                    itemChanges.push(`added ${desc} x${newItem.quantity}`);
                    structuredItemChanges.push({
                        type: 'ADDED',
                        name: newItem.productName || 'Item',
                        variant: (newItem.variantInfo || '').trim() || undefined,
                        newQty: Number(newItem.quantity || 1),
                        rate: Number(newItem.sellingPrice || 0)
                    });
                    continue;
                }

                if (oldItem && !newItem) {
                    const desc = describeItem(oldItem);
                    itemChanges.push(`removed ${desc} x${oldItem.quantity}`);
                    structuredItemChanges.push({
                        type: 'REMOVED',
                        name: oldItem.productName || 'Item',
                        variant: (oldItem.variantInfo || '').trim() || undefined,
                        oldQty: Number(oldItem.quantity || 1),
                        rate: Number(oldItem.sellingPrice || 0)
                    });
                    continue;
                }

                if (oldItem && newItem) {
                    const oldQty = Number(oldItem.quantity || 0);
                    const newQty = Number(newItem.quantity || 0);
                    const oldPrice = Number(oldItem.sellingPrice || 0);
                    const newPrice = Number(newItem.sellingPrice || 0);

                    if (oldQty !== newQty) {
                        const desc = describeItem(newItem);
                        itemChanges.push(`${desc} qty ${oldQty} -> ${newQty}`);
                        structuredItemChanges.push({
                            type: 'QTY_CHANGED',
                            name: newItem.productName || 'Item',
                            variant: (newItem.variantInfo || '').trim() || undefined,
                            oldQty,
                            newQty,
                            rate: newPrice
                        });
                    }
                    if (oldPrice !== newPrice) {
                        const desc = describeItem(newItem);
                        itemChanges.push(`${desc} rate Rs.${oldPrice.toFixed(2)} -> Rs.${newPrice.toFixed(2)}`);
                        structuredItemChanges.push({
                            type: 'RATE_CHANGED',
                            name: newItem.productName || 'Item',
                            variant: (newItem.variantInfo || '').trim() || undefined,
                            oldRate: oldPrice,
                            newRate: newPrice,
                            newQty
                        });
                    }
                }
            }

            const oldCustDesc = [originalSale.customerName, originalSale.customerPhone].filter(Boolean).join(' • ') || 'Walk-in Customer';
            const newCustDesc = [normalizedSaleData.customerName, normalizedSaleData.customerPhone].filter(Boolean).join(' • ') || 'Walk-in Customer';
            const customerChanged = (originalSale.customerName || '') !== (normalizedSaleData.customerName || '') ||
                (originalSale.customerPhone || '') !== (normalizedSaleData.customerPhone || '');
            const customerSummary = customerChanged ? ` | Customer: "${oldCustDesc}" -> "${newCustDesc}"` : '';

            const changeSummary = (itemChanges.length > 0 ? ` | ${itemChanges.join('; ')}` : '') + customerSummary;
            const updateTag = `[UPDATE ${new Date().toISOString()}] POS edit: items ${oldItemCount} -> ${newItemCount}, total Rs.${originalSale.grandTotal.toFixed(2)} -> Rs.${normalizedSaleData.grandTotal.toFixed(2)}${changeSummary}`;

            const updatedSale = await tx.sale.update({
                where: { id: saleId },
                data: {
                    customerName: normalizedSaleData.customerName,
                    customerPhone: normalizedSaleData.customerPhone,
                    subtotal: normalizedSaleData.subtotal,
                    discount: normalizedSaleData.discount || 0,
                    discountPercent: normalizedSaleData.discountPercent || 0,
                    taxAmount: normalizedSaleData.taxAmount || 0,
                    cgst: normalizedSaleData.cgst || 0,
                    sgst: normalizedSaleData.sgst || 0,
                    grandTotal: normalizedSaleData.grandTotal,
                    paymentMethod: normalizedSaleData.paymentMethod,
                    paidAmount: normalizedSaleData.paidAmount,
                    changeAmount: normalizedSaleData.changeAmount,
                    remarks: normalizedSaleData.remarks
                        ? `${normalizedSaleData.remarks}\n${updateTag}`
                        : (originalSale.remarks ? `${originalSale.remarks}\n${updateTag}` : updateTag),
                    isSynced: false
                }
            });

            // Auto-register / sync customer to Customer directory table if updated on sale
            const updateCustName = (normalizedSaleData.customerName || '').trim();
            const updateCustPhone = (normalizedSaleData.customerPhone || '').trim() || null;
            const isUpdateWalkIn = !updateCustName || updateCustName.toLowerCase() === 'walk-in customer' || updateCustName.toLowerCase() === 'walk-in';

            if (!isUpdateWalkIn || updateCustPhone) {
                try {
                    if (updateCustPhone) {
                        const existing = await tx.customer.findUnique({
                            where: { phone: updateCustPhone }
                        });
                        if (!existing) {
                            await tx.customer.create({
                                data: {
                                    name: isUpdateWalkIn ? `Customer ${updateCustPhone}` : updateCustName,
                                    phone: updateCustPhone,
                                    isSynced: false
                                }
                            });
                        } else if (!isUpdateWalkIn && existing.name.startsWith('Customer ') && updateCustName !== existing.name) {
                            await tx.customer.update({
                                where: { id: existing.id },
                                data: { name: updateCustName, isSynced: false }
                            });
                        }
                    } else if (!isUpdateWalkIn) {
                        const existing = await tx.customer.findFirst({
                            where: { name: updateCustName }
                        });
                        if (!existing) {
                            await tx.customer.create({
                                data: {
                                    name: updateCustName,
                                    phone: null,
                                    isSynced: false
                                }
                            });
                        }
                    }
                } catch (autoCustErr) {
                    console.warn('Customer auto-registration on update skipped:', autoCustErr);
                }
            }

            // 6. Replace payments
            await tx.invoicePayment.deleteMany({ where: { saleId } });
            await tx.invoicePayment.createMany({
                data: (normalizedSaleData.payments || []).map((p: any) => ({
                    saleId: saleId,
                    paymentMode: p.paymentMode,
                    amount: p.amount
                }))
            });

            // 7. Log Activity (ONLY if actual persisted sale data changed)
            const normalizeSaleItems = (items: any[] = []) =>
                items
                    .map((item: any) => ({
                        variantId: item.variantId,
                        productName: item.productName,
                        variantInfo: item.variantInfo || '',
                        quantity: Number(item.quantity || 0),
                        mrp: Number(item.mrp || 0),
                        sellingPrice: Number(item.sellingPrice || 0),
                        discount: Number(item.discount || 0),
                        taxRate: Number(item.taxRate || 0),
                        taxAmount: Number(item.taxAmount || 0),
                        total: Number(item.total || 0),
                    }))
                    .sort((a: any, b: any) => `${a.variantId}-${a.productName}`.localeCompare(`${b.variantId}-${b.productName}`));

            const normalizePayments = (payments: any[] = []) =>
                payments
                    .map((payment: any) => ({
                        paymentMode: payment.paymentMode,
                        amount: Number(payment.amount || 0),
                    }))
                    .sort((a: any, b: any) => a.paymentMode.localeCompare(b.paymentMode));

            const hasChanges = (
                originalSale.grandTotal !== updatedSale.grandTotal ||
                Number(originalSale.subtotal || 0) !== Number(normalizedSaleData.subtotal || 0) ||
                Number(originalSale.discount || 0) !== Number(normalizedSaleData.discount || 0) ||
                Number(originalSale.taxAmount || 0) !== Number(normalizedSaleData.taxAmount || 0) ||
                originalSale.customerName !== normalizedSaleData.customerName ||
                originalSale.customerPhone !== normalizedSaleData.customerPhone ||
                originalSale.paymentMethod !== normalizedSaleData.paymentMethod ||
                Number(originalSale.paidAmount || 0) !== Number(normalizedSaleData.paidAmount || 0) ||
                Number(originalSale.changeAmount || 0) !== Number(normalizedSaleData.changeAmount || 0) ||
                JSON.stringify(normalizeSaleItems(originalSale.items || [])) !== JSON.stringify(normalizeSaleItems(newItems || [])) ||
                JSON.stringify(normalizePayments(originalSale.payments || [])) !== JSON.stringify(normalizePayments(normalizedSaleData.payments || []))
            );

            let createdAuditLog = null;
            if (hasChanges) {
                const changePayload = {
                    version: 2,
                    type: 'SALE_UPDATE',
                    invoiceNo: String(originalSale.billNo),
                    summary: `Bill #${originalSale.billNo} modified: Total Rs.${originalSale.grandTotal.toFixed(2)} -> Rs.${updatedSale.grandTotal.toFixed(2)}${changeSummary}`,
                    totals: {
                        before: {
                            grandTotal: Number(originalSale.grandTotal || 0),
                            subtotal: Number(originalSale.subtotal || 0),
                            discount: Number(originalSale.discount || 0),
                            discountPercent: Number(originalSale.discountPercent || 0),
                            taxAmount: Number(originalSale.taxAmount || 0),
                            itemCount: oldItemCount,
                            paymentMethod: originalSale.paymentMethod,
                            customerName: originalSale.customerName || undefined,
                            customerPhone: originalSale.customerPhone || undefined
                        },
                        after: {
                            grandTotal: Number(updatedSale.grandTotal || 0),
                            subtotal: Number(normalizedSaleData.subtotal || 0),
                            discount: Number(normalizedSaleData.discount || 0),
                            discountPercent: Number(normalizedSaleData.discountPercent || 0),
                            taxAmount: Number(normalizedSaleData.taxAmount || 0),
                            itemCount: newItemCount,
                            paymentMethod: normalizedSaleData.paymentMethod,
                            customerName: normalizedSaleData.customerName || undefined,
                            customerPhone: normalizedSaleData.customerPhone || undefined
                        }
                    },
                    itemChanges: structuredItemChanges,
                    remarks: updateTag
                };

                createdAuditLog = await tx.auditLog.create({
                    data: {
                        action: 'SALE_UPDATE',
                        details: JSON.stringify(changePayload),
                        userId: userId
                    },
                    include: {
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
            }

            // 8. Return refreshed sale
            return {
                success: true,
                data: await tx.sale.findUnique({
                    where: { id: saleId },
                    include: { items: true, payments: true }
                }),
                auditLog: createdAuditLog
            };
        } catch (error: any) {
            console.error('Update Sale failed:', error);
            throw error; // Roll back any earlier stock/item writes on failure.
        }
      });
    } catch (error: any) {
        console.error('sales:updateSale transaction error:', error);
        return { success: false, error: error.message };
    }

    if (result?.success && result?.data) {
        cloudSync.queueSale(result.data).catch(err => console.error('Queue Error:', err));
        if (result.auditLog) {
            cloudSync.syncAuditLogs([result.auditLog]).catch(err => console.error('Audit Sync Error:', err));
        }
    }
    return result;
});

// Helper to compute actual net paid unit price for an item, accounting for discounts
function getSaleItemNetUnitPrice(saleItem: any, sale: any): number {
    const qty = Number(saleItem?.quantity || 1);
    if (qty <= 0) return 0;

    let lineTotal = Number(saleItem?.total || 0);
    if (lineTotal <= 0) {
        lineTotal = Number(saleItem?.sellingPrice || 0) * qty - Number(saleItem?.discount || 0);
    }

    const allItems = sale?.items || [];
    const sumRawLines = allItems.reduce((sum: number, it: any) => {
        const raw = Number(it.total || 0);
        return sum + (raw > 0 ? raw : (Number(it.sellingPrice || 0) * Number(it.quantity || 1) - Number(it.discount || 0)));
    }, 0);

    const grandTotal = Number(sale?.grandTotal || 0);
    if (grandTotal > 0 && sumRawLines > grandTotal && sumRawLines > 0) {
        const lineNetPaid = lineTotal * (grandTotal / sumRawLines);
        return roundCurrency(lineNetPaid / qty);
    }

    return roundCurrency(lineTotal / qty);
}

// Professional Exchange Handler
createSecureIpcHandler(
    'sales:exchange',
    PermissionMiddleware.editSale,
    async (_event, exchangeData: any, user) => {
        exchangeData = { ...exchangeData, userId: user.id };
        let result: any;
        try {
            result = await prisma.$transaction(async (tx: any) => {
        try {
            const now = new Date();
            const sanitizedNotes = sanitizeString(exchangeData.notes, 500);
            const returnedItems = (exchangeData.items || []).filter((item: any) => item.returnedId && (item.returnedQty || 0) > 0);
            const newItems = (exchangeData.items || []).filter((item: any) => item.newId && (item.newQty || 0) > 0);

            for (const item of exchangeData.items || []) {
                if ((item.returnedId && (!Number.isInteger(item.returnedQty) || item.returnedQty < 0)) ||
                    (item.newId && (!Number.isInteger(item.newQty) || item.newQty < 0))) {
                    throw new Error('Exchange quantities must be non-negative whole numbers.');
                }
            }

            if (returnedItems.length === 0) {
                throw new Error('Exchange requires at least one returned item.');
            }
            if (newItems.length === 0) {
                throw new Error('Exchange requires at least one replacement item. For returns only, please process a Refund.');
            }

            const originalSale = await tx.sale.findUnique({
                where: { id: exchangeData.originalInvoiceId },
                include: {
                    items: true,
                    refunds: { include: { items: true } },
                    exchanges: { include: { items: true } }
                }
            });
            if (!originalSale) {
                throw new Error('Original invoice not found for exchange.');
            }
            if (originalSale.status === 'VOIDED') {
                throw new Error('Voided invoices cannot be exchanged.');
            }

            const originalItemsByVariant = new Map<string, any>(
                (originalSale.items || []).map((item: any) => [item.variantId, item])
            );

            // Exchange credit uses MRP (sellingPrice), not net-paid-after-discount
            const totalReturnedValue = returnedItems.reduce((sum: number, item: any) => {
                if ((item.returnedQty || 0) <= 0) {
                    throw new Error('Returned quantity must be greater than zero.');
                }
                const saleItem = originalItemsByVariant.get(item.returnedId);
                if (!saleItem) {
                    throw new Error(`Returned item not found in original invoice: ${item.returnedId}`);
                }
                const unitMrp = Number(saleItem.sellingPrice || 0);
                return sum + (unitMrp * Number(item.returnedQty || 0));
            }, 0);

            const replacementVariants = newItems.length > 0
                ? await tx.productVariant.findMany({
                    where: { id: { in: newItems.map((i: any) => i.newId) } },
                    include: { product: true }
                })
                : [];

            // ST-02: Reject replacement items that are in preparation state
            const replacementIds = newItems.map((i: any) => i.newId).filter(Boolean);
            if (replacementIds.length > 0 && await checkAnyVariantPreparedSafe(tx, replacementIds)) {
                throw new Error('Stock conversion pending for this item. Cannot be sold until converted.');
            }

            const enrichedReplacementVariants = await enrichCatalogueVariants(tx, replacementVariants, user);
            const replacementVariantById = new Map<string, any>(
                enrichedReplacementVariants.map((variant: any) => [variant.id, variant])
            );

            const totalNewValue = newItems.reduce((sum: number, item: any) => {
                if ((item.newQty || 0) <= 0) {
                    throw new Error('Replacement quantity must be greater than zero.');
                }
                const variant = replacementVariantById.get(item.newId);
                if (!variant) {
                    throw new Error(`Replacement item not found: ${item.newId}`);
                }
                return sum + (Number(variant.sellingPrice || 0) * Number(item.newQty || 0));
            }, 0);

            // Apply bill-level discount from the exchange modal
            const exchangeItemDiscount = roundCurrency(Math.max(0, Number(exchangeData.discount || 0)));
            const discountedNewValue = roundCurrency(totalNewValue - exchangeItemDiscount);

            // Cap exchange credit to the discounted new bill subtotal (no cash refunds in exchange)
            const exchangeCreditApplied = Math.min(totalReturnedValue, discountedNewValue);
            const netPayable = roundCurrency(Math.max(0, discountedNewValue - exchangeCreditApplied));
            const normalizedDifferenceAmount = roundCurrency(discountedNewValue - totalReturnedValue);
            // Store credit: if returned value > discounted new value, the excess becomes a credit note
            const storeCreditBalance = roundCurrency(Math.max(0, totalReturnedValue - discountedNewValue));
            const exchangePayments = (exchangeData.payments || [])
                .filter((payment: any) => Number(payment.amount || 0) > 0)
                .map((payment: any) => ({
                    paymentMode: payment.paymentMode,
                    amount: roundCurrency(payment.amount)
                }));
            const exchangePaymentsTotal = roundCurrency(
                exchangePayments.reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0)
            );

            if (exchangePayments.some((payment: any) => !payment.paymentMode)) {
                throw new Error('Exchange payments must include a payment mode.');
            }
            if (exchangePaymentsTotal !== netPayable) {
                throw new Error('Exchange payment total does not match the payable amount.');
            }

            // 2. IMMUTABLE BILL: Validate returned quantities but DO NOT modify original sale items or totals
            validateReturnQuantities(originalSale, returnedItems.map((item: any) => ({ id: item.returnedId, qty: item.returnedQty })));
            for (const item of returnedItems) {
                const saleItem = originalSale.items.find((si: any) => si.variantId === item.returnedId);
                if (!saleItem) {
                    throw new Error(`Returned item not found in original invoice: ${item.returnedId}`);
                }
                const refundedQty = (originalSale.refunds || []).reduce((sum: number, refund: any) => {
                    const refundItem = (refund.items || []).find((ri: any) => ri.variantId === item.returnedId);
                    return sum + (refundItem?.quantity || 0);
                }, 0);
                // Also count quantities already returned via previous exchanges
                const previouslyExchangedQty = (originalSale.exchanges || []).reduce((sum: number, ex: any) => {
                    return sum + (ex.items || [])
                        .filter((ei: any) => ei.returnedItemId === item.returnedId)
                        .reduce((s: number, ei: any) => s + (ei.returnedQty || 0), 0);
                }, 0);
                const availableQty = Math.max(0, saleItem.quantity - refundedQty - previouslyExchangedQty);
                if (availableQty < item.returnedQty) {
                    throw new Error(`Returned qty exceeds available qty for ${saleItem.productName}`);
                }
                // Original SaleItem rows are NOT modified — bill remains immutable
            }

            const returnStockRoutes = await resolveReturnStockRoutes(tx, returnedItems.map((item: any) => ({
                sourceVariantId: item.returnedId, quantity: item.returnedQty, choice: item.stockChoice,
            })), user);
            await assertTrackedStockAvailable(tx, [
                ...newItems.map((item: any) => ({ variantId: item.newId, quantity: item.newQty })),
                ...Array.from(returnStockRoutes.values()).filter(route => route.targetVariantId).map(route => ({
                    variantId: route.targetVariantId!, quantity: -route.quantity,
                })),
            ]);

            // 3. Create Exchange Entry
            const exchange = await tx.exchange.create({
                data: {
                    originalInvoiceId: exchangeData.originalInvoiceId,
                    exchangeDate: now,
                    differenceAmount: normalizedDifferenceAmount,
                    notes: sanitizedNotes,
                    createdBy: exchangeData.userId,
                    items: {
                        create: exchangeData.items.map((item: any) => ({
                            returnedItemId: item.returnedId,
                            returnedQty: item.returnedQty,
                            newItemId: item.newId,
                            newQty: item.newQty,
                            priceDiff: item.priceDiff
                        }))
                    },
                    payments: {
                        create: exchangePayments
                    }
                }
            });

            // 4. Create replacement sale on exchange date
            const replacementPaymentMethod = ['CASH', 'CARD', 'UPI', 'SPLIT'].includes(exchangeData.replacementPaymentMethod)
                ? exchangeData.replacementPaymentMethod
                : (['CASH', 'CARD', 'UPI', 'SPLIT'].includes(originalSale.paymentMethod) ? originalSale.paymentMethod : 'CASH');

            let replacementSale: any = null;
            if (newItems.length > 0) {
                const nextBillNo = await getNextBillNoForDate(new Date(), tx);

                const replacementSaleItems = newItems.map((item: any) => {
                    const variant = replacementVariantById.get(item.newId);
                    const taxRate = variant?.product?.taxRate || 0;
                    const lineBase = (item.newQty || 0) * (variant?.sellingPrice || 0);
                    const lineTax = taxRate > 0 ? (lineBase * taxRate) / (100 + taxRate) : 0;

                    return {
                        variantId: item.newId,
                        productName: formatVariantDescription(variant?.product?.name || 'Unknown Item', variant),
                        variantInfo: '',
                        quantity: item.newQty || 0,
                        mrp: variant?.mrp || variant?.sellingPrice || 0,
                        sellingPrice: variant?.sellingPrice || 0,
                        discount: 0,
                        taxRate,
                        taxAmount: lineTax,
                        total: lineBase
                    };
                });

                const subtotal = replacementSaleItems.reduce((sum: number, line: any) => sum + (line.sellingPrice * line.quantity), 0);
                const grossTotal = replacementSaleItems.reduce((sum: number, line: any) => sum + line.total, 0);
                // Apply discount: grandTotal = gross - discount, then recalculate tax on discounted amount
                const discountedGrandTotal = roundCurrency(grossTotal - exchangeItemDiscount);
                // Recalculate GST on the discounted grand total (GST-inclusive back-calculation)
                const GST_INCLUSIVE_FACTOR = 1.05;
                const discountedTaxable = roundCurrency(discountedGrandTotal / GST_INCLUSIVE_FACTOR);
                const discountedTaxAmount = roundCurrency(discountedGrandTotal - discountedTaxable);

                const replacementSalePayments = [
                    ...(exchangeCreditApplied > 0 ? [{
                        paymentMode: 'EXCHANGE_CREDIT',
                        amount: roundCurrency(exchangeCreditApplied)
                    }] : []),
                    ...exchangePayments
                ];

                const discountNote = exchangeItemDiscount > 0 ? `, Discount: Rs.${exchangeItemDiscount.toFixed(2)}` : '';
                replacementSale = await tx.sale.create({
                    data: {
                        billNo: nextBillNo,
                        userId: exchangeData.userId,
                        customerName: originalSale.customerName,
                        customerPhone: originalSale.customerPhone,
                        subtotal,
                        discount: exchangeItemDiscount,
                        discountPercent: subtotal > 0 ? roundCurrency((exchangeItemDiscount / subtotal) * 100) : 0,
                        taxAmount: discountedTaxAmount,
                        cgst: roundCurrency(discountedTaxAmount / 2),
                        sgst: roundCurrency(discountedTaxAmount / 2),
                        grandTotal: discountedGrandTotal,
                        paymentMethod: netPayable > 0 ? replacementPaymentMethod : 'EXCHANGE',
                        paidAmount: netPayable, // Only the fresh money collected today
                        changeAmount: 0,
                        remarks: `Replacement sale for Invoice #${originalSale.billNo}. Exchange Ref: ${exchange.id}. New: Rs.${grossTotal.toFixed(2)}${discountNote}, Credit: Rs.${exchangeCreditApplied.toFixed(2)}, Payable: Rs.${netPayable.toFixed(2)}${storeCreditBalance > 0 ? `. STORE CREDIT NOTE: Rs.${storeCreditBalance.toFixed(2)} issued to customer for future use.` : ''}`,
                        createdAt: now,
                        items: {
                            create: replacementSaleItems
                        },
                        payments: {
                            create: replacementSalePayments
                        }
                    }
                });
            }

            // Save the agreed exchange values in the same transaction as both stock legs.
            // Surplus credit is a customer obligation, never extra sale revenue.
            await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ExchangeRevenue (
                exchangeId TEXT PRIMARY KEY REFERENCES Exchange(id),originalSaleId TEXT NOT NULL,
                replacementSaleId TEXT NOT NULL UNIQUE,returnedCreditPaise INTEGER NOT NULL,
                replacementValuePaise INTEGER NOT NULL,appliedCreditPaise INTEGER NOT NULL,
                surplusCreditPaise INTEGER NOT NULL,freshPaymentPaise INTEGER NOT NULL,createdAt TEXT NOT NULL)`);
            await tx.$executeRawUnsafe('INSERT INTO ExchangeRevenue VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                exchange.id,originalSale.id,replacementSale.id,Math.round(totalReturnedValue*100),
                Math.round(discountedNewValue*100),Math.round(exchangeCreditApplied*100),
                Math.round(storeCreditBalance*100),Math.round(netPayable*100),now.toISOString());

            // 5. Flag original invoice with clear exchange note
            const returnedSummary = returnedItems
                .map((item: any) => {
                    const saleItem = originalSale.items.find((si: any) => si.variantId === item.returnedId);
                    return `${saleItem?.productName || 'Item'} x${item.returnedQty || 0}`;
                })
                .join(', ');

            const replacementSummary = replacementSale
                ? `Replacement Bill #${replacementSale.billNo}`
                : 'No replacement bill';

            const storeCreditNote = storeCreditBalance > 0 ? ` STORE CREDIT: Rs.${storeCreditBalance.toFixed(2)} balance issued to customer.` : '';
            const replacementTag = `[EXCHANGE ${now.toISOString()}] Returned: ${returnedSummary || 'N/A'}. ${replacementSummary}. Ref: ${exchange.id}${storeCreditNote}`;
            // IMMUTABLE BILL: Only append exchange note to remarks — DO NOT modify financial fields
            await tx.sale.update({
                where: { id: originalSale.id },
                data: {
                    remarks: originalSale.remarks ? `${originalSale.remarks}\n${replacementTag}` : replacementTag
                }
            });

            const exchangeCostVariants=[...returnStockRoutes.values()].map(route=>route.targetVariantId).filter(Boolean) as string[];
            const exchangeCostQuantities=new Map<string,number>();
            for(const item of newItems)exchangeCostQuantities.set(item.newId,(exchangeCostQuantities.get(item.newId)||0)+item.newQty);
            await prepareStockCosts(tx,[...exchangeCostVariants,...exchangeCostQuantities.keys()]);
            await restoreSaleCosts(tx,originalSale,returnStockRoutes,exchange.id,'EXCHANGE',true);
            if(replacementSale)await syncSaleCosts(tx,replacementSale.id,exchangeCostQuantities,new Map(),true);
            // 6. Adjust Stock for each exchange item
            for (const item of exchangeData.items) {
                // Returned Item -> Increase Stock
                const returnRoute = returnStockRoutes.get(item.returnedId);
                if (returnRoute?.targetVariantId) {
                    await tx.productVariant.update({
                        where: { id: returnRoute.targetVariantId },
                        data: { stock: { increment: returnRoute.quantity }, isSynced: false }
                    });
                    await tx.inventoryMovement.create({
                        data: {
                            variantId: returnRoute.targetVariantId,
                            type: 'EXCHANGE_RETURN',
                            quantity: returnRoute.quantity,
                            reason: 'Exchange Return',
                            reference: exchange.id,
                            createdBy: exchangeData.userId,
                            createdAt: now
                        }
                    });
                }

                // New Item -> Decrease Stock
                if (item.newId) {
                    await tx.productVariant.update({
                        where: { id: item.newId },
                        data: { stock: { decrement: item.newQty || 0 }, isSynced: false }
                    });
                    await tx.inventoryMovement.create({
                        data: {
                            variantId: item.newId,
                            type: 'EXCHANGE_OUT',
                            quantity: -(item.newQty || 0),
                            reason: 'Exchange Issue',
                            reference: exchange.id,
                            createdBy: exchangeData.userId,
                            createdAt: now
                        }
                    });
                }
            }
            await recordReturnStockRoutes(tx, returnStockRoutes, exchange.id, 'EXCHANGE', user, now);

            // 7. Log Activity
            const structuredReturnedItems = returnedItems.map((item: any) => {
                const saleItem = originalSale.items.find((si: any) => si.variantId === item.returnedId);
                const unitPrice = saleItem ? Number(saleItem.sellingPrice || saleItem.mrp || 0) : 0;
                const total = roundCurrency(unitPrice * (item.returnedQty || 1));
                return {
                    name: saleItem?.productName || 'Item',
                    variant: saleItem?.variantInfo || '',
                    qty: item.returnedQty || 1,
                    rate: roundCurrency(unitPrice),
                    total,
                    amount: total
                };
            });

            const structuredReplacementItems = newItems.map((item: any) => {
                const variant = replacementVariantById.get(item.newId);
                const rate = variant?.sellingPrice || 0;
                const total = roundCurrency(rate * (item.newQty || 1));
                return {
                    name: variant?.product?.name || 'Item',
                    variant: `${variant?.size || ''} ${variant?.color || ''}`.trim(),
                    qty: item.newQty || 1,
                    rate: roundCurrency(rate),
                    total,
                    amount: total
                };
            });

            const diffDisplay = normalizedDifferenceAmount > 0
                ? `+₹${normalizedDifferenceAmount.toFixed(2)} (Paid by Customer)`
                : normalizedDifferenceAmount < 0
                ? `-₹${Math.abs(normalizedDifferenceAmount).toFixed(2)} (Refunded)`
                : '₹0.00 (Equal Value)';

            const exchangeSummary = `Exchange processed: Returned ${structuredReturnedItems.map((i: any) => `${i.name} x${i.qty}`).join(', ')} (₹${totalReturnedValue.toFixed(2)}) from Bill #${originalSale.billNo} for ${structuredReplacementItems.map((i: any) => `${i.name} x${i.qty}`).join(', ')} (₹${totalNewValue.toFixed(2)})${replacementSale ? ` on Bill #${replacementSale.billNo}` : ''}. Diff: ${diffDisplay}`;

            const exchangeAuditPayload = {
                version: 2,
                type: 'EXCHANGE',
                originalBillNo: originalSale.billNo,
                originalInvoiceId: originalSale.id,
                replacementBillNo: replacementSale?.billNo,
                replacementSaleId: replacementSale?.id,
                returnedItems: structuredReturnedItems,
                replacementItems: structuredReplacementItems,
                returnedTotal: roundCurrency(totalReturnedValue),
                replacementTotal: roundCurrency(totalNewValue),
                differenceAmount: normalizedDifferenceAmount,
                netPayable,
                exchangeCreditApplied,
                storeCreditBalance,
                paymentMethod: netPayable > 0 ? replacementPaymentMethod : 'EXCHANGE',
                customerName: originalSale.customerName,
                summary: exchangeSummary
            };

            await tx.auditLog.create({
                data: {
                    action: 'EXCHANGE',
                    details: JSON.stringify(exchangeAuditPayload),
                    userId: exchangeData.userId,
                    createdAt: now
                }
            });

            const fullExchange = await tx.exchange.findUnique({
                where: { id: exchange.id },
                include: { items: true, payments: true }
            });
            const fullReplacementSale = replacementSale ? await tx.sale.findUnique({
                where: { id: replacementSale.id },
                include: { items: true, payments: true }
            }) : null;

            return {
                success: true,
                data: {
                    exchange: fullExchange,
                    replacementSale: fullReplacementSale,
                    replacementSaleId: replacementSale?.id || null
                }
            };
        } catch (error: any) {
            console.error('Exchange failed:', error);
            throw error;
        }
            });
        } catch (error: any) {
            console.error('sales:exchange transaction error:', error);
            return { success: false, error: error.message };
        }

        if (result?.success && result?.data) {
            if (result.data.replacementSale) {
                cloudSync.queueSale(result.data.replacementSale).catch(err => console.error('Queue replacement sale error:', err));
            }
            if (result.data.exchange) {
                cloudSync.queueExchange(result.data.exchange).catch(err => console.error('Queue exchange error:', err));
            }
        }
        return result;
    },
    {
        trustedSession: true,
        extractUserId: (args: any) => args.userId
    }
);

// Retrieve structured Exchange/Refund details for any sale (original or replacement)
ipcMain.handle('sales:getExchangeDetails', async (_event, args: { billNo?: string; saleId?: string; remarks?: string; isOriginal?: boolean; isReplacement?: boolean }) => {
    try {
        const { billNo, saleId, remarks, isOriginal, isReplacement } = args || {};
        const strBillNo = billNo ? String(billNo) : '';

        // 1. Search AuditLog for structured EXCHANGE events
        const exchangeLogs = await prisma.auditLog.findMany({
            where: { action: 'EXCHANGE' },
            include: {
                user: {
                    select: { id: true, name: true, role: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });

        let outgoingLogData: any = null;
        let incomingLogData: any = null;

        for (const log of exchangeLogs) {
            try {
                const parsed = JSON.parse(log.details);
                const logOrigBill = String(parsed.originalBillNo || '');
                const logReplBill = String(parsed.replacementBillNo || '');
                const logOrigId = String(parsed.originalInvoiceId || '');
                const logReplId = String(parsed.replacementSaleId || '');

                const matchesOrig = (saleId && logOrigId === saleId) || (strBillNo && logOrigBill === strBillNo);
                const matchesRepl = (saleId && logReplId === saleId) || (strBillNo && logReplBill === strBillNo);

                const formatData = () => ({
                    type: 'EXCHANGE',
                    originalBillNo: logOrigBill,
                    originalInvoiceId: logOrigId,
                    replacementBillNo: logReplBill,
                    replacementSaleId: logReplId,
                    returnedItems: parsed.returnedItems || [],
                    replacementItems: parsed.replacementItems || [],
                    returnedTotal: Number(parsed.returnedTotal || 0),
                    replacementTotal: Number(parsed.replacementTotal || 0),
                    differenceAmount: Number(parsed.differenceAmount ?? 0),
                    netPayable: Number(parsed.netPayable ?? 0),
                    exchangeCreditApplied: Number(parsed.exchangeCreditApplied ?? 0),
                    paymentMethod: parsed.paymentMethod,
                    summary: parsed.summary,
                    createdAt: log.createdAt,
                    actor: log.user?.name || 'Staff'
                });

                if (matchesOrig && !outgoingLogData) {
                    outgoingLogData = formatData();
                }
                if (matchesRepl && !incomingLogData) {
                    incomingLogData = formatData();
                }

                if (outgoingLogData && incomingLogData) {
                    break;
                }
            } catch {
                // skip non-json
            }
        }

        // Return appropriate exchange data based on the sale's context
        if (outgoingLogData || incomingLogData) {
            // If the sale had items exchanged out (it is the original for an exchange):
            if (outgoingLogData && (!isReplacement || isOriginal || !incomingLogData)) {
                return {
                    success: true,
                    data: {
                        ...outgoingLogData,
                        incomingExchange: incomingLogData ? {
                            originalBillNo: incomingLogData.originalBillNo,
                            replacementBillNo: incomingLogData.replacementBillNo,
                            returnedTotal: incomingLogData.returnedTotal,
                            replacementTotal: incomingLogData.replacementTotal
                        } : undefined
                    }
                };
            }

            // If it's a replacement bill (created from an exchange):
            if (incomingLogData) {
                return {
                    success: true,
                    data: {
                        ...incomingLogData,
                        outgoingExchange: outgoingLogData ? {
                            originalBillNo: outgoingLogData.originalBillNo,
                            replacementBillNo: outgoingLogData.replacementBillNo,
                            returnedTotal: outgoingLogData.returnedTotal,
                            replacementTotal: outgoingLogData.replacementTotal
                        } : undefined
                    }
                };
            }

            if (outgoingLogData) {
                return { success: true, data: outgoingLogData };
            }
        }

        // 2. Fallback to querying the Exchange database table
        let exchange = null;
        if (saleId) {
            exchange = await prisma.exchange.findFirst({
                where: { originalInvoiceId: saleId },
                include: {
                    items: true,
                    payments: true,
                    invoice: { include: { items: true } }
                },
                orderBy: { exchangeDate: 'desc' }
            });
        }
        if (!exchange && remarks) {
            const refMatches = Array.from(remarks.matchAll(/(?:Exchange Ref:|Ref:)\s*([a-zA-Z0-9-]+)/gi));
            for (const match of refMatches) {
                const found = await prisma.exchange.findUnique({
                    where: { id: match[1].trim() },
                    include: {
                        items: true,
                        payments: true,
                        invoice: { include: { items: true } }
                    }
                });
                if (found) {
                    exchange = found;
                    break;
                }
            }
        }

        if (exchange) {
            const variantIds = Array.from(new Set(
                (exchange.items || []).flatMap((i: any) => [i.returnedItemId, i.newItemId].filter(Boolean))
            ));
            const variants = await prisma.productVariant.findMany({
                where: { id: { in: variantIds } },
                include: { product: true }
            });
            const variantMap = new Map<string, any>(variants.map((v: any) => [v.id, v]));

            const returnedItems = (exchange.items || [])
                .filter((i: any) => i.returnedItemId && i.returnedQty > 0)
                .map((i: any) => {
                    const v = variantMap.get(i.returnedItemId);
                    return {
                        name: v?.product?.name || 'Returned Item',
                        variant: `${v?.size || ''} ${v?.color || ''}`.trim(),
                        qty: i.returnedQty,
                        amount: Math.abs(i.priceDiff)
                    };
                });

            const replacementItems = (exchange.items || [])
                .filter((i: any) => i.newItemId && i.newQty > 0)
                .map((i: any) => {
                    const v = variantMap.get(i.newItemId);
                    return {
                        name: v?.product?.name || 'New Item',
                        variant: `${v?.size || ''} ${v?.color || ''}`.trim(),
                        qty: i.newQty,
                        amount: i.priceDiff
                    };
                });

            const returnedTotal = returnedItems.reduce((s: number, i: any) => s + (i.amount || 0), 0);
            const replacementTotal = replacementItems.reduce((s: number, i: any) => s + (i.amount || 0), 0);
            const replBillMatch = remarks?.match(/Replacement Bill #(\d+)/);

            return {
                success: true,
                data: {
                    type: 'EXCHANGE',
                    originalBillNo: exchange.invoice?.billNo || strBillNo,
                    replacementBillNo: replBillMatch ? replBillMatch[1] : '',
                    returnedItems,
                    replacementItems,
                    returnedTotal,
                    replacementTotal,
                    differenceAmount: exchange.differenceAmount,
                    summary: `Exchange on Bill #${exchange.invoice?.billNo || strBillNo}`,
                    createdAt: exchange.exchangeDate
                }
            };
        }

        return { success: false, error: 'No exchange details found' };
    } catch (error: any) {
        console.error('sales:getExchangeDetails error:', error);
        return { success: false, error: error.message };
    }
});

// Professional Refund Handler
createSecureIpcHandler(
    'sales:refund',
    PermissionMiddleware.editSale,
    async (_event, refundData: any, user) => {
        refundData = { ...refundData, userId: user.id };
        let result: any;
        try {
            if (typeof refundData.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(refundData.requestId)) {
                throw new Error('A refund request ID is required. Reopen the refund window.');
            }
            result = await prisma.$transaction(async (tx: any) => {
        try {
            const auditId = `refund-request-${refundData.requestId}`;
            const previousRequest = await tx.auditLog.findUnique({ where: { id: auditId } });
            if (previousRequest) {
                const details = JSON.parse(previousRequest.details);
                if (previousRequest.userId !== user.id || details.originalInvoiceId !== refundData.originalInvoiceId) {
                    throw new Error('Refund request does not match the original operation.');
                }
                const previousRefund = await tx.refund.findUnique({ where: { id: details.refundId }, include: { items: true, payments: true } });
                if (!previousRefund) throw new Error('Previous refund record requires review.');
                return { success: true, data: previousRefund };
            }
            const now = new Date();
            const sanitizedReason = sanitizeString(refundData.reason, 500);
            const originalSale = await tx.sale.findUnique({
                where: { id: refundData.originalInvoiceId },
                include: {
                    items: true,
                    refunds: { include: { items: true } },
                    exchanges: { include: { items: true } },
                    payments: true
                }
            });
            if (!originalSale) {
                throw new Error('Original invoice not found for refund.');
            }
            if (originalSale.status === 'VOIDED') {
                throw new Error('Voided invoices cannot be refunded.');
            }
            if (!sanitizedReason) {
                throw new Error('Reason is mandatory for refunds.');
            }
            if (!Array.isArray(refundData.items) || refundData.items.length === 0) {
                throw new Error('Select at least one item to refund.');
            }

            const refundQuote = quoteRefund(originalSale, refundData.items.map((item: any) => ({ id: item.id, qty: item.qty })), refundData.originalDiscount);
            if (refundQuote.requiresDiscount) throw new Error('Confirm the original discount for the returned items.');
            const normalizedRefundItems = refundQuote.items;
            const computedRefundAmount = refundQuote.total;
            if (typeof refundData.totalAmount !== 'number' || toPaise(refundData.totalAmount) !== toPaise(computedRefundAmount)) {
                throw new Error('Refund amount has changed. Reopen the bill and review the refund.');
            }
            for (const item of normalizedRefundItems) {
                const supplied = refundData.items.find((entry: any) => entry.id === item.id);
                if (typeof supplied?.amount !== 'number' || toPaise(supplied.amount) !== toPaise(item.amount)) {
                    throw new Error('Refund item amounts do not match the confirmed discount.');
                }
            }
            const refundPayments = refundData.payments;
            validateRefundPayments(refundPayments, computedRefundAmount);
            const stockRoutes = await resolveReturnStockRoutes(tx, normalizedRefundItems.map((item: any) => ({
                sourceVariantId: item.id, quantity: item.qty,
                choice: refundData.items.find((entry: any) => entry.id === item.id)?.stockChoice,
            })), user);

            // 1. Create Refund Record
            const refund = await tx.refund.create({
                data: {
                    originalInvoiceId: refundData.originalInvoiceId,
                    refundDate: now,
                    totalRefundAmount: computedRefundAmount,
                    reason: sanitizedReason,
                    createdBy: user.id,
                    items: {
                        create: normalizedRefundItems.map((item: any) => ({
                            variantId: item.id,
                            quantity: item.qty,
                            amount: item.amount
                        }))
                    },
                    payments: {
                        create: refundPayments
                    }
                },
                include: {
                    items: true,
                    payments: true
                }
            });

            await restoreSaleCosts(tx,originalSale,stockRoutes,refund.id,'REFUND');
            // 2. Adjust Stock
            for (const item of normalizedRefundItems) {
                const targetVariantId = stockRoutes.get(item.id)!.targetVariantId;
                if (!targetVariantId) continue; // Held returns are recorded, never added to saleable stock.
                await tx.productVariant.update({
                    where: { id: targetVariantId },
                    data: { stock: { increment: item.qty }, isSynced: false }
                });
                await tx.inventoryMovement.create({
                    data: {
                        variantId: targetVariantId,
                        type: 'REFUND',
                        quantity: item.qty,
                        reason: `Refund: ${sanitizedReason}`,
                        reference: refund.id,
                        createdBy: user.id,
                        createdAt: now
                    }
                });
            }
            await recordReturnStockRoutes(tx, stockRoutes, refund.id, 'REFUND', user, now);

            // 3. Log Activity
            const structuredRefundItems = normalizedRefundItems.map((item: any) => {
                const saleItem = originalSale.items.find((si: any) => si.variantId === item.id);
                return {
                    name: saleItem?.productName || 'Item',
                    variant: saleItem?.variantInfo || '',
                    qty: item.qty || 1,
                    amount: item.amount || 0,
                    originalDiscount: item.originalDiscount
                };
            });

            const refundSummary = `Refund of ₹${computedRefundAmount.toFixed(2)} processed for Bill #${originalSale.billNo}: ${structuredRefundItems.map((i: any) => `${i.name} x${i.qty}`).join(', ')}. Reason: ${sanitizedReason || 'N/A'}`;

            const refundAuditPayload = {
                version: 2,
                type: 'REFUND',
                billNo: originalSale.billNo,
                originalInvoiceId: originalSale.id,
                refundAmount: computedRefundAmount,
                refundId: refund.id,
                returnedGross: refundQuote.gross,
                originalDiscount: refundQuote.discount,
                discountSource: refundQuote.automatic ? 'REMAINING_PAYMENT' : 'STAFF_CONFIRMED',
                reason: sanitizedReason,
                refundPayments,
                refundedItems: structuredRefundItems,
                stockRoutes: [...stockRoutes.values()],
                customerName: originalSale.customerName,
                summary: refundSummary
            };

            await tx.auditLog.create({
                data: {
                    action: 'REFUND',
                    id: auditId,
                    details: JSON.stringify(refundAuditPayload),
                    userId: user.id,
                    createdAt: now
                }
            });

            return { success: true, data: refund };
        } catch (error: any) {
            console.error('Refund failed:', error);
            throw error;
        }
            });
        } catch (error: any) {
            console.error('sales:refund transaction error:', error);
            return { success: false, error: error.message };
        }

        if (result?.success && result?.data) {
            cloudSync.queueRefund(result.data).catch(err => console.error('Queue refund error:', err));
        }
        return result;
    },
    {
        trustedSession: true,
        extractUserId: (args: any) => args.userId
    }
);

// Void Sale — sets status VOIDED and returns stock to inventory (SECURE VERSION)
createSecureIpcHandler(
    'sales:voidSale',
    PermissionMiddleware.voidSale,
    async (_event, args: { saleId: string; reason: string; userId: string }, user) => {
        const { saleId, reason, userId } = args;
        const result = await prisma.$transaction(async (tx: any) => {
            const sale = await tx.sale.findUnique({
                where: { id: saleId },
                include: {
                    items: true,
                    exchanges: { select: { id: true } },
                    refunds: { select: { id: true } }
                }
            });

            if (!sale) return { success: false, error: 'Sale not found' };
            if (sale.status === 'VOIDED') return { success: false, error: 'Sale is already voided' };
            if ((sale.exchanges?.length || 0) > 0 || (sale.refunds?.length || 0) > 0) {
                return { success: false, error: 'Refunded or exchanged sales cannot be voided' };
            }

            const voidCostQuantities=new Map<string,number>();
            for(const item of sale.items)voidCostQuantities.set(item.variantId,(voidCostQuantities.get(item.variantId)||0)+item.quantity);
            await syncSaleCosts(tx,saleId,new Map(),voidCostQuantities);
            // Return stock for every item in the sale
            for (const item of sale.items) {
                await tx.productVariant.update({
                    where: { id: item.variantId },
                    data: { stock: { increment: item.quantity }, isSynced: false }
                });
                await tx.inventoryMovement.create({
                    data: {
                        variantId: item.variantId,
                        type: 'IN',
                        quantity: item.quantity,
                        reason: `Void Sale #${sale.billNo}: ${reason || 'No reason given'}`,
                        reference: saleId,
                        createdBy: userId
                    }
                });
            }

            const voidTag = `[VOID ${new Date().toISOString()}] ${reason || 'No reason given'}`;
            const updatedSale = await tx.sale.update({
                where: { id: saleId },
                data: {
                    status: 'VOIDED',
                    remarks: sale.remarks ? `${sale.remarks}\n${voidTag}` : voidTag,
                    isSynced: false
                },
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

            const createdAuditLog = await tx.auditLog.create({
                data: {
                    action: 'SALE_VOID',
                    details: `Sale #${sale.billNo} voided by ${user.role} user. Reason: ${reason || 'N/A'}. Stock for ${sale.items.length} item(s) returned to inventory.`,
                    userId
                },
                include: {
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

            logger.info('Sales', `Sale #${sale.billNo} voided by user ${userId} (${user.role})`);
            return { success: true, data: updatedSale, auditLog: createdAuditLog };
        });

        if (result?.success && result?.data) {
            cloudSync.queueSale(result.data).catch(err => console.error('Queue Error:', err));
            if (result.auditLog) {
                cloudSync.syncAuditLogs([result.auditLog]).catch(err => console.error('Audit Sync Error:', err));
            }
        }
        return result;
    }
);

// Print handlers

ipcMain.handle('print:receipt', async (_event, data) => sendReceipt(BrowserWindow, data));

ipcMain.handle('print:listPrinters', async () => {
    try {
        const contents = BrowserWindow.getAllWindows().find(win => !win.isDestroyed())?.webContents;
        if (!contents) throw new Error('Printer discovery is unavailable. Restart the app.');
        const printers = await contents.getPrintersAsync();
        return { success: true, data: printers.map(p => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault, status: p.status })) };
    } catch (error: any) { return { success: false, error: error.message }; }
});

ipcMain.handle('print:label', async (event, data) => {
    try {
        const user = await resolveElectronSessionUser(prisma, event);
        const permission = PermissionService.checkPermission(user, 'permPrintSticker');
        if (!permission.allowed) throw new Error(permission.reason || 'Sticker printing is not permitted.');
        if (data?.variantId) {
            const variant = await prisma.productVariant.findUnique({ where: { id: data.variantId }, include: { product: true } });
            if (!variant || !data.productId || variant.productId !== data.productId
                || (data.barcode !== undefined && variant.barcode !== data.barcode)
                || !data.expectedUpdatedAt || new Date(data.expectedUpdatedAt).getTime() !== new Date(variant.product.updatedAt).getTime()) {
                throw new Error('Save and reload the variant before printing its labels.');
            }
        }
        const printWindow = new BrowserWindow({ show: false });
        const htmlContent = data.html || data;
        const printOptions = data?.options || {};
        const pageWidthMicrons = printOptions.pageWidthMm ? Math.round(Number(printOptions.pageWidthMm) * 1000) : undefined;
        const pageHeightMicrons = printOptions.pageHeightMm ? Math.round(Number(printOptions.pageHeightMm) * 1000) : undefined;
        const customPageSize = (pageWidthMicrons && pageHeightMicrons) ? { width: pageWidthMicrons, height: pageHeightMicrons } : undefined;
        const deviceName = typeof printOptions.deviceName === 'string' && printOptions.deviceName.trim().length > 0
            ? printOptions.deviceName.trim()
            : undefined;

        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent.trim())}`);
        await new Promise((r) => setTimeout(r, 600)); // allow barcode script/layout to settle

        return new Promise((resolve) => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                try { printWindow.close(); } catch { }
                resolve({ success: false, error: 'Label print timeout: printer did not respond in time.' });
            }, 6000);

            const options: any = {
                silent: true,
                printBackground: true,
                landscape: false,
                margins: { marginType: 'none' },
                deviceName
            };
            if (customPageSize) options.pageSize = customPageSize as any;

            console.log('[Label Print] Single attempt. Device:', deviceName || '(default)', 'PageSize:', customPageSize ? 'custom' : 'driver-default');
            printWindow.webContents.print(options, (success, failureReason) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                try { printWindow.close(); } catch { }

                if (!success) {
                    console.log('[Label Print] FAIL:', failureReason || '');
                    resolve({ success: false, error: failureReason || 'Label print failed.' });
                    return;
                }

                console.log('[Label Print] SUCCESS');
                resolve({ success: true });
            });
        });
    } catch (error: any) {
        console.error('Print:Label Error:', error);
        return { success: false, error: error.message };
    }
});

// Global error handling was moved to the top

ipcMain.handle('devices:list', async () => {
    try {
        // Will be implemented with usb-detection
        return { success: true, data: [] };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('app:quit', async () => {
    try {
        await prisma.$disconnect();
    } catch (e) {
        // ignore
    }
    app.quit();
    return { success: true };
});

ipcMain.handle('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
    return { success: true };
});

ipcMain.handle('window:toggleMaximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return { success: false, isMaximized: false };

    if (window.isMaximized()) {
        window.unmaximize();
    } else {
        window.maximize();
    }

    return { success: true, isMaximized: window.isMaximized() };
});

ipcMain.handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
    return { success: true };
});

ipcMain.handle('window:getState', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return {
        success: true,
        isMaximized: window?.isMaximized() ?? false,
    };
});

// Product Import/Export Handlers
ipcMain.handle('products:importTemplate', async () => {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog({
            title: 'Save Import Template',
            defaultPath: 'zain_pos_import_template.xlsx',
            filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
        });

        if (canceled || !filePath) return { success: false };

        const workbook = XLSX.utils.book_new();

        // 1. Products Template
        const pHeaders = [
            'Product Name', 'Barcode', 'Category', 'Size', 'Color',
            'MRP', 'Selling Price', 'Purchase Price', 'Stock', 'HSN Code', 'GST %'
        ];
        const pSheet = XLSX.utils.aoa_to_sheet([pHeaders]);
        XLSX.utils.book_append_sheet(workbook, pSheet, 'Products');

        // 2. Customers Template
        const cHeaders = [
            'Customer Name', 'Phone', 'Email', 'Address', 'GSTIN'
        ];
        const cSheet = XLSX.utils.aoa_to_sheet([cHeaders]);
        XLSX.utils.book_append_sheet(workbook, cSheet, 'Customers');

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        fs.writeFileSync(filePath, buffer);

        return { success: true, path: filePath };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('data:exportAll', async () => {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog({
            title: 'Export All Data',
            defaultPath: `zain_pos_data_${new Date().toISOString().slice(0, 10)}.xlsx`,
            filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
        });

        if (canceled || !filePath) return { success: false };

        const workbook = XLSX.utils.book_new();

        // 1. Products Sheet
        try {
            const products = await prisma.product.findMany({ include: { category: true, variants: true } });
            const productRows: any[] = [];
            products.forEach((p: any) => {
                if (p.variants.length === 0) {
                    productRows.push({
                        'Product Name': p.name,
                        'Category': p.category?.name || 'Uncategorized',
                        'HSN': p.hsn,
                        'Tax %': p.taxRate,
                        'Barcode': '', 'Size': '', 'Stock': 0 // Empty placeholders
                    });
                } else {
                    p.variants.forEach((v: any) => {
                        productRows.push({
                            'Product Name': p.name,
                            'Category': p.category?.name || 'Uncategorized',
                            'Barcode': v.barcode,
                            'Size': v.size,
                            'Color': v.color,
                            'MRP': v.mrp,
                            'Selling Price': v.sellingPrice,
                            'Cost Price': v.costPrice,
                            'Stock': v.stock,
                            'HSN': p.hsn
                        });
                    });
                }
            });
            const productSheet = XLSX.utils.json_to_sheet(productRows);
            XLSX.utils.book_append_sheet(workbook, productSheet, 'Products');
        } catch (e) {
            console.error('Error exporting products:', e);
        }

        // 2. Sales Sheet
        try {
            const sales = await prisma.sale.findMany({
                include: { items: true, user: { select: { username: true } } },
                orderBy: { createdAt: 'desc' }
            });
            const saleRows = sales.map((s: any) => ({
                'Bill No': s.billNo,
                'Date': s.createdAt,
                'Customer': s.customerName || 'Walk-in',
                'Phone': s.customerPhone,
                'Total': s.grandTotal,
                'Status': s.status,
                'Payment Mode': s.paymentMethod,
                'Items': s.items.length,
                'Cashier': s.user?.username
            }));
            const saleSheet = XLSX.utils.json_to_sheet(saleRows);
            XLSX.utils.book_append_sheet(workbook, saleSheet, 'Sales');
        } catch (e) {
            console.error('Error exporting sales:', e);
        }

        // 3. Customers
        try {
            const customers = await prisma.customer.findMany();
            if (customers.length > 0) {
                const customerSheet = XLSX.utils.json_to_sheet(customers);
                XLSX.utils.book_append_sheet(workbook, customerSheet, 'Customers');
            }
        } catch (e) { console.error('Error exporting customers:', e); }

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        fs.writeFileSync(filePath, buffer);

        return { success: true, path: filePath };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('products:import', async () => {
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Select Excel File',
            filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
            properties: ['openFile']
        });

        if (canceled || filePaths.length === 0) return { success: false, message: 'Cancelled' };

        const filePath = filePaths[0];
        let workbook: XLSX.WorkBook;
        try {
            const fileBuffer = fs.readFileSync(filePath);
            workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        } catch (e: any) {
            const msg = (e?.message || '').toLowerCase();
            if (msg.includes('cannot access file') || msg.includes('eacces') || msg.includes('ebusy') || msg.includes('permission')) {
                return {
                    success: false,
                    error: `Cannot access file ${filePath}. Close Excel/Preview/OneDrive lock and try again.`
                };
            }
            return { success: false, error: `Failed to read Excel file: ${e?.message || 'Unknown error'}` };
        }
        const sheetName = workbook.SheetNames[0];
        const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (rawData.length === 0) return { success: false, error: 'File is empty' };

        let stats = { success: 0, skipped: 0, errors: 0, details: [] as string[] };
        const categoryMap = new Map<string, string>();

        const asString = (v: any) => (v === null || v === undefined ? '' : String(v).trim());

        // Cache existing categories
        try {
            const categories = await prisma.category.findMany();
            categories.forEach((c: any) => categoryMap.set(c.name.toLowerCase(), c.id));
        } catch (e) { console.error('Error fetching categories', e); }

        for (const row of rawData as any[]) {
            try {
                const productName = getValNormalized(row, [
                    'Product Name', 'Item Name', 'Name', 'Product_Name', 'Item_Name', 'ITEM_NAME'
                ]);
                const barcode = getValNormalized(row, ['Barcode', 'Bar Code', 'Bar_Code'])?.toString();
                const categoryName = getValNormalized(row, [
                    'Category', 'Category Name', 'Category_Name', 'Item Category', 'Item_Category', 'CATEGORY'
                ]) || 'Uncategorized';

                if (!productName) {
                    stats.skipped++;
                    continue;
                }

                // Check Duplicates (by Barcode if present)
                let existingVariant = null;
                if (barcode) {
                    existingVariant = await prisma.productVariant.findFirst({ where: { barcode } });
                }

                if (existingVariant) {
                    stats.skipped++;
                    stats.details.push(`Skipped ${productName} (Duplicate Barcode: ${barcode})`);
                    continue;
                }

                // Get/Create Category
                let categoryId = categoryMap.get(categoryName.toLowerCase());
                if (!categoryId) {
                    const newCat = await prisma.category.create({ data: { name: categoryName } });
                    categoryMap.set(categoryName.toLowerCase(), newCat.id);
                    categoryId = newCat.id;
                }

                // Get Product or Create
                let product = await prisma.product.findFirst({ where: { name: productName } });
                if (!product) {
                    product = await prisma.product.create({
                        data: {
                            name: productName,
                            categoryId: categoryId || '',
                            hsn: getValNormalized(row, ['HSN Code', 'HSN', 'HSN_Code'])?.toString(),
                            taxRate: parseFloat(getValNormalized(row, ['GST %', 'GST', 'Tax', 'GST_Rate']) || '5')
                        }
                    });
                }

                // Create Variant
                await prisma.productVariant.create({
                    data: {
                        productId: product.id,
                        size: getValNormalized(row, ['Size'])?.toString() || 'Standard',
                        color: getValNormalized(row, ['Color'])?.toString(),
                        barcode: barcode || `GEN - ${Date.now()} -${Math.random().toString(36).substr(2, 5)} `,
                        sku: `${productName.substring(0, 3).toUpperCase()} -${Date.now().toString().slice(-6)} `,
                        mrp: parseFloat(getValNormalized(row, ['MRP', 'Rate', 'Price']) || '0'),
                        sellingPrice: parseFloat(getValNormalized(row, ['Selling Price', 'Sale Price', 'Selling_Price', 'Sale_Price', 'Price']) || '0'),
                        costPrice: parseFloat(getValNormalized(row, ['Purchase Price', 'Purchase_Price', 'Cost']) || '0'),
                        stock: parseInt(getValNormalized(row, ['Stock', 'Qty', 'Quantity', 'Stock Quantity', 'Stock_Quantity']) || '0')
                    }
                });

                stats.success++;
            } catch (err: any) {
                stats.errors++;
                stats.details.push(`Error on row: ${err.message} `);
                console.error(err);
            }
        }

        dialog.showMessageBoxSync({
            type: stats.errors > 0 ? 'warning' : 'info',
            title: 'Import Complete',
            message: `Products imported.\n\nSuccess: ${stats.success} \nSkipped: ${stats.skipped} \nErrors: ${stats.errors} `
        });

        return { success: true, stats };
    } catch (error: any) {
        console.error(error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('data:importAll', async () => {
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Select Excel File',
            filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
            properties: ['openFile']
        });

        if (canceled || filePaths.length === 0) return { success: false, message: 'Cancelled' };

        const filePath = filePaths[0];
        let workbook: XLSX.WorkBook;
        try {
            const fileBuffer = fs.readFileSync(filePath);
            workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        } catch (e: any) {
            const msg = (e?.message || '').toLowerCase();
            if (msg.includes('cannot access file') || msg.includes('eacces') || msg.includes('ebusy') || msg.includes('permission')) {
                return {
                    success: false,
                    error: `Cannot access file ${filePath}. Close Excel/Preview/OneDrive lock and try again.`
                };
            }
            return { success: false, error: `Failed to read Excel file: ${e?.message || 'Unknown error'}` };
        }

        const asString = (v: any) => (v === null || v === undefined ? '' : String(v).trim());

        let summary = {
            products: 0,
            customers: 0,
            sales: 0,
            skipped: 0,
            errors: 0
        };

        const detectSheetType = (rows: any[]) => {
            if (rows.length === 0) return 'unknown';
            const keys = Object.keys(normalizeRowKeys(rows[0] || {}));
            if (keys.some(k => k.includes('bill') || k.includes('payment') || k.includes('cashier'))) return 'sales';
            if (keys.some(k => k.includes('customer') || k.includes('gstin'))) return 'customers';
            if (keys.some(k => k.includes('product') || k.includes('barcode') || k.includes('mrp'))) return 'products';
            return 'unknown';
        };

        const importProductsRows = async (rows: any[]) => {
            for (const row of rows) {
                try {
                    const safeProductName = getValNormalized(row, ['Product Name', 'Item Name', 'Name', 'Product_Name', 'Item_Name']);
                    if (!safeProductName) {
                        summary.skipped++;
                        continue;
                    }

                    const categoryName = getValNormalized(row, ['Category', 'Category Name', 'Category_Name']) || 'Uncategorized';
                    let category = await prisma.category.findFirst({ where: { name: categoryName } });
                    if (!category) {
                        category = await prisma.category.create({ data: { name: categoryName } });
                    }

                    let product = await prisma.product.findFirst({ where: { name: safeProductName } });
                    if (!product) {
                        product = await prisma.product.create({
                            data: {
                                name: safeProductName,
                                categoryId: category.id,
                                hsn: getValNormalized(row, ['HSN', 'HSN Code', 'HSN_Code'])?.toString(),
                                taxRate: parseFloat(getValNormalized(row, ['Tax %', 'GST %', 'GST', 'GST_Rate']) || '5')
                            }
                        });
                    }

                    const barcode = asString(getValNormalized(row, ['Barcode', 'Bar Code', 'Bar_Code', 'Item Code', 'ItemCode', 'Product Code', 'Code', 'SKU']));
                    const itemCode = asString(getValNormalized(row, ['Item Code', 'ItemCode', 'Product Code', 'Code', 'SKU']));
                    const finalBarcode = barcode || itemCode || `GEN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    const finalSku = itemCode || finalBarcode || `${safeProductName.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}`;
                    const existingVariant = finalBarcode
                        ? await prisma.productVariant.findFirst({ where: { barcode: finalBarcode } })
                        : null;
                    if (existingVariant) {
                        summary.skipped++;
                        continue;
                    }

                    await prisma.productVariant.create({
                        data: {
                            productId: product.id,
                            size: getValNormalized(row, ['Size'])?.toString() || 'Standard',
                            color: getValNormalized(row, ['Color'])?.toString(),
                            barcode: finalBarcode,
                            sku: finalSku,
                            mrp: parseFloat(getValNormalized(row, ['MRP', 'Rate', 'Price']) || '0'),
                            sellingPrice: parseFloat(getValNormalized(row, ['Selling Price', 'Sale Price', 'Selling_Price', 'Sale_Price', 'Price']) || '0'),
                            costPrice: parseFloat(getValNormalized(row, ['Purchase Price', 'Purchase_Price', 'Cost']) || '0'),
                            stock: parseInt(getValNormalized(row, ['Stock', 'Qty', 'Quantity', 'Stock Quantity', 'Stock_Quantity']) || '0')
                        }
                    });

                    summary.products++;
                } catch (e) {
                    summary.errors++;
                }
            }
        };

        const importCustomersRows = async (rows: any[]) => {
            for (const row of rows) {
                try {
                    const name = getValNormalized(row, ['Customer Name', 'Name']);
                    if (!name) {
                        summary.skipped++;
                        continue;
                    }
                    const phone = getValNormalized(row, ['Phone', 'Mobile', 'Phone No'])?.toString();
                    const email = getValNormalized(row, ['Email'])?.toString();
                    const address = getValNormalized(row, ['Address'])?.toString();
                    const gstin = getValNormalized(row, ['GSTIN', 'GSTIN No'])?.toString();

                    if (phone) {
                        await prisma.customer.upsert({
                            where: { phone },
                            update: { name, email, address, gstin },
                            create: { name, phone, email, address, gstin }
                        });
                    } else {
                        await prisma.customer.create({
                            data: { name, phone: null, email, address, gstin }
                        });
                    }
                    summary.customers++;
                } catch (e) {
                    summary.errors++;
                }
            }
        };

        const importSalesRows = async (rows: any[]) => {
            await ensureDefaultAdmin();
            for (const row of rows) {
                try {
                    const total = parseFloat(getValNormalized(row, ['Total', 'Grand Total', 'Net Amount', 'Amount']) || '0');
                    const billRaw = getValNormalized(row, ['Bill No', 'BillNo', 'Invoice No', 'InvoiceNo', 'Bill']);
                    const billNo = parseInt(String(billRaw || '0').replace(/[^\d]/g, ''), 10) || 0;
                    const status = getValNormalized(row, ['Status'])?.toString() || 'COMPLETED';
                    const paymentMethod = getValNormalized(row, ['Payment Mode', 'Payment', 'Mode'])?.toString() || 'CASH';
                    const dateVal = getValNormalized(row, ['Date', 'Bill Date', 'Invoice Date', 'Created At']);
                    const createdAt = parseFlexibleDate(dateVal);

                    const cashier = getValNormalized(row, ['Cashier', 'User', 'Salesman'])?.toString();
                    const user = cashier
                        ? await prisma.user.findFirst({ where: { username: cashier } })
                        : await prisma.user.findFirst({ where: { role: 'ADMIN' } });
                    const userId = user?.id || (await ensureDefaultAdmin()).id;

                    if (billNo > 0) {
                        const exists = await prisma.sale.findFirst({ where: { billNo: String(billNo) } });
                        if (exists) {
                            summary.skipped++;
                            continue;
                        }
                    }

                    await prisma.sale.create({
                        data: {
                            billNo: billNo > 0 ? String(billNo) : await getNextBillNoForDate(createdAt || new Date()),
                            userId,
                            customerName: getValNormalized(row, ['Customer'])?.toString() || null,
                            customerPhone: getValNormalized(row, ['Phone'])?.toString() || null,
                            subtotal: total,
                            discount: 0,
                            discountPercent: 0,
                            taxAmount: 0,
                            cgst: 0,
                            sgst: 0,
                            grandTotal: total,
                            paymentMethod,
                            paidAmount: total,
                            changeAmount: 0,
                            status,
                            remarks: 'Imported from Excel',
                            isHistorical: true,
                            importedFrom: 'Excel',
                            createdAt
                        }
                    });
                    summary.sales++;
                } catch (e) {
                    summary.errors++;
                }
            }
        };

        let processedAnySheet = false;
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            if (!rows.length) continue;

            const lowerName = sheetName.toLowerCase();
            let type: 'products' | 'customers' | 'sales' | 'unknown' = 'unknown';
            if (lowerName.includes('product') || lowerName.includes('item') || lowerName.includes('stock')) type = 'products';
            else if (lowerName.includes('customer') || lowerName.includes('party')) type = 'customers';
            else if (lowerName.includes('sale') || lowerName.includes('bill') || lowerName.includes('invoice')) type = 'sales';
            else type = detectSheetType(rows as any[]);

            if (type === 'products') await importProductsRows(rows as any[]);
            else if (type === 'customers') await importCustomersRows(rows as any[]);
            else if (type === 'sales') await importSalesRows(rows as any[]);
            else summary.skipped += (rows as any[]).length;

            processedAnySheet = true;
        }

        if (!processedAnySheet) {
            return { success: false, error: 'No readable rows found in selected workbook.' };
        }

        dialog.showMessageBoxSync({
            type: summary.errors > 0 ? 'warning' : 'info',
            title: 'Import Complete',
            message: `Import finished.\n\nProducts: ${summary.products} \nCustomers: ${summary.customers} \nSales: ${summary.sales} \nSkipped: ${summary.skipped} \nErrors: ${summary.errors} `
        });

        return { success: true };
    } catch (error: any) {
        console.error(error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('data:restoreFromExcelBackup', async () => {
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Select Excel Backup File',
            filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
            properties: ['openFile'],
        });

        if (canceled || filePaths.length === 0) return { success: false, message: 'Cancelled' };

        const filePath = filePaths[0];
        let workbook: XLSX.WorkBook;
        try {
            workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
        } catch (e: any) {
            return { success: false, error: `Cannot read file: ${e?.message}` };
        }

        const sheet = workbook.Sheets['Items Detail'];
        if (!sheet) {
            return { success: false, error: 'No "Items Detail" sheet found. Export using the Excel button on the Reports page first.' };
        }

        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '', range: 4 });
        // Filter to actual data rows (skip any leftovers from the header area)
        const dataRows = rows.filter(r => r['BILL NO'] && String(r['BILL NO']).trim() && String(r['BILL NO']).trim() !== 'BILL NO');

        // Group rows by bill number
        const billMap = new Map<string, { dateTime: string; customer: string; paymentMethod: string; grandTotal: number; items: any[] }>();
        for (const row of dataRows) {
            const billNo = String(row['BILL NO']).trim();
            if (!billMap.has(billNo)) {
                billMap.set(billNo, {
                    dateTime: String(row['DATE & TIME'] || ''),
                    customer: String(row['CUSTOMER'] || 'Walk-in Customer'),
                    paymentMethod: String(row['PAYMENT METHOD'] || 'CASH').toUpperCase(),
                    grandTotal: parseFloat(row['LINE TOTAL'] || '0'),
                    items: [],
                });
            }
            const bill = billMap.get(billNo)!;
            const product = String(row['PRODUCT'] || '');
            if (product && product !== '(Historical — no item details)') {
                bill.items.push(row);
            } else if (product === '(Historical — no item details)') {
                bill.grandTotal = parseFloat(row['LINE TOTAL'] || '0');
            }
        }

        const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
        if (!adminUser) return { success: false, error: 'No admin user found in database.' };

        let restored = 0, skipped = 0, errors = 0;

        for (const [billNo, bill] of billMap) {
            try {
                // Skip if already exists
                const exists = await prisma.sale.findFirst({ where: { billNo } });
                if (exists) { skipped++; continue; }

                // Parse date from 'dd/MMM/yy HH:mm' format (e.g. '15/Jan/26 14:30')
                let createdAt: Date;
                try {
                    createdAt = parseDate(bill.dateTime, 'dd/MMM/yy HH:mm', new Date());
                    if (isNaN(createdAt.getTime())) createdAt = parseFlexibleDate(bill.dateTime) || new Date();
                } catch {
                    createdAt = new Date();
                }

                if (bill.items.length === 0) {
                    // Historical sale — no item details
                    await prisma.sale.create({
                        data: {
                            billNo,
                            userId: adminUser.id,
                            customerName: bill.customer === 'Walk-in Customer' ? null : bill.customer,
                            subtotal: bill.grandTotal,
                            discount: 0,
                            discountPercent: 0,
                            taxAmount: 0,
                            cgst: 0,
                            sgst: 0,
                            grandTotal: bill.grandTotal,
                            paymentMethod: bill.paymentMethod,
                            paidAmount: bill.grandTotal,
                            changeAmount: 0,
                            status: 'COMPLETED',
                            isHistorical: true,
                            importedFrom: 'Excel Backup',
                            createdAt,
                            payments: { create: [{ paymentMode: bill.paymentMethod, amount: bill.grandTotal }] },
                        },
                    });
                } else {
                    // Full sale with item details
                    let subtotal = 0, discount = 0, cgst = 0, sgst = 0;
                    const saleItems: any[] = [];

                    for (const row of bill.items) {
                        const barcode = String(row['BARCODE'] || '').trim();
                        const sku = String(row['SKU'] || '').trim();
                        let variant: any = null;
                        if (barcode) variant = await prisma.productVariant.findFirst({ where: { barcode } });
                        if (!variant && sku) variant = await prisma.productVariant.findFirst({ where: { sku } });
                        if (!variant) { errors++; continue; }

                        const qty = parseInt(String(row['QTY'] || '1'), 10) || 1;
                        const mrp = parseFloat(row['MRP'] || '0');
                        const sellingPrice = parseFloat(row['SELLING PRICE'] || '0');
                        const disc = parseFloat(row['DISCOUNT'] || '0');
                        const taxRate = parseFloat(row['TAX %'] || '0');
                        const cgstAmt = parseFloat(row['CGST AMT'] || '0');
                        const sgstAmt = parseFloat(row['SGST AMT'] || '0');
                        const lineTotal = parseFloat(row['LINE TOTAL'] || '0');
                        const taxAmt = cgstAmt + sgstAmt;

                        subtotal += sellingPrice * qty;
                        discount += disc;
                        cgst += cgstAmt;
                        sgst += sgstAmt;

                        saleItems.push({
                            variantId: variant.id,
                            productName: String(row['PRODUCT'] || variant.product?.name || 'Unknown'),
                            variantInfo: [String(row['SIZE'] || ''), String(row['COLOR'] || '')].filter(Boolean).join(' ') || null,
                            quantity: qty,
                            mrp,
                            sellingPrice,
                            discount: disc,
                            taxRate,
                            taxAmount: taxAmt,
                            total: lineTotal,
                        });
                    }

                    if (saleItems.length === 0) { errors++; continue; }

                    const taxAmount = cgst + sgst;
                    const grandTotal = subtotal - discount + taxAmount;

                    await prisma.sale.create({
                        data: {
                            billNo,
                            userId: adminUser.id,
                            customerName: bill.customer === 'Walk-in Customer' ? null : bill.customer,
                            subtotal,
                            discount,
                            discountPercent: 0,
                            taxAmount,
                            cgst,
                            sgst,
                            grandTotal,
                            paymentMethod: bill.paymentMethod,
                            paidAmount: grandTotal,
                            changeAmount: 0,
                            status: 'COMPLETED',
                            isHistorical: true,
                            importedFrom: 'Excel Backup',
                            createdAt,
                            items: { create: saleItems },
                            payments: { create: [{ paymentMode: bill.paymentMethod, amount: grandTotal }] },
                        },
                    });
                }
                restored++;
            } catch (e: any) {
                console.error(`Error restoring bill ${billNo}:`, e?.message);
                errors++;
            }
        }

        dialog.showMessageBoxSync({
            type: errors > 0 ? 'warning' : 'info',
            title: 'Restore Complete',
            message: `Excel backup restore finished.\n\nRestored: ${restored}\nSkipped (already exist): ${skipped}\nErrors: ${errors}`,
        });

        return { success: true, restored, skipped, errors };
    } catch (error: any) {
        console.error(error);
        return { success: false, error: error.message };
    }
});

// Database Management Handlers
ipcMain.handle('db:backup', async () => {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog({
            title: 'Backup Database',
            defaultPath: `backup_zain_pos_${new Date().toISOString().slice(0, 10)}.db`,
            filters: [{ name: 'SQLite Database', extensions: ['db'] }]
        });

        if (canceled || !filePath) return { success: false };

        // CRITICAL: Flush WAL before backup to prevent data loss
        await flushDatabaseForBackup();

        const sourcePath = getDatabasePath();

        // Copy the main database file
        fs.copyFileSync(sourcePath, filePath);

        // Also copy WAL and SHM files if they exist (extra safety)
        const walPath = sourcePath + '-wal';
        const shmPath = sourcePath + '-shm';
        if (fs.existsSync(walPath)) {
            fs.copyFileSync(walPath, filePath + '-wal');
        }
        if (fs.existsSync(shmPath)) {
            fs.copyFileSync(shmPath, filePath + '-shm');
        }

        // Verify backup integrity
        const isValid = await verifyBackupIntegrity(filePath);
        if (!isValid) {
            dialog.showMessageBoxSync({
                type: 'warning',
                title: 'Backup Warning',
                message: 'Backup was created but integrity check failed. The backup file may be corrupted.'
            });
        }

        return { success: true, path: filePath, verified: isValid };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:restore', async () => {
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Select Backup File',
            filters: [{ name: 'SQLite Database', extensions: ['db'] }],
            properties: ['openFile']
        });

        if (canceled || filePaths.length === 0) return { success: false };

        const backupPath = filePaths[0];

        // STEP 1: Verify backup file integrity BEFORE doing anything destructive
        console.log(`Verifying backup integrity: ${backupPath}`);
        const isValidBackup = await verifyBackupIntegrity(backupPath);
        if (!isValidBackup) {
            dialog.showMessageBoxSync({
                type: 'error',
                title: 'Invalid Backup',
                message: 'The selected file is not a valid database backup. Restore cancelled.'
            });
            return { success: false, error: 'Invalid backup file' };
        }

        // Use the CENTRAL TRUTH for database path
        const targetPath = getDatabasePath();

        // STEP 2: Create pre-restore backup of current database (safety net)
        const preRestoreBackupDir = path.join(app.getPath('userData'), 'backups', 'pre-restore');
        await fs.promises.mkdir(preRestoreBackupDir, { recursive: true });
        const preRestoreBackupPath = path.join(preRestoreBackupDir, `pre-restore-${Date.now()}.db`);

        try {
            await flushDatabaseForBackup();
            fs.copyFileSync(targetPath, preRestoreBackupPath);
            logger.info('Restore', `Pre-restore backup created: ${preRestoreBackupPath}`);
        } catch (preBackupErr) {
            logger.warn('Restore', 'Pre-restore backup failed (non-fatal)', preBackupErr);
        }

        // Preserve current print settings/layout to avoid label/receipt regressions after restore
        const printSettingKeys = ['PRINTER_CONFIG', 'LABEL_LAYOUT', 'RECEIPT_LAYOUT'];
        let preservedPrintSettings: any[] = [];
        try {
            preservedPrintSettings = await prisma.setting.findMany({
                where: { key: { in: printSettingKeys } }
            });
        } catch (preserveErr) {
            logger.warn('Restore', 'Could not read current print settings (DB may be corrupt/empty), skipping preservation', preserveErr);
        }

        logger.info('Restore', `Restoring database from ${backupPath} to ${targetPath}`);

        // STEP 3: Checkpoint WAL before disconnect
        await flushDatabaseForBackup();

        await prisma.$disconnect();

        // Longer delay to ensure all file handles are released
        await new Promise(resolve => setTimeout(resolve, 1000));

        // STEP 4: Remove old WAL/SHM files before restore
        const targetWal = targetPath + '-wal';
        const targetShm = targetPath + '-shm';
        if (fs.existsSync(targetWal)) fs.unlinkSync(targetWal);
        if (fs.existsSync(targetShm)) fs.unlinkSync(targetShm);

        // STEP 5: Restore the database
        fs.copyFileSync(backupPath, targetPath);

        // Also restore WAL/SHM if they exist with the backup
        const backupWal = backupPath + '-wal';
        const backupShm = backupPath + '-shm';
        if (fs.existsSync(backupWal)) {
            fs.copyFileSync(backupWal, targetWal);
        }
        if (fs.existsSync(backupShm)) {
            fs.copyFileSync(backupShm, targetShm);
        }

        console.log('Database restore completed.');

        // Also update durable "latest" backups for future reinstalls
        const userDataLatest = getUserDataLatestBackupPath();
        const persistentLatest = getPersistentBackupPath();
        const persistentDir = path.dirname(persistentLatest);
        if (!fs.existsSync(path.dirname(userDataLatest))) {
            fs.mkdirSync(path.dirname(userDataLatest), { recursive: true });
        }
        if (!fs.existsSync(persistentDir)) {
            fs.mkdirSync(persistentDir, { recursive: true });
        }
        fs.copyFileSync(backupPath, userDataLatest);
        fs.copyFileSync(backupPath, persistentLatest);

        // Re-open and migrate schema, then report counts
        await restoreDatabaseFromSource(targetPath, targetPath);
        await ensureSchemaUpdated();

        for (const setting of preservedPrintSettings) {
            await prisma.setting.upsert({
                where: { key: setting.key },
                update: { value: setting.value },
                create: { key: setting.key, value: setting.value }
            });
        }

        const userCount = await prisma.user.count();
        const productCount = await prisma.product.count();
        const saleCount = await prisma.sale.count();

        if (productCount === 0 && saleCount === 0) {
            dialog.showMessageBoxSync({
                type: 'warning',
                title: 'Restore Warning',
                message: 'Restore completed, but no products/sales were found in this backup. The selected DB may be incompatible with this app version.'
            });
        }

        dialog.showMessageBoxSync({
            type: 'info',
            title: 'Restore Complete',
            message: `Restore finished.\n\nUsers: ${userCount}\nProducts: ${productCount}\nSales: ${saleCount}\n\nA pre-restore backup was saved in case you need to revert.`
        });

        // Smart Restart Logic
        const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

        if (isDev) {
            dialog.showMessageBoxSync({
                type: 'info',
                title: 'Restart Required',
                message: 'Database restored successfully.\n\nPlease manually restart your development server (npm run dev) to apply changes.'
            });
            app.quit();
        } else {
            app.relaunch();
            app.quit();
        }

        return { success: true };
    } catch (error: any) {
        logger.error('Restore', 'Restore failed', error);
        return { success: false, error: error.message };
    }
});

// List users FOR LOGIN - No authentication required
ipcMain.handle('users:listForLogin', async () => {
    try {
        await ensureUserSchemaReady();

        // Ensure default admin exists
        await ensureDefaultAdmin();

        const users = await prisma.user.findMany({
            where: { isActive: true }, // Only active users can login
            orderBy: { name: 'asc' },
            select: {
                id: true,
                username: true,
                name: true,
                role: true,
                isActive: true
                // NO sensitive data like passwords or permissions for login screen
            }
        });
        return { success: true, data: users };
    } catch (error: any) {
        logger.error('Login', 'Failed to list users for login:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('auth:login', async (event, { username, password }) => {
    clearElectronSession(event.sender.id);
    try {
        await ensureUserSchemaReady();
        await ensureDefaultAdmin();

        const user = await prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
                password: true,
                name: true,
                role: true,
                isActive: true,
                permPrintSticker: true,
                permAddItem: true,
                permDeleteProduct: true,
                permVoidSale: true,
                permViewReports: true,
                permViewSales: true,
                permViewGstReports: true,
                permManageProducts: true,
                permEditSettings: true,
                permEditSales: true,
                permManageInventory: true,
                permManageUsers: true,
                permViewCostPrice: true,
                permChangePayment: true,
                permDeleteAudit: true,
                permBulkUpdate: true,
                permBackDateSale: true,
                permViewInsights: true,
                maxDiscount: true
            }
        });

        if (!user) {
            return { success: false, error: 'Invalid username or password' };
        }

        if (!user.isActive) {
            return { success: false, error: 'User account is disabled' };
        }

        const storedPassword = String(user.password || '');
        let isValidPassword = false;

        if (isBcryptHash(storedPassword)) {
            isValidPassword = await bcrypt.compare(password, storedPassword);
        } else {
            // v1 shop backups may contain plain-text passwords. If the legacy
            // password is correct, upgrade it immediately to the v2 hash format.
            isValidPassword = password === storedPassword;
            if (isValidPassword) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { password: await bcrypt.hash(password, 10) }
                });
            }
        }

        if (!isValidPassword) {
            return { success: false, error: 'Invalid username or password' };
        }

        await prisma.auditLog.create({
            data: {
                action: 'USER_LOGIN',
                details: `User "${user.username}" logged in`,
                userId: user.id
            }
        });

        bindElectronSession(event.sender, user.id);
        return { success: true, data: stripPasswords(user) };
    } catch (error: any) {
        logger.error('Login', 'Login failed:', error);
        return { success: false, error: error.message || 'Login failed' };
    }
});

ipcMain.handle('auth:logout', async (event) => {
    clearElectronSession(event.sender.id);
    return { success: true };
});

// User Management Handlers (SECURE VERSIONS)

// List users - requires permManageUsers
createSecureIpcHandler(
    'users:list',
    PermissionMiddleware.manageUsers,
    async (_event, _args, user) => {
        await ensureUserSchemaReady();
        const users = await prisma.user.findMany({
            orderBy: { name: 'asc' },
            select: {
                id: true,
                username: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
                // Permissions
                permPrintSticker: true,
                permAddItem: true,
                permDeleteProduct: true,
                permVoidSale: true,
                permViewReports: true,
                permViewSales: true,
                permViewGstReports: true,
                permManageProducts: true,
                permEditSettings: true,
                permEditSales: true,
                permManageInventory: true,
                permManageUsers: true,
                permViewCostPrice: true,
                permChangePayment: true,
                permDeleteAudit: true,
                permBulkUpdate: true,
                permBackDateSale: true,
                permViewInsights: true,
                maxDiscount: true
            }
        });
        return { success: true, data: users };
    },
    {
        extractUserId: (args: any) => args?.requestingUserId || 'system',
        requiresValidation: true
    }
);

// Create user - requires permManageUsers
createSecureIpcHandler(
    'users:create',
    PermissionMiddleware.manageUsers,
    async (_event, { userData, createdBy }, user) => {
        await ensureUserSchemaReady();

        if (!userData.username || !userData.password || !userData.name) {
            return { success: false, error: 'Missing required fields' };
        }

        const existing = await prisma.user.findUnique({ where: { username: userData.username } });
        if (existing) return { success: false, error: 'Username already exists' };

        // Hash password before storing
        const hashedPassword = await bcrypt.hash(userData.password, 10);

        const newUser = await prisma.user.create({
            data: {
                username: userData.username,
                password: hashedPassword,
                name: userData.name,
                role: userData.role || 'CASHIER',
                isActive: true,
                // Apply permission defaults
                ...userData.permissions
            }
        });

        await prisma.auditLog.create({
            data: {
                action: 'USER_CREATE',
                details: `User "${newUser.username}" created by ${user.role} user`,
                userId: createdBy
            }
        });

        logger.info('User', `User "${newUser.username}" created by user ${createdBy} (${user.role})`);
        return { success: true, data: newUser };
    },
    {
        extractUserId: (args: any) => args.createdBy
    }
);

// Update user - requires permManageUsers OR user updating their own profile
createSecureIpcHandler(
    'users:update',
    async (user, context) => {
        // Allow users to update their own profile (limited fields)
        if (user?.id === context?.targetUserId) {
            return {
                allowed: true,
                auditEvent: {
                    userId: user?.id || context?.targetUserId || 'unknown',
                    action: 'update-own-profile',
                    success: true,
                    reason: 'Self-update allowed'
                }
            };
        }
        // Otherwise require manage users permission
        return await PermissionMiddleware.manageUsers(user, context);
    },
    async (_event, { id, data, updatedBy }, user) => {
        await ensureUserSchemaReady();
        if (!user) {
            return { success: false, error: 'User authentication required' };
        }

        // If user is updating themselves, restrict what they can change
        if (user.id === id && user.role !== 'ADMIN') {
            // Cashiers can only update their own name and password
            const allowedFields = ['name', 'password'];
            const restrictedFields = Object.keys(data).filter(key => !allowedFields.includes(key));

            if (restrictedFields.length > 0) {
                return {
                    success: false,
                    error: `Cannot modify restricted fields: ${restrictedFields.join(', ')}`
                };
            }
        }

        // Only existing ADMINs can assign the ADMIN role
        if (data.role && data.role === 'ADMIN' && user.role !== 'ADMIN') {
            return {
                success: false,
                error: 'Only administrators can assign the Administrator role.'
            };
        }

        // If password is being updated, hash it
        if (data.password) {
            data.password = await bcrypt.hash(data.password, 10);
        }

        const existingUser = await prisma.user.findUnique({ where: { id } });

        const updatedUser = await prisma.user.update({
            where: { id },
            data: data
        });

        const changesList: string[] = [];
        if (data.maxDiscount !== undefined && existingUser?.maxDiscount !== data.maxDiscount) {
            changesList.push(`Max discount cap set to ${data.maxDiscount}% (was ${existingUser?.maxDiscount || 0}%)`);
        }
        if (data.role && existingUser?.role !== data.role) {
            changesList.push(`Role changed from ${existingUser?.role} to ${data.role}`);
        }
        if (data.name && existingUser?.name !== data.name) {
            changesList.push(`Name changed to "${data.name}"`);
        }
        if (data.password) {
            changesList.push('Password was reset');
        }
        const permKeys = Object.keys(data).filter(k => k.startsWith('perm') && (existingUser as any)?.[k] !== (data as any)[k]);
        if (permKeys.length > 0) {
            changesList.push(`Permissions updated: ${permKeys.map(k => `${k.replace('perm', '')} (${(data as any)[k] ? 'Enabled' : 'Disabled'})`).join(', ')}`);
        }

        const detailsText = changesList.length > 0
            ? `User "${updatedUser.name || updatedUser.username}" updated (${user.role}): ${changesList.join('; ')}`
            : `User "${updatedUser.username}" updated by ${user.role} user${user.id === id ? ' (self-update)' : ''}`;

        await prisma.auditLog.create({
            data: {
                action: 'USER_UPDATE',
                details: detailsText,
                userId: updatedBy
            }
        });

        logger.info('User', `User "${updatedUser.username}" updated by user ${updatedBy} (${user.role})`);
        return { success: true, data: updatedUser };
    },
    {
        extractUserId: (args: any) => args.updatedBy,
        extractContext: (args: any) => ({ targetUserId: args.id })
    }
);

// Change password - requires permManageUsers OR user changing their own password
createSecureIpcHandler(
    'users:changePassword',
    async (user, context) => {
        // Allow users to change their own password
        if (user?.id === context?.targetUserId) {
            return {
                allowed: true,
                auditEvent: {
                    userId: user?.id || context?.targetUserId || 'unknown',
                    action: 'change-own-password',
                    success: true,
                    reason: 'Self-password change allowed'
                }
            };
        }
        // Otherwise require manage users permission
        return await PermissionMiddleware.manageUsers(user, context);
    },
    async (_event, { id, password, changedBy }, user) => {
        await ensureUserSchemaReady();
        if (!user) {
            return { success: false, error: 'User authentication required' };
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.update({
            where: { id },
            data: { password: hashedPassword }
        });

        const targetUser = await prisma.user.findUnique({ where: { id } });

        await prisma.auditLog.create({
            data: {
                action: 'PASSWORD_CHANGE',
                details: `Password changed for user "${targetUser?.username}" by ${user.role} user${user.id === id ? ' (self-change)' : ''}`,
                userId: changedBy
            }
        });

        logger.info('User', `Password changed for user ${id} by user ${changedBy} (${user.role})`);
        return { success: true };
    },
    {
        extractUserId: (args: any) => args.changedBy,
        extractContext: (args: any) => ({ targetUserId: args.id })
    }
);

// Delete user (deactivate) - requires permManageUsers
createSecureIpcHandler(
    'users:delete',
    PermissionMiddleware.manageUsers,
    async (_event, { id, deletedBy }, user) => {
        if (user.id === id) {
            return { success: false, error: 'Cannot delete your own account' };
        }

        const targetUser = await prisma.user.findUnique({ where: { id } });
        if (!targetUser) {
            return { success: false, error: 'User not found' };
        }

        await prisma.user.update({
            where: { id },
            data: { isActive: false }
        });

        await prisma.auditLog.create({
            data: {
                action: 'USER_DELETE',
                details: `User "${targetUser.username}" deactivated by ${user.role} user`,
                userId: deletedBy
            }
        });

        logger.info('User', `User "${targetUser.username}" deactivated by user ${deletedBy} (${user.role})`);
        return { success: true };
    },
    {
        extractUserId: (args: any) => args.deletedBy
    }
);

ipcMain.handle('cloud:syncNow', async () => {
    try {
        console.log('🔄 Sync Now Starting (Smart Verification & Delta)...');

        // 1. Get Cloud URL from settings
        const setting = await prisma.setting.findUnique({ where: { key: 'CLOUD_API_URL' } });
        if (!setting || !setting.value) {
            return { success: false, error: 'Cloud API URL not configured in Settings.' };
        }

        cloudSync.setApiUrl(setting.value);
        const syncSecret = await loadCloudSyncSecret();
        if (!syncSecret) {
            return { success: false, error: 'Cloud sync secret not configured. Set CLOUD_SYNC_SECRET in Settings or environment.' };
        }

        // 2. Perform smart verification & delta sync
        const syncResult = await cloudSync.verifyAndSync();

        // 3. Sync Audit delta
        let auditSynced = 0;
        try {
            auditSynced = await syncAuditDelta();
        } catch (auditErr: any) {
            console.warn('Audit delta sync warning:', auditErr.message);
        }

        return {
            ...syncResult,
            auditSynced
        };
    } catch (error: any) {
        console.error('Manual sync failed:', error);
        return { success: false, error: error.message };
    }
});

// Bulk sync all historical data to cloud
ipcMain.handle('cloud:bulkSyncAll', async (event) => {
    try {
        console.log('🚀 Bulk Sync Starting...');

        // 1. Get Cloud URL from settings
        const setting = await prisma.setting.findUnique({ where: { key: 'CLOUD_API_URL' } });
        if (!setting || !setting.value) {
            return { success: false, error: 'Cloud API URL not configured in Settings.' };
        }

        cloudSync.setApiUrl(setting.value);
        const syncSecret = await loadCloudSyncSecret();
        if (!syncSecret) {
            return { success: false, error: 'Cloud sync secret not configured.' };
        }

        // 2. Run bulk sync with progress callback
        const result = await cloudSync.bulkSyncAll((progress) => {
            // Send progress to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('cloud:bulkSyncProgress', progress);
            }
        });

        return result;
    } catch (error: any) {
        console.error('Bulk sync failed:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// NETWORK STATUS IPC HANDLERS
// ========================================

// Network status service instance
let networkService: ReturnType<typeof getNetworkStatusService> | null = null;

ipcMain.handle('network:getStatus', () => {
    if (!networkService) {
        networkService = getNetworkStatusService(mainWindow || undefined);
    }
    return networkService.getStatus();
});

ipcMain.handle('network:forceCheck', async () => {
    if (!networkService) {
        networkService = getNetworkStatusService(mainWindow || undefined);
    }
    return await networkService.forceCheck();
});

// Handle network status change subscriptions
ipcMain.handle('network:subscribe', (event) => {
    if (!networkService) {
        networkService = getNetworkStatusService(mainWindow || undefined);
    }
    return { success: true };
});

// ========================================
// PRINT TEST HANDLERS
// ========================================

// Test receipt print
ipcMain.handle('print:testReceipt', async (_event, data) => sendReceipt(BrowserWindow, data));

// Test label print
ipcMain.handle('print:testLabel', async (event, { data, printer }) => {
    try {
        const user = await resolveElectronSessionUser(prisma, event);
        const permission = PermissionService.checkPermission(user, 'permPrintSticker');
        if (!permission.allowed) throw new Error(permission.reason || 'Sticker printing is not permitted.');
        const barcodeLiteral = JSON.stringify(String(data?.barcode || '')).replace(/</g, '\\u003c');
        // Generate test barcode label HTML
        const testLabelHtml = `
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    <style>
        body {
            font-family: Arial, sans-serif;
            font-size: 10px;
            margin: 0;
            padding: 2mm;
            width: 40mm;
            height: 20mm;
            text-align: center;
        }
        .barcode { margin: 1mm 0; }
        .product-name { font-weight: bold; margin-bottom: 1mm; }
        .details { font-size: 8px; }
    </style>
</head>
<body>
    <div class="product-name">${escapeHtml(String(data?.productName || ''))}</div>
    <div class="details">${escapeHtml(String(data?.productCode || ''))}</div>
    <div class="barcode">
        <svg id="barcode"></svg>
    </div>
    <div class="details">${escapeHtml(String(data?.price || ''))}</div>
    <div class="details">TEST LABEL</div>
    
    <script>
        JsBarcode("#barcode", ${barcodeLiteral}, {
            format: "CODE128",
            width: 1,
            height: 30,
            displayValue: false,
            margin: 0
        });
    </script>
</body>
</html>`;

        // Use existing print:label handler
        return await new Promise((resolve) => {
            const printWindow = new BrowserWindow({ show: false });
            
            printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testLabelHtml.trim())}`);
            
            // Wait for content and barcode to load then print
            printWindow.webContents.once('did-finish-load', () => {
                setTimeout(() => {
                    const options: any = {
                        silent: true,
                        margins: { marginType: 'none' },
                        pageSize: { width: 40000, height: 20000 } // 40mm x 20mm in microns
                    };

                    if (printer && printer.trim().length > 0) {
                        options.deviceName = printer.trim();
                    }

                    printWindow.webContents.print(options, (success) => {
                        printWindow.close();
                        if (success) {
                            resolve({ success: true });
                        } else {
                            resolve({ success: false, error: 'Print failed' });
                        }
                    });
                }, 1500); // Wait longer for barcode script to load
            });
        });
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});


// ============================================================
// CASH DRAWER / REGISTER RECONCILIATION IPC HANDLERS
// ============================================================

/**
 * Helper: get local IST date string YYYY-MM-DD
 * Avoids UTC date shifting by reading the system's local time.
 */
function getLocalDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get today's cash sales data: total cash and itemized sale entries for the ledger.
 */
async function getTodaySalesData(todayStr: string): Promise<{ totalCash: number; grossCash: number; refundCash: number; saleEntries: any[] }> {
    try {
        const [year, month, day] = todayStr.split('-').map(Number);
        const startLocal = new Date(year, month - 1, day, 0, 0, 0, 0);
        const endLocal   = new Date(year, month - 1, day, 23, 59, 59, 999);

        // Fetch completed sales for today using Prisma Client ORM
        // which properly handles SQLite timestamp integer conversion
        const sales = await prisma.sale.findMany({
            where: {
                status: 'COMPLETED',
                OR: [
                    {
                        actualSaleDate: {
                            gte: startLocal,
                            lte: endLocal,
                        }
                    },
                    {
                        actualSaleDate: null,
                        createdAt: {
                            gte: startLocal,
                            lte: endLocal,
                        }
                    }
                ]
            },
            include: {
                payments: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        let totalCash = 0;
        const saleEntries: any[] = [];

        for (const sale of sales) {
            let saleCash = 0;
            if (sale.payments && sale.payments.length > 0) {
                for (const p of sale.payments) {
                    const mode = (p.paymentMode || '').toUpperCase();
                    if (mode === 'CASH') {
                        saleCash += Number(p.amount || 0);
                    }
                }
            } else if ((sale.paymentMethod || '').toUpperCase() === 'CASH') {
                saleCash = Number(sale.grandTotal || 0);
            }

            if (saleCash > 0) {
                totalCash += saleCash;
                const rawDate = sale.actualSaleDate || sale.createdAt;
                const isoDate = typeof rawDate === 'number'
                    ? new Date(rawDate).toISOString()
                    : new Date(rawDate).toISOString();

                saleEntries.push({
                    id: `sale-${sale.id}`,
                    type: 'CASH_SALE',
                    category: 'POS_SALE',
                    amount: saleCash,
                    note: `Bill #${sale.billNo || '—'}${sale.customerName ? ` (${sale.customerName})` : ''}`,
                    createdAt: isoDate,
                    isSale: true,
                    billNo: sale.billNo
                });
            }
        }

        // Fetch refunds issued today to account for cash paid out to customers from the till
        const refunds = await prisma.refund.findMany({
            where: {
                refundDate: {
                    gte: startLocal,
                    lte: endLocal,
                }
            },
            include: {
                payments: true,
                invoice: {
                    select: {
                        billNo: true,
                        customerName: true
                    }
                }
            },
            orderBy: {
                refundDate: 'desc'
            }
        });

        let totalCashRefunds = 0;
        const refundEntries: any[] = [];

        for (const refund of refunds) {
            let refundCash = 0;
            if (refund.payments && refund.payments.length > 0) {
                for (const p of refund.payments) {
                    const mode = (p.paymentMode || '').toUpperCase();
                    if (mode === 'CASH') {
                        refundCash += Number(p.amount || 0);
                    }
                }
            }

            if (refundCash > 0) {
                totalCashRefunds += refundCash;
                const rawDate = refund.refundDate;
                const isoDate = typeof rawDate === 'number'
                    ? new Date(rawDate).toISOString()
                    : new Date(rawDate).toISOString();

                refundEntries.push({
                    id: `refund-${refund.id}`,
                    type: 'CASH_REFUND',
                    category: 'REFUND',
                    amount: refundCash,
                    note: `Refund on Bill #${refund.invoice?.billNo || '—'}${refund.invoice?.customerName ? ` (${refund.invoice.customerName})` : ''}${refund.reason ? ` — ${refund.reason}` : ''}`,
                    createdAt: isoDate,
                    isRefund: true,
                    billNo: refund.invoice?.billNo
                });
            }
        }

        const combinedEntries = [...saleEntries, ...refundEntries].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const netCash = totalCash - totalCashRefunds;

        return {
            totalCash: netCash,
            grossCash: totalCash,
            refundCash: totalCashRefunds,
            saleEntries: combinedEntries
        };
    } catch (err: any) {
        console.error('getTodaySalesData error:', err.message);
        throw new Error(`Failed to calculate sales data: ${err.message}`);
    }
}

/**
 * Get today's cash sales (only CASH payments from COMPLETED sales on today's local date).
 */
async function getTodayCashSales(todayStr: string): Promise<number> {
    const data = await getTodaySalesData(todayStr);
    return data.totalCash;
}

// Mutex lock to serialize register creation and mutations, preventing concurrent duplicates
let registerLock: Promise<any> = Promise.resolve();

function withRegisterLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = registerLock.then(fn, fn);
    registerLock = next.catch(() => {});
    return next;
}

// Check permission for cash drawer operations
async function checkCashDrawerPermission(userId?: string): Promise<{ allowed: boolean; error?: string }> {
    if (!userId) return { allowed: true };
    try {
        const user = await getUserPermissions(userId);
        if (!user) return { allowed: false, error: 'User not found' };
        if (!user.isActive) return { allowed: false, error: 'User account is deactivated' };
        if (user.role === 'ADMIN' || user.permViewReports || user.permManageCashDrawer || user.isActive) {
            return { allowed: true };
        }
        return { allowed: false, error: 'Permission denied: You do not have permission to manage the cash drawer' };
    } catch (err: any) {
        return { allowed: false, error: err.message };
    }
}

// register:get-current
// Returns (or auto-creates) the open register for today, plus computed totals
ipcMain.handle('register:get-current', async (_event) => {
    return withRegisterLock(async () => {
        try {
            const todayStr = getLocalDateString();

            // 1. Find existing OPEN register
            const openRegisters: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM "CashRegister" WHERE status = 'OPEN' ORDER BY openedAt DESC`
            );
            let register: any = openRegisters.length > 0 ? openRegisters[0] : null;

            let isPreviousDayUnclosed = false;
            let unclosedRegisterDate: string | undefined = undefined;

            if (register) {
                // If open register is from a past date (e.g. power outage or missed closing)
                if (register.date && register.date < todayStr) {
                    isPreviousDayUnclosed = true;
                    unclosedRegisterDate = register.date;
                }
            } else {
                // 2. If no OPEN register, check if today's register was already CLOSED today
                const todayClosed: any[] = await prisma.$queryRawUnsafe(
                    `SELECT * FROM "CashRegister" WHERE date = ? AND status = 'CLOSED' ORDER BY closedAt DESC LIMIT 1`,
                    todayStr
                );
                if (todayClosed.length > 0) {
                    register = todayClosed[0];
                }
            }

            // 3. If still none (first time opening the register today), auto-create one
            if (!register) {
                // Get openingFloat from most recently CLOSED register
                const lastClosed: any[] = await prisma.$queryRawUnsafe(
                    `SELECT closingActual FROM "CashRegister" WHERE status = 'CLOSED' ORDER BY closedAt DESC LIMIT 1`
                );
                const openingFloat = lastClosed.length > 0 && lastClosed[0].closingActual != null
                    ? Number(lastClosed[0].closingActual)
                    : 0;

                const newId = require('crypto').randomUUID ? require('crypto').randomUUID() :
                              `${Date.now()}-${Math.random().toString(36).slice(2)}`;

                await prisma.$executeRawUnsafe(
                    `INSERT INTO "CashRegister" ("id", "date", "openedAt", "openingFloat", "status")
                     VALUES (?, ?, ?, ?, 'OPEN')`,
                    newId, todayStr, new Date().toISOString(), openingFloat
                );

                register = { id: newId, date: todayStr, openingFloat, status: 'OPEN', openedAt: new Date().toISOString() };
            }

            // 4. Get manual transactions for this register
            const txList: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM "CashDrawerTx" WHERE "registerId" = ? ORDER BY "createdAt" DESC`,
                register.id
            );

            // 5. Calculate totals and get itemized POS cash sales
            const effectiveDate = register.date || todayStr;
            const { totalCash: cashSales, grossCash, refundCash, saleEntries } = await getTodaySalesData(effectiveDate);

            const cashOut = txList
                .filter((t: any) => t.type === 'CASH_OUT')
                .reduce((s: number, t: any) => s + Number(t.amount), 0);
            const cashIn = txList
                .filter((t: any) => t.type === 'CASH_IN')
                .reduce((s: number, t: any) => s + Number(t.amount), 0);

            const openingFloat = Number(register.openingFloat || 0);
            const expectedCashInDrawer = openingFloat + cashSales + cashIn - cashOut;

            // Combine POS cash sales and manual drawer transactions, newest first
            const allTransactions = [...saleEntries, ...txList].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );

            return {
                success: true,
                data: {
                    register,
                    openingFloat,
                    cashSales,
                    grossCashSales: grossCash,
                    cashRefunds: refundCash,
                    cashOut,
                    cashIn,
                    expectedCashInDrawer,
                    transactions: allTransactions,
                    isPreviousDayUnclosed,
                    unclosedRegisterDate
                }
            };
        } catch (error: any) {
            console.error('register:get-current error:', error);
            return { success: false, error: error.message };
        }
    });
});

// register:add-tx
// Add a new CashDrawerTx to the current open register
ipcMain.handle('register:add-tx', async (_event, { type, category, amount, note, userId }) => {
    return withRegisterLock(async () => {
        try {
            const perm = await checkCashDrawerPermission(userId);
            if (!perm.allowed) {
                return { success: false, error: perm.error };
            }

            // Find open register
            const registers: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM "CashRegister" WHERE status = 'OPEN' ORDER BY openedAt DESC LIMIT 1`
            );
            if (!registers.length) {
                return { success: false, error: 'No open register found. Please refresh.' };
            }
            const register = registers[0];

            const todayStr = getLocalDateString();
            if (register.date && register.date < todayStr) {
                return {
                    success: false,
                    error: `Register from previous day (${register.date}) is still open. Please reconcile and close it before adding new transactions.`
                };
            }

            if (!type || !['CASH_OUT', 'CASH_IN'].includes(type)) {
                return { success: false, error: 'Invalid transaction type' };
            }
            if (!amount || Number(amount) <= 0) {
                return { success: false, error: 'Amount must be greater than 0' };
            }

            const newId = require('crypto').randomUUID
                ? require('crypto').randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

            await prisma.$executeRawUnsafe(
                `INSERT INTO "CashDrawerTx" ("id", "registerId", "type", "category", "amount", "note", "createdAt")
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                newId, register.id, type, category || (type === 'CASH_IN' ? 'TOP_UP' : 'EXPENSE'), Number(amount), note || '', new Date().toISOString()
            );

            const tx: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM "CashDrawerTx" WHERE id = ?`, newId
            );

            return { success: true, data: tx[0] };
        } catch (error: any) {
            console.error('register:add-tx error:', error);
            return { success: false, error: error.message };
        }
    });
});

// register:delete-tx
// Delete an unclosed-register transaction
ipcMain.handle('register:delete-tx', async (_event, { txId, userId }) => {
    return withRegisterLock(async () => {
        try {
            const perm = await checkCashDrawerPermission(userId);
            if (!perm.allowed) {
                return { success: false, error: perm.error };
            }

            const txRows: any[] = await prisma.$queryRawUnsafe(
                `SELECT ct.*, cr.status as registerStatus
                 FROM "CashDrawerTx" ct
                 JOIN "CashRegister" cr ON cr.id = ct."registerId"
                 WHERE ct.id = ?`,
                txId
            );
            if (!txRows.length) return { success: false, error: 'Transaction not found' };
            const purchaseTables: any[] = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='PurchasePayment'");
            if (purchaseTables.length) {
                const linked: any[] = await prisma.$queryRawUnsafe('SELECT id FROM PurchasePayment WHERE drawerTxId=? LIMIT 1', txId);
                if (linked.length) return { success: false, error: 'This is a recorded supplier payment and cannot be deleted from the cash register.' };
            }
            const expenseTables:any[]=await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='ShopExpense'");
            if(expenseTables.length){
                const linked:any[]=await prisma.$queryRawUnsafe('SELECT id FROM ShopExpense WHERE drawerTxId=? OR reversalDrawerTxId=? LIMIT 1',txId,txId);
                if(linked.length)return {success:false,error:'This cash entry is linked to an expense. Manage it from Expenses so the cash and expense records stay consistent.'};
            }
            if (txRows[0].registerStatus === 'CLOSED') {
                return { success: false, error: 'Cannot delete transactions from a closed register' };
            }

            await prisma.$executeRawUnsafe(`DELETE FROM "CashDrawerTx" WHERE id = ?`, txId);
            return { success: true };
        } catch (error: any) {
            console.error('register:delete-tx error:', error);
            return { success: false, error: error.message };
        }
    });
});

// register:adjust-opening-float
// Allow manual override of openingFloat for the current open register
ipcMain.handle('register:adjust-opening-float', async (_event, { openingFloat, userId }) => {
    return withRegisterLock(async () => {
        try {
            const perm = await checkCashDrawerPermission(userId);
            if (!perm.allowed) {
                return { success: false, error: perm.error };
            }

            const float = Number(openingFloat);
            if (isNaN(float) || float < 0) {
                return { success: false, error: 'Invalid opening float value' };
            }
            const registers: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM "CashRegister" WHERE status = 'OPEN' ORDER BY openedAt DESC LIMIT 1`
            );
            if (!registers.length) {
                return { success: false, error: 'No open register found' };
            }
            await prisma.$executeRawUnsafe(
                `UPDATE "CashRegister" SET "openingFloat" = ? WHERE id = ?`,
                float, registers[0].id
            );
            return { success: true };
        } catch (error: any) {
            console.error('register:adjust-opening-float error:', error);
            return { success: false, error: error.message };
        }
    });
});

// register:close
// Close the current register with actual cash count
ipcMain.handle('register:close', async (_event, { actualCashCounted, notes, registerId, userId }) => {
    return withRegisterLock(async () => {
        try {
            const perm = await checkCashDrawerPermission(userId);
            if (!perm.allowed) {
                return { success: false, error: perm.error };
            }

            const actual = Number(actualCashCounted);
            if (isNaN(actual) || actual < 0) {
                return { success: false, error: 'Invalid actual cash amount' };
            }

            let register: any;
            if (registerId) {
                const regs: any[] = await prisma.$queryRawUnsafe(
                    `SELECT * FROM "CashRegister" WHERE id = ? AND status = 'OPEN' LIMIT 1`,
                    registerId
                );
                if (!regs.length) return { success: false, error: 'Specified register is not open or does not exist' };
                register = regs[0];
            } else {
                const registers: any[] = await prisma.$queryRawUnsafe(
                    `SELECT * FROM "CashRegister" WHERE status = 'OPEN' ORDER BY openedAt DESC LIMIT 1`
                );
                if (!registers.length) {
                    return { success: false, error: 'No open register to close' };
                }
                register = registers[0];
            }

            // Calculate expected for this register's specific date
            const txList: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM "CashDrawerTx" WHERE "registerId" = ?`, register.id
            );
            const cashOut = txList.filter((t: any) => t.type === 'CASH_OUT').reduce((s: number, t: any) => s + Number(t.amount), 0);
            const cashIn  = txList.filter((t: any) => t.type === 'CASH_IN').reduce((s: number, t: any) => s + Number(t.amount), 0);
            const cashSales = await getTodayCashSales(register.date || getLocalDateString());
            const openingFloat = Number(register.openingFloat || 0);
            const expected = openingFloat + cashSales + cashIn - cashOut;
            const difference = actual - expected;

            await prisma.$executeRawUnsafe(
                `UPDATE "CashRegister"
                 SET status = 'CLOSED', "closedAt" = ?, "closingActual" = ?, "closingExpected" = ?, "difference" = ?, notes = ?
                 WHERE id = ?`,
                new Date().toISOString(), actual, expected, difference, notes || null, register.id
            );

            const updated: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM "CashRegister" WHERE id = ?`, register.id
            );
            return { success: true, data: { register: updated[0], expected, difference } };
        } catch (error: any) {
            console.error('register:close error:', error);
            return { success: false, error: error.message };
        }
    });
});

// register:reopen
// Reopens today's closed register (for last-minute customers)
ipcMain.handle('register:reopen', async (_event, { registerId, userId } = {}) => {
    return withRegisterLock(async () => {
        try {
            const perm = await checkCashDrawerPermission(userId);
            if (!perm.allowed) {
                return { success: false, error: perm.error };
            }

            let targetId = registerId;
            if (!targetId) {
                const todayStr = getLocalDateString();
                const closed: any[] = await prisma.$queryRawUnsafe(
                    `SELECT * FROM "CashRegister" WHERE date = ? AND status = 'CLOSED' ORDER BY closedAt DESC LIMIT 1`,
                    todayStr
                );
                if (!closed.length) {
                    return { success: false, error: 'No closed register found for today to reopen' };
                }
                targetId = closed[0].id;
            }

            await prisma.$executeRawUnsafe(
                `UPDATE "CashRegister"
                 SET status = 'OPEN', "closedAt" = NULL, "closingActual" = NULL, "closingExpected" = NULL, "difference" = NULL
                 WHERE id = ?`,
                targetId
            );

            const updated: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM "CashRegister" WHERE id = ?`, targetId
            );

            return { success: true, data: updated[0] };
        } catch (error: any) {
            console.error('register:reopen error:', error);
            return { success: false, error: error.message };
        }
    });
});

// register:get-history
// Show the latest saved closing per day, preserving older stored closing records.
ipcMain.handle('register:get-history', async (_event, { limit = 365 } = {}) => {
    try {
        const queryLimit = limit === null || limit === 0 || limit === undefined ? 5000 : Number(limit);
        const registers: any[] = await prisma.$queryRawUnsafe(
            `SELECT cr.* FROM "CashRegister" cr
             WHERE cr.status = 'CLOSED'
               AND NOT EXISTS (
                   SELECT 1 FROM "CashRegister" newer
                   WHERE newer.date = cr.date
                     AND (
                         newer.status = 'OPEN'
                         OR (newer.status = 'CLOSED' AND (
                             COALESCE(newer."closedAt", '') > COALESCE(cr."closedAt", '')
                             OR (COALESCE(newer."closedAt", '') = COALESCE(cr."closedAt", '') AND (
                                 newer."openedAt" > cr."openedAt"
                                 OR (newer."openedAt" = cr."openedAt" AND newer.id > cr.id)
                             ))
                         ))
                     )
               )
             ORDER BY cr.date DESC, cr."closedAt" DESC, cr.id DESC LIMIT ?`,
            queryLimit
        );

        // Attach transactions to each register
        const result = await Promise.all(registers.map(async (reg: any) => {
            const txList: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM "CashDrawerTx" WHERE "registerId" = ? ORDER BY "createdAt" ASC`,
                reg.id
            );
            return { ...reg, transactions: txList };
        }));

        return { success: true, data: result };
    } catch (error: any) {
        console.error('register:get-history error:', error);
        return { success: false, error: error.message };
    }
});

// Test printer connection
ipcMain.handle('print:testConnection', async (_event, { printer, type }) => {
    try {
        // Get list of available printers
        const printers = await BrowserWindow.getAllWindows()[0]?.webContents.getPrintersAsync() || [];
        
        if (!printer || printer.trim().length === 0) {
            return { success: false, error: 'No printer specified' };
        }

        // Check if printer exists in the system
        const printerExists = printers.some(p => p.name === printer.trim());
        
        if (!printerExists) {
            return { 
                success: false, 
                error: `Printer "${printer}" not found. Available printers: ${printers.map(p => p.name).join(', ') || 'None'}` 
            };
        }

        // Find the printer details
        const printerInfo = printers.find(p => p.name === printer.trim());
        
        return {
            success: true,
            data: {
                name: printerInfo?.name || printer,
                status: printerInfo?.status || 'Unknown',
                isDefault: printerInfo?.isDefault || false,
                type: type || 'Unknown'
            }
        };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

// --- Expense Handlers: trusted session, one cash movement per entry ---
for(const [channel,handler] of [
    ['expenses:create',createExpense],['expenses:act',actOnExpense],['expenses:list',listExpenses],['expenses:detail',expenseDetail],['expenses:export',exportExpenses],
] as const)createSecureIpcHandler(channel,PermissionMiddleware.manageCashDrawer,async(_event,args:any,user)=>{
    try{
        const data=channel==='expenses:create'||channel==='expenses:act'
            ?await withRegisterLock(()=>handler(prisma,args,user)):await handler(prisma,args,user);
        return {success:true,data};
    }catch(error){return {success:false,error:error instanceof Error?error.message:'Expense request failed.'};}
},{trustedSession:true});
// --- End Expense Handlers ---

// --- Business Insights Read Handler ---
createSecureIpcHandler('insights:get',PermissionMiddleware.authenticated,async(_event,_args:any,user)=>{
    try{return {success:true,data:await getBusinessInsights(prisma,user)};}catch(error){return {success:false,error:error instanceof Error?error.message:'Could not load business insights.'};}
},{trustedSession:true});
// --- End Business Insights Read Handler ---

createSecureIpcHandler('profit:get',PermissionMiddleware.authenticated,async(_event,args:any,user)=>{
    try{return {success:true,data:await getProfitReport(prisma,args,user)};}catch(error){return {success:false,error:error instanceof Error?error.message:'Could not load profit.'};}
},{trustedSession:true});

// --- Sale Cost Read Handler ---
createSecureIpcHandler('sales:getCosts',PermissionMiddleware.authenticated,async(_event,args:any,user)=>{
    try{return {success:true,data:await getSaleCosts(prisma,args,user)};}
    catch(error){return {success:false,error:error instanceof Error?error.message:'Could not read sale costs.'};}
},{trustedSession:true});

// --- Purchase Handlers: receipt costs and supplier balances ---
for (const [channel, handler] of [
    ['purchases:receive', receivePurchase], ['purchases:pay', payPurchase],
    ['purchases:adjust', adjustPurchase], ['purchases:refund', refundPurchase],
    ['purchases:list', listPurchases], ['purchases:detail', purchaseDetail], ['purchases:items', purchaseItems],
] as const) {
    createSecureIpcHandler(channel, PermissionMiddleware.manageInventory, async (_event, args: any, user) => {
        try {
            const data = ['purchases:receive','purchases:pay','purchases:adjust','purchases:refund'].includes(channel)
                ? await withRegisterLock(() => handler(prisma, args, user))
                : await handler(prisma, args, user);
            return { success: true, data };
        }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Purchase request failed.' }; }
    }, { trustedSession: true });
}

// --- End Purchase Handlers ---

// --- Stock & Inventory Handlers (ST-01) ---
createSecureIpcHandler(
    'stock:getOverview',
    PermissionMiddleware.manageInventory,
    async (_event, args: any) => {
        return await getStockOverview(prisma, args);
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'stock:getMovements',
    PermissionMiddleware.manageInventory,
    async (_event, args: any) => {
        return await getStockMovements(prisma, args);
    },
    { trustedSession: true }
);

// --- Return Stock Lookup: original financial item, explicit physical destination ---
createSecureIpcHandler('sales:getReturnStockOptions', PermissionMiddleware.editSale, async (_event, args: any, user) => {
    try {
        return { success: true, data: await getReturnStockOptions(prisma, args, user) };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Could not identify returned stock.' };
    }
}, { trustedSession: true });

// --- Inventory Workspace Handlers: explicit tracking and reviewed stock writes ---
createSecureIpcHandler(
    'stock:getInventory',
    PermissionMiddleware.manageInventory,
    async (_event, args: any) => getInventoryWorkspace(prisma, args || {}),
    { trustedSession: true }
);

const prepareStockPermission = PermissionService.createPermissionMiddleware(
    ['permManageProducts', 'permManageInventory'],
    { action: 'prepare-audit-style', resource: 'inventory', checkType: 'all' }
);
for (const [channel, operation] of [
    ['stockAuditSetup:get', (_args: any, user: any) => getStockAuditSetup(prisma, user)],
    ['stockAuditSetup:save', (args: any, user: any) => saveStockAuditSetup(prisma, args, user)],
] as const) createSecureIpcHandler(channel, PermissionMiddleware.manageInventory, async (_event, args: any, user) => {
    try { return { success: true, data: await operation(args, user) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not load or save stock audit setup.' }; }
}, { trustedSession: true });

createSecureIpcHandler(
    'stockConversion:saveEntry', PermissionMiddleware.manageInventory,
    async (_event, args: any, user) => {
        try {
            const sourceBarcodes: string[] = [];
            // Edited values are intentional operator input; source IDs must still
            // belong to the exact saved workbook, not an arbitrary renderer claim.
            if (args?.fileHash) {
                if (!excelAuditService || !Array.isArray(args.rows) || args.rows.length > 1000) throw new Error('Upload and review the workbook first.');
                for (let offset = 0; offset < args.rows.length; offset += 100) {
                    const saved = excelAuditService.resolveRows(args.fileHash, args.rows.slice(offset, offset + 100).map((row: any) => row.sourceRowId));
                    for (const row of saved.rows) if (row.barcode) sourceBarcodes.push(row.barcode);
                }
            }
            return { success: true, data: await saveStockEntry(prisma, args, user, sourceBarcodes) };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not save stock.' }; }
    }, { trustedSession: true }
);
createSecureIpcHandler(
    'stockConversion:prepare',
    prepareStockPermission,
    async (_event, args: any, user) => {
        try {
            if (!excelAuditService) return { success: false, error: 'Excel audit is still starting. Please try again.' };
            // Resolve IDs against the reviewed main-process snapshot. Never trust renderer counts.
            const saved = excelAuditService.resolveRows(args?.fileHash, args?.rowIds);
            const data = await prepareAuditStyle(prisma, { ...args, ...saved }, user);
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Could not prepare the reviewed audit items.' };
        }
    },
    { trustedSession: true }
);
createSecureIpcHandler(
    'stockConversion:postBatch',
    PermissionMiddleware.manageInventory,
    async (_event, args: any, user) => {
        try {
            return { success: true, data: await postStockBatch(prisma, args, user) };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Could not post this stock batch.' };
        }
    },
    { trustedSession: true }
);
createSecureIpcHandler(
    'stockConversion:adjust',
    PermissionMiddleware.manageInventory,
    async (_event, args: any, user) => {
        try {
            return { success: true, data: await adjustTrackedStock(prisma, args, user) };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Could not save this stock correction.' };
        }
    },
    { trustedSession: true }
);

// --- Excel Audit Handlers: uploaded observations, never live inventory writes ---
function registerExcelAuditHandler(
    channel: string,
    operation: (service: NonNullable<typeof excelAuditService>, args: any, owner: string, user: UserPermissions) => any
) {
    createSecureIpcHandler(channel, PermissionMiddleware.manageInventory, async (event, args: any, user) => {
        if (!excelAuditService) return { success: false, error: 'Excel audit is still starting. Please try again.' };
        try {
            return { success: true, data: await operation(excelAuditService, args || {}, `${user.id}:${event.sender.id}`, user) };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'The Excel audit request failed.' };
        }
    }, { trustedSession: true });
}

registerExcelAuditHandler('excelAudit:status', service => service.status());
registerExcelAuditHandler('excelAudit:list', async (service, args, _owner, user) => {
    const result = await service.list(args);
    const statuses = await getAuditRowStatuses(prisma, result.items.map(row => row.id), user);
    return { ...result, items: result.items.map(row => {
        const progress = statuses[row.id];
        return progress ? { ...row, stockStatus: progress.state, stockDraftId: progress.draftId, stockVariantId: progress.variantId } : row;
    }) };
});
registerExcelAuditHandler('excelAudit:preview', (service, args, owner) => service.preview(args, owner));
registerExcelAuditHandler('excelAudit:commit', (service, args, owner) => service.commit(args.token, owner));

// --- Stock Count Drafts Handlers (ST-03A) ---
createSecureIpcHandler(
    'stockDraft:list',
    PermissionMiddleware.manageInventory,
    async (_event, args: any, user) => {
        try {
            const data = await stockDraftList(prisma, args, user);
            return { success: true, data };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'stockDraft:get',
    PermissionMiddleware.manageInventory,
    async (_event, args: any, user) => {
        try {
            const data = await stockDraftGet(prisma, args, user);
            return { success: true, data };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'stockDraft:searchVariants',
    PermissionMiddleware.manageInventory,
    async (_event, args: any, user) => {
        try {
            const data = await stockDraftSearchVariants(prisma, args, user);
            return { success: true, data };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'stockDraft:create',
    PermissionMiddleware.manageInventory,
    async (_event, args: any, user) => {
        try {
            const data = await stockDraftCreate(prisma, args, user);
            return { success: true, data };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'stockDraft:save',
    PermissionMiddleware.manageInventory,
    async (_event, args: any, user) => {
        try {
            const data = await stockDraftSave(prisma, args, user);
            return { success: true, data };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'stockDraft:cancel',
    PermissionMiddleware.manageInventory,
    async (_event, args: any, user) => {
        try {
            const data = await stockDraftCancel(prisma, args, user);
            return { success: true, data };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

// --- Catalogue & Label Readiness Handlers (ST-02) ---
createSecureIpcHandler(
    'catalogue:saveProduct',
    PermissionMiddleware.manageProducts,
    async (_event, data: any, user) => {
        try {
            const saved = await catalogueSaveProduct(prisma, data, user);
            return { success: true, data: saved };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'catalogue:getProduct',
    PermissionMiddleware.authenticated,
    async (_event, args: { id: string }, user) => {
        try {
            const product = await catalogueGetProduct(prisma, args?.id, user);
            return { success: true, data: product };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'catalogue:listProducts',
    PermissionMiddleware.authenticated,
    async (_event, args: any, user) => {
        try {
            const products = await catalogueListProducts(prisma, args || {}, user);
            return { success: true, data: products };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'catalogue:checkBarcode',
    PermissionMiddleware.authenticated,
    async (_event, args: { barcode: string; excludeVariantId?: string }) => {
        try {
            const check = await catalogueCheckBarcode(prisma, args?.barcode, args?.excludeVariantId);
            return { success: true, data: check };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'catalogue:listVariants',
    PermissionMiddleware.authenticated,
    async (_event, args: any, user) => {
        return { success: true, data: await catalogueListVariants(prisma, args || {}, user) };
    },
    { trustedSession: true }
);

createSecureIpcHandler(
    'catalogue:generateBarcode',
    PermissionMiddleware.manageProducts,
    async (_event, args: any, user) => {
        return { success: true, data: await catalogueReserveBarcode(prisma, args, user) };
    },
    { trustedSession: true }
);




