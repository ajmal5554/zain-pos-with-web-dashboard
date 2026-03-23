import XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const migrationDir = 'migration';

function inspectExcelStructure(fileName: string) {
    const filePath = path.join(migrationDir, fileName);
    if (!fs.existsSync(filePath)) return;

    try {
        console.log(`\n📄 --- ${fileName} ---`);
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to array of arrays to find header row
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        console.log(`Total Rows: ${rows.length}`);

        // Show first 10 rows to find header
        console.log('Top 10 Rows:');
        rows.slice(0, 10).forEach((row, i) => {
            console.log(`Row ${i}:`, JSON.stringify(row));
        });
    } catch (error: any) {
        console.error(`❌ Error scanning ${fileName}:`, error.message);
    }
}

const files = ['Report_Item_Detail_AllItem.xls', 'Report_Sales_Detail.xls'];
files.forEach(inspectExcelStructure);
