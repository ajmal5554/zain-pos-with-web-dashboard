import React, { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { Modal } from './Modal';
import { Button } from './Button';
import { formatIndianCurrency } from '../../lib/format';
import { db } from '../../lib/db';
import { ChevronDown, ChevronUp, Settings } from 'lucide-react';
import { showToast } from './Toast';
import { escapeHtml } from '../../lib/catalogueDescription';
import { useAuthStore } from '../../store/authStore';

import { DEFAULT_LABEL_LAYOUT, DEFAULT_STICKER_CONFIG as DEFAULT_PRINT_CONFIG, restoreLegacyLabelCode, validateStickerConfig, labelOverflow } from '../../lib/labelTemplate';
import type { LabelBlock } from '../../lib/labelTemplate';
export type { LabelBlock } from '../../lib/labelTemplate';
import { LabelStickerPreview } from './LabelStickerPreview';
interface StickerPrintModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: any;
    variant: any;
}

export const StickerPrintModal: React.FC<StickerPrintModalProps> = ({
    isOpen,
    onClose,
    product,
    variant,
}) => {
    // Barcode rendering tuned for thermal label scanners:
    // add quiet zone and avoid ultra-thin bars that fail intermittently.
    const BARCODE_MODULE_WIDTH = 1.4;
    const BARCODE_QUIET_MARGIN = 6;

    const [quantity, setQuantity] = useState<number | ''>(1);
    const [layout, setLayout] = useState<LabelBlock[]>(DEFAULT_LABEL_LAYOUT);
    const [shopSettings, setShopSettings] = useState<any>({ shopName: 'Zain POS' });
    const [showConfig, setShowConfig] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);
    const [settingsLoading, setSettingsLoading] = useState(true);
    const [settingsError, setSettingsError] = useState('');
    const printing = useRef(false);
    const settingsLoadId = useRef(0);
    const { user } = useAuthStore();
    const canPrintLabels = user?.role === 'ADMIN' || Boolean(user?.permPrintSticker);

    // Print Configuration State (Defaults updated to match user's physical configuration)
    const [config, setConfig] = useState(DEFAULT_PRINT_CONFIG);




    useEffect(() => {
        if (isOpen) {
            setQuantity(1);
            loadSettings();
        }
        return () => { settingsLoadId.current++; };
    }, [isOpen, variant?.id]);

    // Load saved settings
    const loadSettings = async () => {
        const loadId = ++settingsLoadId.current;
        setSettingsLoading(true);
        setSettingsError('');
        try {
            const [layoutResult, shopResult, configResult] = await Promise.all([
                db.settings.findUnique({ where: { key: 'LABEL_LAYOUT' } }),
                db.settings.findUnique({ where: { key: 'SHOP_SETTINGS' } }),
                db.settings.findUnique({ where: { key: 'STICKER_PRINT_CONFIG' } })
            ]);

            const nextLayout = restoreLegacyLabelCode(layoutResult?.value ? JSON.parse(layoutResult.value) : DEFAULT_LABEL_LAYOUT);
            const nextShop = shopResult?.value ? JSON.parse(shopResult.value) : { shopName: 'Zain POS' };
            const savedConfig = validateStickerConfig(configResult?.value ? JSON.parse(configResult.value) : DEFAULT_PRINT_CONFIG);
            if (!Array.isArray(nextLayout) || nextLayout.some(block => !block || typeof block.type !== 'string' || !block.styles) ||
                !nextShop || typeof nextShop !== 'object' || Array.isArray(nextShop) ||
                !savedConfig || typeof savedConfig !== 'object' || Array.isArray(savedConfig)) {
                throw new Error('Saved label settings are invalid. Check printer settings and retry.');
            }
            if (loadId !== settingsLoadId.current) return;
            setLayout(nextLayout);
            setShopSettings(nextShop);
            setConfig({ ...DEFAULT_PRINT_CONFIG, ...savedConfig });
        } catch (error) {
            if (loadId !== settingsLoadId.current) return;
            console.error('Failed to load settings:', error);
            setSettingsError((error as Error).message || 'Could not load saved label settings.');
        } finally {
            if (loadId === settingsLoadId.current) setSettingsLoading(false);
        }
    };

    const createBarcodeSvgMarkup = (code: string, height: number) => {
        try {
            const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            JsBarcode(svgEl, code, {
                format: 'CODE128',
                width: BARCODE_MODULE_WIDTH,
                height,
                displayValue: false,
                margin: BARCODE_QUIET_MARGIN,
                lineColor: '#000000',
                background: '#ffffff'
            });
            return new XMLSerializer().serializeToString(svgEl);
        } catch (error) {
            console.error('Failed to build barcode markup:', error);
            return '';
        }
    };

    const handlePrint = async () => {
        if (printing.current) return;
        if (settingsLoading || settingsError) {
            showToast(settingsError || 'Wait for saved label settings to load before printing.', 'error');
            return;
        }
        if (!canPrintLabels) {
            showToast('Permission denied: you cannot print labels.', 'warning');
            return;
        }
        if (!product?.id || !variant?.id || variant.id.startsWith('temp-') || !(variant.barcode || variant.sku)) {
            showToast('Save this variant with a unique code before printing labels.', 'warning');
            return;
        }
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
            showToast('Enter a whole number of labels from 1 to 100.', 'error');
            return;
        }
        if (!Number.isInteger(config.perRow) || config.perRow < 1 || config.perRow > 10 ||
            !Number.isFinite(config.width) || config.width <= 0 ||
            !Number.isFinite(config.height) || config.height <= 0 ||
            !Number.isFinite(config.contentScale) || config.contentScale <= 0) {
            showToast('Printer calibration is invalid. Check label settings before printing.', 'error');
            return;
        }
        printing.current = true;
        setIsPrinting(true);
        try {
        let labelPrinterName: string | undefined;
        try {
            const printerSetting = await db.settings.findUnique({ where: { key: 'PRINTER_CONFIG' } });
            if (printerSetting?.value) {
                const parsed = JSON.parse(printerSetting.value);
                if (parsed?.labelPrinter && typeof parsed.labelPrinter === 'string') {
                    labelPrinterName = parsed.labelPrinter.trim();
                }
            }
        } catch (error) {
            console.error('Failed to load printer config for label print:', error);
        }

        const safeQuantity = quantity;
        const safeMarginLeft = Math.max(0, Number(config.marginLeft) || 0);
        const safeMarginTop = Math.max(0, Number(config.marginTop) || 0);
        const rowDelayMs = Math.max(300, Number((config as any).rowDelayMs) || 1200);
        const rowCount = Math.ceil(safeQuantity / config.perRow);
        const rowPitchMm = config.height;
        const sheetWidthMm = (config.width * config.perRow) + (config.gapX * (config.perRow - 1));
        const pageWidthMm = sheetWidthMm + safeMarginLeft;
        const pageHeightMm = rowPitchMm + safeMarginTop;

        const buildStickerHtml = () => {
            const blocksHTML = layout.map(block => {
                if (!block.visible) return '';

                const style = `
                    text-align: ${block.styles.align || 'center'};
                    font-size: ${block.styles.fontSize || 10}pt;
                    font-weight: ${block.styles.bold ? 'bold' : 'normal'};
                    margin-top: ${block.styles.marginTop || 0}px;
                    margin-bottom: ${block.styles.marginBottom || 0}px;
                    line-height: 1.1;
                    white-space: nowrap;
                    overflow: hidden;
                `;

                switch (block.type) {
                    case 'shop_name':
                        return `<div style="${style}">${escapeHtml(block.content || shopSettings.shopName || '')}</div>`;
                    case 'product_name': {
                        return `<div style="${style}">${escapeHtml(String(block.content || product.name))}</div>`;
                    }
                    case 'price':
                        return `<div style="${style}">MRP: ${formatIndianCurrency(variant.mrp)}</div>`;
                    case 'barcode':
                        const barcodeMarkup = createBarcodeSvgMarkup(
                            String(variant.barcode || variant.sku || ''),
                            block.styles.height || 30
                        );
                        return `<div style="${style} display: flex; justify-content: ${block.styles.align || 'center'};">
                                    ${barcodeMarkup || `<div style="font-size:8pt;">${escapeHtml(String(variant.barcode || variant.sku || ''))}</div>`}
                                </div>`;
                    case 'text':
                        return `<div style="${style}">${escapeHtml(block.content || '')}</div>`;
                    case 'product_code':
                        return `<div style="${style}">${escapeHtml(String(variant.barcode || variant.sku || ''))}</div>`;
                    case 'meta_row':
                        return `<div style="${style} display: flex; justify-content: space-between;">
                                    <span>${escapeHtml(String(variant.barcode || variant.sku || ''))}</span>
                                    <span>${formatIndianCurrency(variant.sellingPrice)}</span>
                                </div>`;
                    case 'divider':
                        return `<div style="border-top: 1px solid black; margin: 2px 0;"></div>`;
                    case 'spacer':
                        return `<div style="height: ${block.styles.height || 10}px"></div>`;
                    default: return '';
                }
            }).join('');

            return `<div class="sticker">
                        <div class="content-wrapper">
                            ${blocksHTML}
                        </div>
                    </div>`;
        };

        try {
            for (let row = 0; row < rowCount; row++) {
                const stickersInThisRow = Math.min(config.perRow, safeQuantity - (row * config.perRow));
                const rowStickers = Array(stickersInThisRow).fill(null).map(() => buildStickerHtml());
                const emptySlots = Math.max(0, config.perRow - stickersInThisRow);
                for (let i = 0; i < emptySlots; i++) {
                    rowStickers.push(`<div class="sticker blank"></div>`);
                }

                const html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Print Stickers - ${escapeHtml(product.name)}</title>
                        <style>
                            @media print {
                                @page {
                                    size: ${pageWidthMm}mm ${pageHeightMm}mm;
                                    margin: 0mm;
                                }
                                body {
                                    margin: 0;
                                    padding: 0;
                                }
                            }
                            html, body {
                                width: ${pageWidthMm}mm;
                                height: ${pageHeightMm}mm;
                                margin: 0;
                                padding: 0;
                                overflow: hidden;
                                background: #fff;
                            }
                            body {
                                font-family: Arial, sans-serif;
                                box-sizing: border-box;
                            }
                            .sheet {
                                width: ${sheetWidthMm}mm;
                                height: ${rowPitchMm}mm;
                                display: grid;
                                grid-template-columns: repeat(${config.perRow}, ${config.width}mm);
                                grid-auto-rows: ${config.height}mm;
                                column-gap: ${config.gapX}mm;
                                transform: translate(${safeMarginLeft}mm, ${safeMarginTop}mm);
                                transform-origin: top left;
                            }
                            .sticker {
                                width: ${config.width}mm;
                                height: ${config.height}mm;
                                padding: 1mm;
                                box-sizing: border-box;
                                display: block;
                                overflow: hidden;
                                flex-direction: column;
                            }
                            .sticker.blank {
                                visibility: hidden;
                            }
                            .sticker > div {
                                font-size: 10pt;
                            }
                            .content-wrapper svg { max-width: 100%; height: auto; flex-shrink: 1; }
                            .content-wrapper {
                                transform: scale(${config.contentScale / 100});
                                transform-origin: top left;
                                width: ${100 * (100 / config.contentScale)}%;
                                height: ${100 * (100 / config.contentScale)}%;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="sheet">${rowStickers.join('')}</div>
                    </body>
                    </html>
                `;

                const result = await window.electronAPI.print.label({
                    html,
                    variantId: variant.id,
                    productId: product.id,
                    barcode: String(variant.barcode || variant.sku),
                    expectedUpdatedAt: product.updatedAt,
                    options: {
                        pageWidthMm,
                        pageHeightMm,
                        deviceName: labelPrinterName
                    }
                });
                if (!result?.success) {
                    showToast(`Label print failed on row ${row + 1}: ${result?.error || 'Unknown error'}`, 'error');
                    return;
                }

                // Strong pacing delay prevents spooler batching/feed drift on some thermal drivers.
                if (row < rowCount - 1) {
                    await new Promise((resolve) => setTimeout(resolve, rowDelayMs));
                }
            }
            showToast(`Print job completed for ${safeQuantity} sticker${safeQuantity > 1 ? 's' : ''}.`, 'success');
        } catch (error: any) {
            showToast(`Label print failed: ${error?.message || error}`, 'error');
        }
        } finally {
            printing.current = false;
            setIsPrinting(false);
        }
    };

    if (!product || !variant) return null;

    return (
        <Modal isOpen={isOpen} onClose={() => { if (!printing.current) onClose(); }} title="Print Product Sticker">
            <div className="space-y-4">

                <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30">
                    <Settings className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-semibold text-blue-700 uppercase">Printer Calibration: {config.width}x{config.height}mm</span>
                </div>
                {variant.isPrepared && <p className="text-sm text-amber-700 dark:text-amber-300">Preparation/test labels only. Keep selling stock under its current labels until conversion is ready.</p>}
                {settingsLoading && <p role="status" className="text-sm text-gray-500">Loading saved label settings...</p>}
                {settingsError && <div role="alert" className="text-sm text-red-600 dark:text-red-400 space-y-2">
                    <p>{settingsError}</p>
                    <Button variant="secondary" onClick={() => void loadSettings()} disabled={settingsLoading}>Retry loading label settings</Button>
                </div>}

                {/* Preview */}
                {!settingsLoading && !settingsError && <div className="flex justify-center bg-gray-100 dark:bg-gray-900 p-4 rounded overflow-auto">
                    <div className="grid shrink-0" style={{ gridTemplateColumns: `repeat(${config.perRow}, ${config.width}mm)`, columnGap: `${config.gapX}mm`, rowGap: `${config.gapY}mm`, width: `${config.width * config.perRow + config.gapX * (config.perRow - 1)}mm` }}>
                        {/* Show just enough stickers to visualize the row and gap */}
                        {Array.from({ length: Math.min(config.perRow * 2, 4) }).map((_, i) => (
                            <div
                                key={i}
                                className="bg-white outline outline-1 outline-dashed outline-gray-400 overflow-hidden relative shrink-0"
                                style={{
                                    width: `${config.width}mm`,
                                    height: `${config.height}mm`,
                                    
                                    
                                    padding: 0,
                                    transform: 'scale(1)', // render 1:1 roughly
                                }}
                            >
                                <div className="absolute top-0 right-0 bg-gray-200 text-[8px] px-1 opacity-50">#{i + 1}</div>
                                <LabelStickerPreview blocks={layout} config={config} shopName={shopSettings.shopName} productName={product.name} code={String(variant.barcode || variant.sku || '')} mrp={variant.mrp} sellingPrice={variant.sellingPrice} />
                            </div>
                        ))}
                    </div>
                </div>}

                {labelOverflow(layout, config) && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">This layout may clip the code or price. Open Settings → label designer and use Fit content to height, or reduce barcode/font height.</p>}
                {/* Quantity */}
                <div className="mt-4">
                    <label className="block text-sm font-medium mb-2">Number of Stickers</label>
                    <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="100"
                        step="1"
                        disabled={isPrinting}
                        value={quantity}
                        onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === '') {
                                setQuantity('');
                                return;
                            }
                            const parsed = Number(raw);
                            if (Number.isFinite(parsed)) {
                                setQuantity(parsed);
                            }
                        }}
                        className="w-full px-3 py-2 border rounded-lg"
                    />
                </div>

                {/* Info */}
                <div className="text-xs text-gray-500">
                    <p>Total Print Width: ~{Math.ceil(config.width * config.perRow + config.gapX * (config.perRow - 1) + config.marginLeft)}mm</p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={onClose} disabled={isPrinting}>
                        Cancel
                    </Button>
                    <Button onClick={handlePrint} disabled={isPrinting || !canPrintLabels || settingsLoading || Boolean(settingsError)}>
                        <PrinterIcon className="w-4 h-4 mr-2" />
                        {isPrinting ? 'Printing...' : 'Print Labels'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

function PrinterIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...props}
        >
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2-2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
        </svg>
    );
}
