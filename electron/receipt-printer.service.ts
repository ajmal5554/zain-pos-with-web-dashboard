// One attempt only: a timeout does not prove the spooler rejected the job.
export async function sendReceipt(BrowserWindow: any, data: any) {
    let window: any;
    const stage = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
        let timer: ReturnType<typeof setTimeout>;
        try {
            return await Promise.race([action(), new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`Receipt stopped while ${name}. No print job was submitted. Check the Windows printer driver and restart the app.`)), 10000);
            })]);
        } finally { clearTimeout(timer!); }
    };
    try {
        const html = typeof data === 'string' ? data : data?.html;
        if (typeof html !== 'string' || !html.trim()) throw new Error('Receipt content is empty.');
        const name = typeof data?.options?.deviceName === 'string' ? data.options.deviceName.trim() : '';
        if (!name) throw new Error('Select and save a receipt printer in Settings → Printing.');
        window = new BrowserWindow({ show: false, width: 302, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
        const printers = await stage<any[]>('detecting Windows printers', () => window.webContents.getPrintersAsync());
        if (!printers.some((printer: any) => printer.name === name)) throw new Error(`Receipt printer "${name}" is not installed. Refresh printers in Settings and select its Windows name.`);
        await stage('loading the receipt', () => window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`));
        // DOM/images are ready after loadURL. Do not wait indefinitely for fonts in a hidden window.
        return await new Promise<{ success: boolean; error?: string }>(resolve => {
            let settled = false;
            const finish = (result: { success: boolean; error?: string }) => {
                if (settled) return;
                settled = true; clearTimeout(timer); resolve(result);
            };
            const timer = setTimeout(() => finish({ success: false, error: 'Windows has not confirmed the print job. Check the printer queue before retrying to avoid duplicate receipts.' }), 30000);
            try {
                // Preserve the thermal driver's established paper/feed settings.
                // Measuring the hidden viewport as a page introduced blank feed and scaling.
                window.webContents.print({ silent: true, deviceName: name, printBackground: true, margins: { marginType: 'none' } },
                    (success: boolean, reason: string) => finish(success ? { success: true } : { success: false, error: `Receipt printer "${name}": ${reason || 'Windows rejected the print job.'}` }));
            } catch (error) { finish({ success: false, error: error instanceof Error ? error.message : 'Receipt print failed.' }); }
        });
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Receipt print failed.' };
    } finally {
        if (window && !window.isDestroyed()) window.close();
    }
}
