import XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const migrationDir = 'migration';

function inspectExcel(fileName: string) {
    const filePath = path.join(migrationDir, fileName);
    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${fileName}`);
        return;
    }

    try {
        console.log(`\n📄 Inspecting: ${fileName}`);
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        console.log(`✓ Rows found: ${data.length}`);
        if (data.length > 0) {
            console.log('📋 Column names found:', Object.keys(data[0] as object));
            console.log('📝 First row sample:', JSON.stringify(data[0], null, 2));
        } else {
            console.log('⚠️ Sheet is empty');
        }
    } catch (error: any) {
        console.error(`❌ Error reading ${fileName}:`, error.message);
    }
}

const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.xls') || f.endsWith('.xlsx'));
files.forEach(inspectExcel);
