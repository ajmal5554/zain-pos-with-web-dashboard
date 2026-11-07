const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { prepare } = require('./prepare-demo-data.cjs');

(async () => {
    await prepare();
    const demoDb = path.resolve(__dirname, '../prisma/pos-demo.db');
    if (!fs.existsSync(demoDb)) throw new Error('The demo database was not created.');
    const vitePackage = path.dirname(require.resolve('vite/package.json'));
    const vite = path.join(vitePackage, 'bin', 'vite.js');
    const child = spawn(process.execPath, [vite], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, ZAIN_POS_DEMO_MODE: '1' },
        stdio: 'inherit',
    });
    child.on('error', (error) => { console.error('Could not start the demo app:', error.message); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 0; });
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
