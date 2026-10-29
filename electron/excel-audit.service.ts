import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import * as XLSX from 'xlsx';
import type {
    ExcelAuditListInput, ExcelAuditListResult, ExcelAuditPreview, ExcelAuditRow,
    ExcelAuditStatus, ExcelAuditUploadInput,
} from '../src/types/excelAudit';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 64;
const MAX_HEADER_ROWS = 10;
const PREVIEW_ROWS = 20;
const TOKEN_TTL_MS = 10 * 60_000;
const MAX_TOKENS = 4;
const ATTRIBUTE_KEYS = new Set([
    'subtype', 'pattern', 'fabric', 'collar', 'pocket', 'sleeve', 'fit', 'color', 'border',
    'quality', 'design', 'style', 'styleRef', 'material', 'length', 'waist', 'packSize',
    'gender', 'ageGroup', 'model', 'unit', 'productCode', 'sku',
]);
const ALIASES: Record<string, string[]> = {
    id: ['id', 'auditid', 'rowid', 'itemid', 'variantid'],
    name: ['name', 'productname', 'itemname'],
    barcode: ['barcode', 'barcodenumber', 'ean', 'ean13', 'upc'],
    category: ['category', 'productcategory', 'itemcategory'],
    brand: ['brand', 'brandname'],
    size: ['size', 'sizevalue'],
    countedQuantity: ['quantity', 'qty', 'count', 'countedquantity', 'auditquantity', 'auditedquantity', 'stockcount', 'physicalcount', 'stockquantity', 'pieces'],
    mrp: ['mrp', 'mrpprice', 'price', 'sellingprice', 'saleprice', 'unitprice', 'rate'],
    lastUpdated: ['lastupdated', 'updatedat', 'lastupdatedat', 'updatedon', 'lastmodified', 'lastmodifiedat'],
    subtype: ['subtype', 'subcategory'], pattern: ['pattern'], fabric: ['fabric'],
    collar: ['collar'], pocket: ['pocket', 'pockets'], sleeve: ['sleeve', 'sleevelength'], fit: ['fit'],
    color: ['color', 'colour'], border: ['border'], quality: ['quality'], design: ['design'],
    style: ['style'], styleRef: ['styleref', 'stylereference'], material: ['material'],
    length: ['length'], waist: ['waist'], packSize: ['packsize'], gender: ['gender'],
    ageGroup: ['agegroup'], model: ['model'], unit: ['unit'], productCode: ['productcode', 'itemcode'], sku: ['sku'],
};
const HEADERS = new Map(Object.entries(ALIASES).flatMap(([field, aliases]) => aliases.map(alias => [alias, field] as const)));
const LABELS: Record<string, string> = {
    id: 'ID', name: 'Name', barcode: 'Barcode', category: 'Category', brand: 'Brand', size: 'Size',
    countedQuantity: 'Quantity', mrp: 'MRP', lastUpdated: 'Last Updated',
};
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const ignoredSheet = (name: string) => ['summary', 'totals', 'instructions', 'readme'].includes(normalize(name));

type Snapshot = {
    version: 1;
    revision: number;
    fileName: string;
    sheetName: string;
    fileHash: string;
    importedAt: string;
    rows: ExcelAuditRow[];
};
type Parsed = Omit<Snapshot, 'version' | 'revision' | 'importedAt'>;
type Review = { owner: string; expiresAt: number; baseRevision: number; fileFingerprint: string | null; parsed: Parsed; committed: boolean };
type Header = { row: number; columns: Map<string, number>; sheet: XLSX.WorkSheet; sheetName: string; range: XLSX.Range };

function fail(message: string): never { throw new Error(message); }

function cleanText(value: unknown, maximum: number, allowNull = false): string | null {
    if (allowNull && value === null) return null;
    if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
        return fail('The audit contains text that is too long or invalid. Shorten the affected field and upload again.');
    }
    return value;
}

function cloneRow(row: ExcelAuditRow): ExcelAuditRow { return { ...row, attributes: { ...row.attributes } }; }

