import XLSX from 'xlsx';
import * as path from 'path';

const migrationDir = path.join(process.cwd(), 'migration');
const salesFile = path.join(migrationDir, 'Report_Sales_Detail.xls');

console.log('📖 Analyzing Excel Structure\n');

const workbook = XLSX.readFile(salesFile);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

console.log(`Total Rows: ${rawData.length}\n`);
console.log('First 50 rows:\n');

for (let i = 0; i < Math.min(50, rawData.length); i++) {
    const row = rawData[i];
    console.log(`Row ${i + 1}:`, JSON.stringify(row));
}

console.log('\n\nLooking for invoice patterns...\n');

for (let i = 0; i < Math.min(200, rawData.length); i++) {
    const row = rawData[i];
    const rowStr = JSON.stringify(row);

    if (rowStr.includes('Invoice') || rowStr.includes('invoice')) {
        console.log(`Row ${i + 1} (Invoice):`, row);
    }
}
