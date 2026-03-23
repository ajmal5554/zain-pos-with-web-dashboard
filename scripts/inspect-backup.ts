// @ts-ignore
import sql from 'mssql';

const BACKUP_PATH = "G:\\MaxSell\\Release\\BackUp\\Maxsll22_zain_02_02_2023.bak";

const config = {
    server: 'localhost\\SQLEXPRESS',
    database: 'master',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        trustedConnection: true, // Try Windows Authentication first
        enableArithAbort: true
    }
};

async function inspectBackup() {
    try {
        console.log('Connecting to database...');
        const pool = await sql.connect(config);
        console.log('Connected.');

        console.log(`Inspecting backup file: ${BACKUP_PATH}`);

        const result = await pool.request().query(`
            RESTORE FILELISTONLY 
            FROM DISK = '${BACKUP_PATH}'
        `);

        console.log('\n--- Backup File Contents ---');
        console.table(result.recordset);

        console.log('\nLogical Names needed for Restore:');
        result.recordset.forEach((row: any) => {
            console.log(`- Type: ${row.Type}, LogicalName: ${row.LogicalName}, PhysicalName: ${row.PhysicalName}`);
        });

        await pool.close();
    } catch (err: any) {
        console.error('Error:', err.message);
        // If login failed, warn user
        if (err.message.includes('Login failed')) {
            console.error('\nHint: Windows Authentication failed. You might need to edit this script to use "sa" user explicitly.');
        }
    }
}

inspectBackup();