function publicRows(input: unknown): ExcelAuditRow[] {
    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ROWS) fail('The saved Excel audit is invalid. Upload the workbook again.');
    const ids = new Set<string>();
    return input.map((row: any) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) fail('The saved Excel audit is invalid. Upload the workbook again.');
        const id = cleanText(row.id, 256)!;
        if (!id.trim() || ids.has(id) || !Number.isSafeInteger(row.sourceRow) || row.sourceRow < 1) {
            fail('The saved Excel audit is invalid. Upload the workbook again.');
        }
        ids.add(id);
        const attributes: Record<string, string | null> = {};
        if (!row.attributes || typeof row.attributes !== 'object' || Array.isArray(row.attributes)) {
            fail('The saved Excel audit is invalid. Upload the workbook again.');
        }
        for (const key of ATTRIBUTE_KEYS) {
            if (Object.prototype.hasOwnProperty.call(row.attributes, key)) attributes[key] = cleanText(row.attributes[key], 2_000, true);
        }
        const quantity = row.countedQuantity;
        const mrp = row.mrp;
        if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000_000)
            || mrp !== null && (typeof mrp !== 'number' || !Number.isFinite(mrp) || mrp < 0 || mrp > 1_000_000_000)) {
            fail('The saved Excel audit is invalid. Upload the workbook again.');
        }
        const name = cleanText(row.name, 1_000)!;
        if (!name.trim()) fail('The saved Excel audit is invalid. Upload the workbook again.');
        return {
            id, sourceRow: row.sourceRow, name,
            barcode: cleanText(row.barcode, 256, true), size: cleanText(row.size, 256, true),
            category: cleanText(row.category, 1_000, true), brand: cleanText(row.brand, 1_000, true),
            mrp, countedQuantity: quantity, attributes, lastUpdated: cleanText(row.lastUpdated, 2_000, true),
        };
    });
}

function summarize(source: Parsed | Snapshot | null): ExcelAuditStatus {
    if (!source) return {
        imported: false, fileName: null, sheetName: null, importedAt: null, fileHash: null,
        rowCount: 0, countedRows: 0, uncountedRows: 0, totalQuantity: 0,
    };
    const countedRows = source.rows.filter(row => row.countedQuantity !== null).length;
    return {
        imported: 'importedAt' in source, fileName: source.fileName, sheetName: source.sheetName,
        importedAt: 'importedAt' in source ? source.importedAt : null, fileHash: source.fileHash,
        rowCount: source.rows.length, countedRows, uncountedRows: source.rows.length - countedRows,
        totalQuantity: source.rows.reduce((total, row) => total + (row.countedQuantity ?? 0), 0),
    };
}

function formulaGuard(cell: XLSX.CellObject | undefined, sourceRow: number, field: string) {
    if (cell?.f || cell?.F) fail(`Row ${sourceRow} has a formula in ${LABELS[field] ?? field}. Replace formulas with their final values before uploading.`);
    if (cell?.t === 'e') fail(`Row ${sourceRow} has an Excel error in ${LABELS[field] ?? field}. Correct the worksheet before uploading.`);
}

function cellText(cell: XLSX.CellObject | undefined, sourceRow: number, field: string, maximum = 2_000): string | null {
    formulaGuard(cell, sourceRow, field);
    if (!cell || cell.v === undefined || cell.v === null || typeof cell.v === 'string' && !cell.v.trim()) return null;
    let text: string;
    if (typeof cell.v === 'string') text = cell.v.trim();
    else if (typeof cell.v === 'number') {
        if (!Number.isFinite(cell.v)) fail(`Row ${sourceRow} has an invalid ${LABELS[field] ?? field} value.`);
        if (['id', 'barcode'].includes(field) && (!Number.isSafeInteger(cell.v) || cell.v < 0 || String(cell.v).length > 15)) {
            fail(`Row ${sourceRow} needs ${LABELS[field]} stored as text so its digits are preserved.`);
        }
        const displayed = cell.w ?? XLSX.utils.format_cell(cell);
        // Numeric identifiers with a zero-padding format retain the printed zeros.
        text = ['id', 'barcode'].includes(field)
            ? (/^\d+$/.test(displayed) ? displayed : String(cell.v)) : displayed;
    } else if (typeof cell.v === 'boolean') text = String(cell.v);
    else fail(`Row ${sourceRow} has an unsupported ${LABELS[field] ?? field} value.`);
    return cleanText(text, maximum);
}

