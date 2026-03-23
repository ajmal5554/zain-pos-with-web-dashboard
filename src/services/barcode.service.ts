import JsBarcode from 'jsbarcode';

export const barcodeService = {
    // Generate a unique barcode for a product variant
    generateBarcode(prefix: string = '46'): string {
        // Generate 13-digit EAN barcode
        const timestamp = Date.now().toString().slice(-8);
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        const code = prefix + timestamp + random;

        // Calculate EAN-13 checksum
        const checksum = this.calculateEAN13Checksum(code.slice(0, 12));
        return code.slice(0, 12) + checksum;
    },

    // Calculate EAN-13 checksum digit
    calculateEAN13Checksum(code: string): string {
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            const digit = parseInt(code[i]);
            sum += i % 2 === 0 ? digit : digit * 3;
        }
        const checksum = (10 - (sum % 10)) % 10;
        return checksum.toString();
    },

    // Generate barcode image as base64
    generateBarcodeImage(code: string, format: 'CODE128' | 'EAN13' = 'CODE128'): string {
        const canvas = document.createElement('canvas');

        try {
            JsBarcode(canvas, code, {
                format: format,
                width: 2,
                height: 50,
                displayValue: true,
                fontSize: 14,
                margin: 5,
            });

            return canvas.toDataURL('image/png');
        } catch (error) {
            console.error('Barcode generation error:', error);
            throw new Error('Failed to generate barcode');
        }
    },

    // Validate barcode format
    validateBarcode(code: string, format: 'CODE128' | 'EAN13' = 'CODE128'): boolean {
        if (format === 'EAN13') {
            if (code.length !== 13) return false;
            const checksum = this.calculateEAN13Checksum(code.slice(0, 12));
            return checksum === code[12];
        }

        // CODE128 validation (basic)
        return code.length >= 1 && code.length <= 48;
    },
};
