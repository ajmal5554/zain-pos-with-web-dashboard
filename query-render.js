const axios = require('axios');

async function main() {
    const apiUrl = 'https://zain-pos-with-web-dashboard.onrender.com';
    const username = 'admin';
    const password = 'admin123'; // Seed admin password

    try {
        console.log(`🔑 Logging into cloud API: ${apiUrl} ...`);
        const loginRes = await axios.post(`${apiUrl}/api/auth/login`, { username, password });
        const token = loginRes.data.token;
        console.log('✅ Login successful! Token acquired.');

        console.log('\n📊 Fetching GST Report for July 2026...');
        const startDate = new Date('2026-07-01T00:00:00.000Z').toISOString();
        const endDate = new Date('2026-07-31T23:59:59.999Z').toISOString();
        
        const reportRes = await axios.get(`${apiUrl}/api/reports/gst?startDate=${startDate}&endDate=${endDate}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const report = reportRes.data;
        console.log(`Total Completed Sales: ${report.sales.length}`);
        console.log(`Total Cancelled Invoices: ${report.cancelledInvoices.length}`);
        
        console.log('\nChecking Bill #1858 in report...');
        const inSales = report.sales.find(s => s.billNo === '1858');
        const inCancelled = report.cancelledInvoices.find(s => s.billNo === '1858');
        
        console.log('In Completed Sales:', inSales ? 'YES' : 'NO');
        if (inSales) console.log(JSON.stringify(inSales, null, 2));
        console.log('In Cancelled Invoices:', inCancelled ? 'YES' : 'NO');
        if (inCancelled) console.log(JSON.stringify(inCancelled, null, 2));

        // Let's search all bills in the response
        console.log('\nAll bills in reports.sales:');
        console.log(report.sales.map(s => `Bill #${s.billNo}`).join(', '));
        
        console.log('\nAll bills in reports.cancelledInvoices:');
        console.log(report.cancelledInvoices.map(s => `Bill #${s.billNo} (Status: ${s.status})`).join(', '));

    } catch (e) {
        console.error('❌ Error calling cloud API:', e.message);
        if (e.response) {
            console.error('Response status:', e.response.status);
            console.error('Response data:', e.response.data);
        }
    }
}

main();