function cellNumber(cell: XLSX.CellObject | undefined, sourceRow: number, field: 'countedQuantity' | 'mrp'): number | null {
    formulaGuard(cell, sourceRow, field);
    if (!cell || cell.v === undefined || cell.v === null || typeof cell.v === 'string' && !cell.v.trim()) return null;
    let value: number;
    if (typeof cell.v === 'number') value = cell.v;
    else if (typeof cell.v === 'string') {
        let text = cell.v.trim();
        if (field === 'mrp') text = text.replace(/^(?:₹|Rs\.?|INR)\s*/i, '').trim();
        if (text.includes(',')) {
            if (!/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)
                && !/^-?\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?$/.test(text)) {
                fail(`Row ${sourceRow} has an invalid ${LABELS[field]} number.`);
            }
            text = text.replace(/,/g, '');
        }
        if (!/^-?\d+(?:\.\d+)?$/.test(text)) fail(`Row ${sourceRow} has an invalid ${LABELS[field]} number.`);
        value = Number(text);
    } else return fail(`Row ${sourceRow} has an invalid ${LABELS[field]} number.`);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000
        || field === 'countedQuantity' && !Number.isSafeInteger(value)) {
        fail(`Row ${sourceRow} needs ${field === 'countedQuantity' ? 'a whole, non-negative Quantity' : 'a valid, non-negative MRP'}.`);
    }
    return value;
}

function inspectSheet(sheet: XLSX.WorkSheet, sheetName: string): Header | null {
    const reference = sheet['!fullref'] ?? sheet['!ref'];
    if (!reference) return null;
    let range: XLSX.Range;
    try { range = XLSX.utils.decode_range(reference); } catch { return fail('The workbook has an invalid worksheet range. Export it again as Excel.'); }
    if (range.e.c >= MAX_COLUMNS || range.e.r >= MAX_ROWS + MAX_HEADER_ROWS + 1) {
        fail('The audit is too large. Use at most 20,000 rows and 64 columns, and remove unused worksheet rows or columns.');
    }
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + MAX_HEADER_ROWS - 1); row++) {
        const columns = new Map<string, number>();
        let duplicate = false;
        for (let column = range.s.c; column <= range.e.c; column++) {
            const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
            if (!cell || typeof cell.v !== 'string') continue;
            const field = HEADERS.get(normalize(cell.v));
            if (!field) continue;
            if (columns.has(field)) duplicate = true;
            columns.set(field, column);
        }
        if (columns.has('countedQuantity') && (columns.has('name') || columns.has('category'))) {
            if (duplicate) fail('The audit has two columns for the same field. Keep one Quantity, ID, Name, and MRP column each.');
            for (const [field, column] of columns) formulaGuard(sheet[XLSX.utils.encode_cell({ r: row, c: column })], row + 1, field);
            return { row, columns, sheet, sheetName, range };
        }
    }
    return null;
}

