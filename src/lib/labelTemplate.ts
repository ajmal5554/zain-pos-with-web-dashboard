export interface LabelBlock {
    id: string;
    type: 'shop_name' | 'product_name' | 'price' | 'barcode' | 'product_code' | 'meta_row' | 'text' | 'divider' | 'spacer';
    content?: string;
    styles: { align?: 'left' | 'center' | 'right'; fontSize?: number; bold?: boolean; marginTop?: number; marginBottom?: number; height?: number };
    visible: boolean;
}
export const DEFAULT_LABEL_LAYOUT: LabelBlock[] = [
    { id: '1', type: 'shop_name', styles: { align: 'left', fontSize: 10, bold: true, marginBottom: 0 }, visible: true },
    { id: '2', type: 'product_name', styles: { align: 'left', fontSize: 8, bold: false, marginBottom: 2 }, visible: true },
    { id: '3', type: 'barcode', styles: { align: 'left', height: 45, marginBottom: 0 }, visible: true },
    { id: '4', type: 'product_code', styles: { align: 'left', fontSize: 8, bold: false, marginBottom: 0 }, visible: true },
    { id: '5', type: 'price', styles: { align: 'left', fontSize: 12, bold: true, marginBottom: 0 }, visible: true },
];
export const DEFAULT_STICKER_CONFIG = { width: 32, height: 18, perRow: 2, gapX: 2, gapY: 1, marginLeft: 2, marginTop: 0, contentScale: 75, rowDelayMs: 1200 };
export type StickerConfig = typeof DEFAULT_STICKER_CONFIG;
export interface SaveLabelTemplateInput { blocks: LabelBlock[]; config: StickerConfig; expectedLayout: string | null; expectedConfig: string | null }
const types = new Set(DEFAULT_LABEL_LAYOUT.map(block => block.type).concat(['text', 'meta_row', 'divider', 'spacer']));
export function validateLabelLayout(value: unknown): LabelBlock[] {
    if (!Array.isArray(value) || !value.length || value.length > 50) throw new Error('A label needs between 1 and 50 elements.');
    const ids = new Set<string>();
    for (const block of value) {
        if (!block || typeof block.id !== 'string' || !block.id.trim() || ids.has(block.id) || !types.has(block.type) || typeof block.visible !== 'boolean'
            || !block.styles || typeof block.styles !== 'object' || Array.isArray(block.styles) || block.content !== undefined && (typeof block.content !== 'string' || block.content.length > 2000)) throw new Error('Invalid label element or duplicate element ID.');
        ids.add(block.id);
        const style = block.styles;
        if (style.align !== undefined && !['left', 'center', 'right'].includes(style.align) || style.bold !== undefined && typeof style.bold !== 'boolean') throw new Error('Invalid label alignment or font weight.');
        for (const key of ['fontSize', 'height', 'marginTop', 'marginBottom']) {
            const number = style[key];
            if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number) || number < (key === 'fontSize' || key === 'height' ? 1 : 0) || number > 300)) throw new Error('Label sizes and spacing must be valid positive numbers.');
        }
    }
    return JSON.parse(JSON.stringify(value));
}
export function validateStickerConfig(value: unknown): StickerConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid printer calibration.');
    const config = { ...DEFAULT_STICKER_CONFIG, ...value } as StickerConfig;
    for (const [key, min, max] of [['width', 5, 200], ['height', 5, 200], ['perRow', 1, 10], ['gapX', 0, 50], ['gapY', 0, 50], ['marginLeft', 0, 100], ['marginTop', 0, 100], ['contentScale', 10, 200], ['rowDelayMs', 300, 10000]] as const) {
        if (typeof config[key] !== 'number' || !Number.isFinite(config[key]) || config[key] < min || config[key] > max) throw new Error(`Invalid printer calibration: ${key}.`);
    }
    if (!Number.isInteger(config.perRow)) throw new Error('Labels per row must be a whole number.');
    return config;
}
/** Repairs only the recognizable old default; custom text and layouts stay intact. */
export function restoreLegacyLabelCode(value: unknown): LabelBlock[] {
    const blocks = validateLabelLayout(value);
    for (const block of blocks) if (block.id === '4' && block.type === 'text' && block.content === '4649350') {
        block.type = 'product_code'; delete block.content;
    }
    if (blocks.length === 4 && blocks.every((block, index) => block.visible && block.id === ['1', '2', '3', '5'][index] && block.type === ['shop_name', 'product_name', 'barcode', 'price'][index])) {
        blocks.splice(3, 0, JSON.parse(JSON.stringify(DEFAULT_LABEL_LAYOUT[3])));
    }
    return blocks;
}
export function labelBlockStyle(block: LabelBlock) {
    return { textAlign: block.styles.align || 'left', fontSize: `${block.styles.fontSize || 10}pt`, fontWeight: block.styles.bold ? 'bold' : 'normal',
        marginTop: `${block.styles.marginTop || 0}px`, marginBottom: `${block.styles.marginBottom || 0}px`, lineHeight: 1.1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 } as const;
}
export function labelContentHeight(blocks: LabelBlock[]) {
    return blocks.filter(block => block.visible).reduce((height, block) => height + (block.styles.marginTop || 0) + (block.styles.marginBottom || 0)
        + (block.type === 'barcode' ? (block.styles.height || 30) + 12 : block.type === 'spacer' ? block.styles.height || 10 : block.type === 'divider' ? 5 : (block.styles.fontSize || 10) * 96 / 72 * 1.1), 0);
}
export function labelOverflow(blocks: LabelBlock[], config: StickerConfig) {
    return labelContentHeight(blocks) * config.contentScale / 100 > (config.height - 2) * 96 / 25.4;
}
