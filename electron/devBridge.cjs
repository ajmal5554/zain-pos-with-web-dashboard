const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');

let prismaClientInstance = null;
let stockServiceModule = null;
let catalogueServiceModule = null;
let stockDraftServiceModule = null;
const typescriptModules = new Map();

function loadTypeScriptModule(sourcePath) {
    if (typescriptModules.has(sourcePath)) return typescriptModules.get(sourcePath).exports;
    const source = fs.readFileSync(sourcePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
    }).outputText;
    const mod = { exports: {} };
    typescriptModules.set(sourcePath, mod);
    const sourceRequire = createRequire(sourcePath);
    const localRequire = (name) => {
        if (name.startsWith('.')) {
            const absolute = path.resolve(path.dirname(sourcePath), name);
            const tsPath = absolute.endsWith('.ts') ? absolute : `${absolute}.ts`;
            if (fs.existsSync(tsPath)) return loadTypeScriptModule(tsPath);
        }
        return sourceRequire(name);
    };
    try {
        new Function('require', 'exports', 'module', compiled)(localRequire, mod.exports, mod);
        return mod.exports;
    } catch (error) {
        typescriptModules.delete(sourcePath);
        throw error;
    }
}

function getPrisma() {
    if (!prismaClientInstance) {
        const { PrismaClient } = require('../prisma/generated/client');
        const dbPath = path.resolve(__dirname, '../prisma/pos.db');
        prismaClientInstance = new PrismaClient({
            datasources: {
                db: {
                    url: `file:${dbPath}`,
                },
            },
        });
    }
    return prismaClientInstance;
}

function getStockService() {
    if (!stockServiceModule) {
        stockServiceModule = loadTypeScriptModule(path.resolve(__dirname, 'stock.service.ts'));
    }
    return stockServiceModule;
}

function getCatalogueService() {
    if (!catalogueServiceModule) {
        catalogueServiceModule = loadTypeScriptModule(path.resolve(__dirname, 'catalogue.service.ts'));
    }
    return catalogueServiceModule;
}

function getStockDraftService() {
    if (!stockDraftServiceModule) {
        stockDraftServiceModule = loadTypeScriptModule(path.resolve(__dirname, 'stock-draft.service.ts'));
    }
    return stockDraftServiceModule;
}