function parseUpload(input: ExcelAuditUploadInput): { parsed: Parsed; warnings: string[] } {
    if (!input || typeof input.fileName !== 'string') fail('Choose an Excel stock audit workbook.');
    const fileName = input.fileName.split(/[\\/]/).pop()!.trim();
    if (!fileName || fileName.length > 255 || /[\u0000-\u001f]/.test(fileName) || !/\.(xlsx|xls)$/i.test(fileName)) {
        fail('Choose an Excel workbook with an .xlsx or .xls extension.');
    }
    const bytes = input.bytes;
    if (!bytes || !ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1
        || bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
        fail('The Excel workbook must contain data and be no larger than 10 MB.');
    }
    const buffer = Buffer.from(bytes);
    const isZip = buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const isOle = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    if (!isZip && !isOle) fail('This file is not a supported Excel workbook. Save or export the audit as .xlsx and try again.');
    let workbook: XLSX.WorkBook;
    try {
        workbook = XLSX.read(buffer, {
            type: 'buffer', cellFormula: true, cellDates: false, cellNF: true, cellText: true,
            cellHTML: false, bookVBA: false, sheetRows: MAX_ROWS + MAX_HEADER_ROWS + 1,
        });
    } catch {
        return fail('The Excel workbook could not be read. Open it in Excel and save a fresh .xlsx copy, then try again.');
    }
    if (!workbook.SheetNames.length || workbook.SheetNames.length > 32) fail('Use one Stock Audit worksheet and an optional Summary worksheet.');
    const candidates: Header[] = [];
    for (const sheetName of workbook.SheetNames) {
        if (ignoredSheet(sheetName)) continue;
        const sheet = workbook.Sheets[sheetName];
        const header = inspectSheet(sheet, sheetName);
        if (header) candidates.push(header);
        else if (Object.entries(sheet ?? {}).some(([key, cell]) => !key.startsWith('!')
            && cell && (cell.f || cell.F || cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== ''))) {
            fail('An additional data worksheet does not match the stock audit format. Keep audit rows in one Stock Audit worksheet.');
        }
    }
    if (candidates.length > 1) fail('The workbook contains more than one audit worksheet. Combine the audit rows into one Stock Audit worksheet before uploading.');
    if (!candidates.length) fail('No stock audit worksheet was found. Include Quantity and either Category or Name columns.');
    const header = candidates.find(item => normalize(item.sheetName) === 'stockaudit') ?? candidates[0];
    const rows: ExcelAuditRow[] = [];
    const ids = new Set<string>();
    let fallbackIds = 0;
    const sheetIdentity = createHash('sha256').update(header.sheetName).digest('hex').slice(0, 12);
    const getCell = (row: number, field: string): XLSX.CellObject | undefined => {
        const column = header.columns.get(field);
        return column === undefined ? undefined : header.sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    };
    for (let index = header.row + 1; index <= header.range.e.r; index++) {
        if (![...header.columns.keys()].some(field => {
            const cell = getCell(index, field);
            return cell && (cell.f || cell.F || cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '');
        })) continue;
        const sourceRow = index + 1;
        for (const field of header.columns.keys()) formulaGuard(getCell(index, field), sourceRow, field);
        const suppliedId = cellText(getCell(index, 'id'), sourceRow, 'id', 256);
        const id = suppliedId ?? `excel-row-${sheetIdentity}-${sourceRow}`;
        if (!suppliedId) fallbackIds++;
        if (ids.has(id)) fail(`Row ${sourceRow} repeats an ID. Every audit row needs a different ID.`);
        ids.add(id);
        const category = cellText(getCell(index, 'category'), sourceRow, 'category', 1_000);
        const name = header.columns.has('name') ? cellText(getCell(index, 'name'), sourceRow, 'name', 1_000) : category;
        if (!name) fail(`Row ${sourceRow} needs ${header.columns.has('name') ? 'a Name' : 'a Category'}.`);
        const attributes: Record<string, string | null> = {};
        for (const key of ATTRIBUTE_KEYS) {
            if (header.columns.has(key)) attributes[key] = cellText(getCell(index, key), sourceRow, key);
        }
        rows.push({
            id, sourceRow, name, category, attributes,
            barcode: cellText(getCell(index, 'barcode'), sourceRow, 'barcode', 256),
            size: cellText(getCell(index, 'size'), sourceRow, 'size', 256),
            brand: cellText(getCell(index, 'brand'), sourceRow, 'brand', 1_000),
            mrp: cellNumber(getCell(index, 'mrp'), sourceRow, 'mrp'),
            countedQuantity: cellNumber(getCell(index, 'countedQuantity'), sourceRow, 'countedQuantity'),
            lastUpdated: cellText(getCell(index, 'lastUpdated'), sourceRow, 'lastUpdated'),
        });
        if (rows.length > MAX_ROWS) fail('The audit contains more than 20,000 rows. Split it before uploading.');
    }
    if (!rows.length) fail('The stock audit worksheet has no item rows. Add the audited items and upload again.');
    const warnings: string[] = [];
    if (!header.columns.has('name')) warnings.push('Category is used as the item name because the workbook has no Name column.');
    if (fallbackIds) warnings.push(`${fallbackIds} row(s) have no ID. They use worksheet row IDs; keep stable IDs in future exports.`);
    const uncounted = rows.filter(row => row.countedQuantity === null).length;
    if (uncounted) warnings.push(`${uncounted} row(s) have a blank Quantity and remain uncounted. A blank count is not zero.`);
    if (workbook.SheetNames.some(ignoredSheet)) warnings.push('Summary and instruction worksheets are ignored; only audit item rows are imported.');
    warnings.push('Uploaded counts are audit observations. This upload does not change shop stock or create count drafts.');
    return {
        parsed: { fileName, sheetName: header.sheetName, fileHash: createHash('sha256').update(buffer).digest('hex'), rows }, warnings,
    };
}

