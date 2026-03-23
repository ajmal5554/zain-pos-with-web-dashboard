import * as XLSX from 'xlsx';
import * as fs from 'fs';

const files = [
    'migration/Report_Item_Detail_AllItem.xls',
    'migration/Report_Item_Detail_Pricelist_All_GroupwiseBrandwise_with_Option.xls',
    'migration/Report_Sales_Detail.xls'
];

console.log('📊 Inspecting Excel Files\n');

files.forEach(file => {
    if (!fs.existsSync(file)) {
        console.log(`❌ File not found: ${file}\n`);
        return;
    }

    console.log(`\n📄 ${file}`);
    console.log('='.repeat(80));

    const workbook = XLSX.readFile(file);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    console.log(`Sheet: ${sheetName}`);
    console.log(`Total Rows: ${data.length}`);

    if (data.length > 0) {
        console.log(`\nColumns (Header Row):`);
        const headers = data[0] as any[];
        headers.forEach((header, index) => {
            console.log(`  ${index + 1}. ${header}`);
        });

        console.log(`\nSample Data (First 3 rows):`);
        data.slice(0, 4).forEach((row, index) => {
            console.log(`Row ${index}:`, row);
        });
    }
    console.log('\n');
});