function createDevBridgeHandler(options = {}) {
    const {
        SessionAuthStore, resolveAuthenticatedSessionUser, maskSessionResult, containsSensitiveQueryField,
    } = loadTypeScriptModule(path.resolve(__dirname, 'session-auth.service.ts'));
    const sessions = options.sessions || new SessionAuthStore();
    const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
    return async function devBridgeHandler(req, res) {
        // Browser sessions are usable only from this preview's own origin.
        if (req.headers.origin) {
            let sameOrigin = false;
            try {
                const protocol = req.socket?.encrypted ? 'https:' : 'http:';
                sameOrigin = new URL(req.headers.origin).origin === `${protocol}//${req.headers.host}`;
            } catch {}
            if (!sameOrigin) {
                res.statusCode = 403;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'Cross-origin bridge access is not permitted' }));
                return;
            }
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
        }

        if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
        }

        let bodyStr = '';
        req.on('data', (chunk) => {
            bodyStr += chunk;
        });

        req.on('end', async () => {
            res.setHeader('Content-Type', 'application/json');
            try {
                const { channel, args } = JSON.parse(bodyStr || '{}');
                const prisma = options.prisma || getPrisma();
                const authorization = String(req.headers.authorization || '');
                const sessionToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
                let user = null;
                let responseData = { success: false, error: 'Unknown IPC channel' };

                if (channel === 'auth:logout') {
                    if (sessionToken) sessions.clear(sessionToken);
                    res.statusCode = 200;
                    res.end(JSON.stringify({ success: true }));
                    return;
                }
                if (channel === 'auth:login') {
                    if (sessionToken) sessions.clear(sessionToken);
                } else if (channel !== 'users:listForLogin') {
                    try { user = await resolveAuthenticatedSessionUser(prisma, sessions, sessionToken); }
                    catch (error) { throw fail(error.message, 401); }
                }
                if ((channel === 'catalogue:saveProduct' || channel === 'catalogue:generateBarcode') &&
                    user.role !== 'ADMIN' && !user.permManageProducts) {
                    throw fail('Permission Denied: You do not have permission to manage products.', 403);
                }
                if ((channel === 'print:label' || channel === 'print:testLabel') &&
                    user.role !== 'ADMIN' && !user.permPrintSticker) {
                    throw fail('Permission Denied: You do not have permission to print labels.', 403);
                }
                if (channel.startsWith('stockDraft:') &&
                    user.role !== 'ADMIN' && !user.permManageInventory) {
                    throw fail('Permission Denied: You do not have permission to manage inventory or stock drafts.', 403);
                }

                switch (channel) {
                    case 'users:listForLogin': {
                        const users = await prisma.user.findMany({
                            where: { isActive: true },
                            orderBy: { name: 'asc' },
                            select: {
                                id: true,
                                username: true,
                                name: true,
                                role: true,
                                isActive: true,
                            },
                        });
                        responseData = { success: true, data: users };
                        break;
                    }

                    case 'auth:login': {
                        const { username, password } = args || {};
                        if (typeof username !== 'string' || typeof password !== 'string') {
                            throw fail('Invalid username or password', 401);
                        }
                        const loginUser = await prisma.user.findUnique({
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
                                maxDiscount: true,
                            },
                        });

                        if (!loginUser) {
                            responseData = { success: false, error: 'Invalid username or password' };
                            break;
                        }

                        if (!loginUser.isActive) {
                            responseData = { success: false, error: 'User account is disabled' };
                            break;
                        }

                        const storedPassword = String(loginUser.password || '');
                        let valid = false;
                        if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$')) {
                            valid = await bcrypt.compare(password, storedPassword);
                        } else {
                            valid = password === storedPassword;
                        }

                        if (!valid) {
                            responseData = { success: false, error: 'Invalid username or password' };
                            break;
                        }

                        const { password: _p, ...safeUser } = loginUser;
                        const token = randomBytes(32).toString('hex');
                        sessions.bind(token, loginUser.id);
                        responseData = { success: true, data: safeUser, sessionToken: token };
                        break;
                    }

                    case 'stock:getOverview': {
                        const stockService = getStockService();
                        responseData = await stockService.getStockOverview(prisma, { ...args, userId: user.id });
                        break;
                    }

                    case 'stock:getMovements': {
                        const stockService = getStockService();
                        responseData = await stockService.getStockMovements(prisma, { ...args, userId: user.id });
                        break;
                    }

                    case 'stockDraft:list': {
                        const stockDraftService = options.stockDraftService || getStockDraftService();
                        const result = await stockDraftService.listDrafts(prisma, args, user);
                        responseData = { success: true, data: result };
                        break;
                    }

                    case 'stockDraft:get': {
                        const stockDraftService = options.stockDraftService || getStockDraftService();
                        const result = await stockDraftService.getDraft(prisma, args, user);
                        responseData = { success: true, data: result };
                        break;
                    }

                    case 'stockDraft:searchVariants': {
                        const stockDraftService = options.stockDraftService || getStockDraftService();
                        const result = await stockDraftService.searchPreparedVariants(prisma, args, user);
                        responseData = { success: true, data: result };
                        break;
                    }

                    case 'stockDraft:create': {
                        const stockDraftService = options.stockDraftService || getStockDraftService();
                        const result = await stockDraftService.createDraft(prisma, args, user);
                        responseData = { success: true, data: result };
                        break;
                    }

                    case 'stockDraft:save': {
                        const stockDraftService = options.stockDraftService || getStockDraftService();
                        const result = await stockDraftService.saveDraft(prisma, args, user);
                        responseData = { success: true, data: result };
                        break;
                    }

                    case 'stockDraft:cancel': {
                        const stockDraftService = options.stockDraftService || getStockDraftService();
                        const result = await stockDraftService.cancelDraft(prisma, args, user);
                        responseData = { success: true, data: result };
                        break;
                    }

                    case 'catalogue:saveProduct': {
                        const catalogueService = options.catalogueService || getCatalogueService();
                        const saved = await catalogueService.saveProduct(prisma, args, user);
                        responseData = { success: true, data: saved };
                        break;
                    }

                    case 'catalogue:getProduct': {
                        const catalogueService = options.catalogueService || getCatalogueService();
                        const product = await catalogueService.getProduct(prisma, args?.id, user);
                        responseData = { success: true, data: product };
                        break;
                    }

                    case 'catalogue:listProducts': {
                        const catalogueService = options.catalogueService || getCatalogueService();
                        const products = await catalogueService.listProducts(prisma, args || {}, user);
                        responseData = { success: true, data: products };
                        break;
                    }

                    case 'catalogue:checkBarcode': {
                        const catalogueService = options.catalogueService || getCatalogueService();
                        const check = await catalogueService.checkBarcode(prisma, args?.barcode, args?.excludeVariantId);
                        responseData = { success: true, data: check };
                        break;
                    }

                    case 'catalogue:listVariants': {
                        const catalogueService = options.catalogueService || getCatalogueService();
                        responseData = { success: true, data: await catalogueService.listVariants(prisma, args || {}, user) };
                        break;
                    }

                    case 'catalogue:generateBarcode': {
                        const catalogueService = options.catalogueService || getCatalogueService();
                        responseData = { success: true, data: await catalogueService.reserveBarcode(prisma, args || {}, user) };
                        break;
                    }

                    case 'print:label':
                    case 'print:testLabel':
                        responseData = { success: false, error: 'Hardware printing not available in web browser' };
                        break;

                    case 'settings:get': {
                        const setting = await prisma.setting.findUnique({
                            where: { key: args?.key },
                        });
                        responseData = { success: true, data: setting?.value ?? null };
                        break;
                    }

                    case 'insights:get': {
                        responseData={success:true,data:await loadTypeScriptModule(path.resolve(__dirname,'insights.service.ts')).getBusinessInsights(prisma,user)};
                        break;
                    }

                    case 'settings:set': {
                        if (user.role !== 'ADMIN' && !user.permEditSettings) {
                            throw fail('Permission Denied: You do not have permission to edit settings.', 403);
                        }
                        const { key, value } = args || {};
                        await prisma.setting.upsert({
                            where: { key },
                            update: { value },
                            create: { key, value },
                        });
                        responseData = { success: true };
                        break;
                    }

                    case 'db:secureQuery': {
                        const { model, method, args: queryArgs } = args || {};
                        const allowedModels = [
                            'user', 'product', 'productVariant', 'category', 'customer',
                            'sale', 'saleItem', 'auditLog', 'inventoryMovement', 'setting',
                        ];
                        const allowedMethods = [
                            'findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy',
                        ];
                        if (!allowedModels.includes(model)) {
                            responseData = { success: false, error: `Model '${model}' not permitted` };
                            break;
                        }
                        if (!allowedMethods.includes(method)) {
                            responseData = { success: false, error: `Method '${method}' not permitted in read bridge` };
                            break;
                        }
                        if (user.role !== 'ADMIN' && !user.permViewCostPrice && containsSensitiveQueryField(queryArgs, 'costPrice')) {
                            throw fail('Permission Denied: Cost price queries are not permitted.', 403);
                        }
                        if (model === 'user' && user.role !== 'ADMIN' && !user.permManageUsers &&
                            (!['findUnique', 'findFirst'].includes(method) || queryArgs?.where?.id !== user.id)) {
                            throw fail('Permission Denied: User access is not permitted.', 403);
                        }
                        const resData = await prisma[model][method](queryArgs);
                        responseData = { success: true, data: resData };
                        break;
                    }

                    case 'sales:getNextBillNo': {
                        const datePrefix = args?.dateStr || new Date().toISOString().slice(0, 10).replace(/-/g, '');
                        const latest = await prisma.sale.findFirst({
                            where: { billNo: { startsWith: datePrefix } },
                            orderBy: { createdAt: 'desc' },
                        });
                        let nextSeq = 1;
                        if (latest?.billNo) {
                            const parts = latest.billNo.split('-');
                            const lastNum = parseInt(parts[parts.length - 1], 10);
                            if (!isNaN(lastNum)) nextSeq = lastNum + 1;
                        }
                        responseData = { success: true, data: `${datePrefix}-${String(nextSeq).padStart(4, '0')}` };
                        break;
                    }

                    case 'sales:getSaleById': {
                        const sale = await prisma.sale.findUnique({
                            where: { id: args?.saleId },
                            include: { items: true, customer: true, payments: true },
                        });
                        responseData = { success: true, data: sale };
                        break;
                    }

                    case 'register:get-current': {
                        const current = await prisma.cashRegister.findFirst({
                            where: { status: 'OPEN' },
                            orderBy: { openedAt: 'desc' },
                            include: { transactions: true },
                        });
                        responseData = { success: true, data: current };
                        break;
                    }

                    case 'register:get-history': {
                        const history = await prisma.cashRegister.findMany({
                            orderBy: { openedAt: 'desc' },
                            take: args?.limit || 20,
                            include: { transactions: true },
                        });
                        responseData = { success: true, data: history };
                        break;
                    }

                    default:
                        responseData = { success: false, error: `Unsupported channel: ${channel}` };
                }

                res.statusCode = 200;
                res.end(JSON.stringify(maskSessionResult(responseData, user)));
            } catch (err) {
                res.statusCode = err.statusCode || 500;
                res.end(JSON.stringify({ success: false, error: err.message || 'Internal server error' }));
            }
        });
    };
}

module.exports = {
    createDevBridgeHandler,
};