/** Local Excel observations only: no Prisma, inventory writes, network calls, or remote credentials. */
export function createExcelAuditService(options: { filePath: string; now?: () => Date }) {
    const now = options.now ?? (() => new Date());
    let snapshot: Snapshot | null = null;
    let initializePromise: Promise<ExcelAuditStatus> | null = null;
    let loadError: string | null = null;
    let persistedFingerprint: string | null = null;
    let mutations: Promise<unknown> = Promise.resolve();
    const reviews = new Map<string, Review>();
    const status = () => {
        if (loadError) fail(loadError);
        return summarize(snapshot);
    };

    function mutate<T>(operation: () => Promise<T> | T): Promise<T> {
        const result = mutations.then(operation, operation);
        mutations = result.then(() => undefined, () => undefined);
        return result;
    }

    async function diskState(): Promise<{ fingerprint: string | null; bytes: Buffer | null }> {
        try {
            const info = await fs.stat(options.filePath);
            if (!info.isFile()) throw new Error();
            if (info.size > MAX_STATE_BYTES) {
                // An oversized corrupt file can still be replaced deliberately without reading it into memory.
                return { fingerprint: `oversize:${info.size}:${info.mtimeMs}:${info.ctimeMs}`, bytes: null };
            }
            const bytes = await fs.readFile(options.filePath);
            return { fingerprint: createHash('sha256').update(bytes).digest('hex'), bytes };
        } catch (error: any) {
            if (error?.code === 'ENOENT') return { fingerprint: null, bytes: null };
            return fail('The saved Excel audit file could not be read. Check its file access and try again.');
        }
    }

    async function initialize(): Promise<ExcelAuditStatus> {
        if (initializePromise) return initializePromise;
        initializePromise = mutate(async () => {
            try {
                const stored = await diskState();
                persistedFingerprint = stored.fingerprint;
                if (stored.fingerprint === null) return status();
                if (!stored.bytes || stored.bytes.length === 0 || stored.bytes.length > MAX_STATE_BYTES) throw new Error();
                const raw = stored.bytes.toString('utf8');
                const saved = JSON.parse(raw);
                if (saved?.version !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 1
                    || typeof saved.fileHash !== 'string' || !/^[a-f0-9]{64}$/.test(saved.fileHash)
                    || typeof saved.importedAt !== 'string' || !Number.isFinite(Date.parse(saved.importedAt))) throw new Error();
                snapshot = {
                    version: 1, revision: saved.revision, fileHash: saved.fileHash,
                    fileName: cleanText(saved.fileName, 255)!, sheetName: cleanText(saved.sheetName, 128)!,
                    importedAt: saved.importedAt, rows: publicRows(saved.rows),
                };
                return status();
            } catch (error: any) {
                loadError = 'The saved Excel audit could not be opened. Its file has been kept. Upload and review a fresh workbook to replace it.';
                return fail(loadError);
            }
        });
        return initializePromise;
    }

    function list(input: ExcelAuditListInput = {}): ExcelAuditListResult {
        const search = typeof input.search === 'string' ? input.search.trim().slice(0, 200).toLocaleLowerCase() : '';
        const pageSize = Number.isFinite(input.pageSize) ? Math.max(1, Math.min(200, Math.floor(input.pageSize!))) : 50;
        const rows = snapshot?.rows ?? [];
        const matching = search ? rows.filter(row => [row.id, row.name, row.barcode, row.size, row.category, row.brand,
            ...Object.values(row.attributes)].some(value => value?.toLocaleLowerCase().includes(search))) : rows;
        const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
        const page = Number.isFinite(input.page) ? Math.max(1, Math.min(totalPages, Math.floor(input.page!))) : 1;
        return {
            items: matching.slice((page - 1) * pageSize, page * pageSize).map(cloneRow), totalMatching: matching.length,
            page, pageSize, totalPages, status: status(),
        };
    }

    /** Main-process-only selection for catalogue preparation. Counts never come from the renderer. */
    function resolveRows(fileHash: string, rowIds: string[]): { rows: ExcelAuditRow[]; fileName: string } {
        status();
        if (!snapshot || snapshot.fileHash !== fileHash) fail('The uploaded audit changed. Reload it and select the style again.');
        if (!Array.isArray(rowIds) || rowIds.length < 1 || rowIds.length > 100
            || rowIds.some(id => typeof id !== 'string' || !id) || new Set(rowIds).size !== rowIds.length) {
            fail('Select between 1 and 100 distinct audit rows for one style.');
        }
        const byId = new Map(snapshot.rows.map(row => [row.id, row]));
        const rows = rowIds.map(id => {
            const row = byId.get(id);
            if (!row) return fail('An audit row is no longer available. Reload the saved audit.');
            return cloneRow(row);
        });
        return { rows, fileName: snapshot.fileName };
    }

    function checkOwner(owner: string) {
        if (typeof owner !== 'string' || !owner.trim() || owner.length > 256 || /[\u0000-\u001f]/.test(owner)) {
            fail('Sign in again before reviewing or importing an Excel audit.');
        }
    }

    function pruneReviews() {
        const current = now().getTime();
        for (const [token, review] of reviews) if (review.expiresAt <= current) reviews.delete(token);
    }

    async function preview(input: ExcelAuditUploadInput, owner: string): Promise<ExcelAuditPreview> {
        checkOwner(owner);
        // An explicit reviewed upload can replace an unreadable old inbox; startup never does.
        await initialize().catch(() => undefined);
        const { parsed, warnings } = parseUpload(input);
        return mutate(async () => {
            const stored = await diskState();
            pruneReviews();
            while (reviews.size >= MAX_TOKENS) reviews.delete(reviews.keys().next().value!);
            const token = randomBytes(32).toString('hex');
            reviews.set(token, {
                owner, expiresAt: now().getTime() + TOKEN_TTL_MS, baseRevision: snapshot?.revision ?? 0,
                fileFingerprint: stored.fingerprint, parsed, committed: false,
            });
            const alreadyImported = !loadError && stored.fingerprint === persistedFingerprint && snapshot?.fileHash === parsed.fileHash;
            const replacesExisting = (!!snapshot || stored.fingerprint !== null) && !alreadyImported;
            if (replacesExisting) warnings.unshift('Importing this workbook replaces the entire previous Excel audit inbox. It does not add rows to the old upload.');
            if (alreadyImported) warnings.unshift('This exact workbook is already imported. Importing it again will not duplicate rows.');
            return { token, status: summarize(parsed), items: parsed.rows.slice(0, PREVIEW_ROWS).map(cloneRow), warnings, alreadyImported, replacesExisting };
        });
    }

    async function persist(next: Snapshot): Promise<string> {
        const body = JSON.stringify(next);
        if (Buffer.byteLength(body, 'utf8') > MAX_STATE_BYTES) fail('The imported audit is too large to save. Reduce long attribute text and upload again.');
        await fs.mkdir(path.dirname(options.filePath), { recursive: true });
        const temporary = `${options.filePath}.${randomBytes(12).toString('hex')}.tmp`;
        try {
            await fs.writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
            await fs.rename(temporary, options.filePath);
        } finally { await fs.unlink(temporary).catch(() => undefined); }
        return createHash('sha256').update(body).digest('hex');
    }

    async function commit(token: string, owner: string): Promise<ExcelAuditStatus> {
        checkOwner(owner);
        await initialize().catch(() => undefined);
        return mutate(async () => {
            pruneReviews();
            const review = typeof token === 'string' ? reviews.get(token) : undefined;
            if (!review || review.owner !== owner) fail('This audit preview is unavailable or expired. Upload the workbook again and review it before importing.');
            const stored = await diskState();
            if (stored.fingerprint !== review.fileFingerprint) fail('The saved Excel audit file changed after this preview. Upload the workbook again before replacing it.');
            if (review.committed && snapshot?.fileHash === review.parsed.fileHash) return status();
            if (review.baseRevision !== (snapshot?.revision ?? 0)) fail('The Excel audit changed after this preview. Upload the workbook again to review the latest replacement.');
            if (!loadError && stored.fingerprint === persistedFingerprint && snapshot?.fileHash === review.parsed.fileHash) {
                review.committed = true;
                return status();
            }
            const next: Snapshot = {
                version: 1, revision: (snapshot?.revision ?? 0) + 1, ...review.parsed,
                importedAt: now().toISOString(), rows: review.parsed.rows.map(cloneRow),
            };
            try { persistedFingerprint = await persist(next); } catch {
                return fail('The Excel audit could not be saved. The previous inbox has been kept. Try importing the reviewed workbook again.');
            }
            snapshot = next;
            loadError = null;
            initializePromise = Promise.resolve(status());
            review.committed = true;
            review.baseRevision = next.revision;
            review.fileFingerprint = persistedFingerprint;
            return status();
        });
    }

    return { initialize, status, list, preview, commit, resolveRows };
}

export type ExcelAuditService = ReturnType<typeof createExcelAuditService>;
