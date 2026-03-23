import * as XLSX from 'xlsx';

const file = 'migration/Report_Sales_Detail.xls';
console.log(`📖 Reading: ${file}`);

const workbook = XLSX.readFile(file);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

console.log(`  Total rows: ${rawData.length}`);

let invoiceCount = 0;
let potentialInvoiceRows: number[] = [];

for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    // Check for various indicators of an invoice start
    if (row) {
        const rowStr = JSON.stringify(row);
        if (rowStr.includes('Invoice No/Date')) {
            invoiceCount++;
            potentialInvoiceRows.push(i);
        }
    }
}

const output = `
Analysis Results:
  Total "Invoice No/Date" found: ${invoiceCount}
  First 5 rows with invoice headers: ${potentialInvoiceRows.slice(0, 5).join(', ')}
  Last 5 rows with invoice headers: ${potentialInvoiceRows.slice(-5).join(', ')}
`;

const fs = require('fs');
fs.writeFileSync('migration/invoice-count.txt', output);
console.log('✅ Results written to migration/invoice-count.txt');

// Check row spacing
if (potentialInvoiceRows.length > 1) {
    const spacers = [];
    for (let i = 1; i < Math.min(20, potentialInvoiceRows.length); i++) {
        spacers.push(potentialInvoiceRows[i] - potentialInvoiceRows[i - 1]);
    }
    console.log(`  Typical row spacing: ${spacers.join(', ')}`);
}
