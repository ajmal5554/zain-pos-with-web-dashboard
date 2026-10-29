import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { labelBlockStyle } from '../../lib/labelTemplate';
import type { LabelBlock, StickerConfig } from '../../lib/labelTemplate';
import { formatIndianCurrency } from '../../lib/format';

export const LabelStickerPreview: React.FC<{ blocks: LabelBlock[]; config: StickerConfig; shopName: string; productName: string; code: string; mrp: number; sellingPrice?: number; selectedId?: string | null; onSelect?: (id: string) => void }> = ({ blocks, config, shopName, productName, code, mrp, sellingPrice = mrp, selectedId, onSelect }) => {
    const element = useRef<HTMLDivElement>(null);
    useEffect(() => {
        element.current?.querySelectorAll<SVGSVGElement>('svg[data-barcode-height]').forEach(svg => {
            try { JsBarcode(svg, code, { format: 'CODE128', width: 1.4, height: Number(svg.dataset.barcodeHeight), displayValue: false, margin: 6, lineColor: '#000', background: '#fff' }); }
            catch { svg.replaceChildren(); }
        });
    }, [blocks, code]);
    return <div ref={element} className="bg-white text-black relative overflow-hidden" style={{ width: `${config.width}mm`, height: `${config.height}mm`, padding: '1mm', boxSizing: 'border-box', fontFamily: 'Arial, sans-serif', flexShrink: 0 }}>
        <div style={{ transform: `scale(${config.contentScale / 100})`, transformOrigin: 'top left', width: `${10000 / config.contentScale}%` }}>
            {blocks.filter(block => block.visible).map(block => <div key={block.id} onClick={onSelect ? () => onSelect(block.id) : undefined} className={onSelect ? `cursor-pointer hover:bg-blue-100 ${selectedId === block.id ? 'ring-1 ring-blue-500' : ''}` : undefined} style={labelBlockStyle(block)}>
                {block.type === 'shop_name' && (block.content || shopName)}
                {block.type === 'product_name' && (block.content || productName)}
                {block.type === 'product_code' && code}
                {block.type === 'text' && (block.content || '')}
                {block.type === 'price' && `MRP: ${formatIndianCurrency(mrp)}`}
                {block.type === 'barcode' && <div style={{ display: 'flex', justifyContent: block.styles.align === 'right' ? 'flex-end' : block.styles.align === 'center' ? 'center' : 'flex-start' }}><svg data-barcode-height={block.styles.height || 30} style={{ maxWidth: '100%', height: 'auto', flexShrink: 1 }} /></div>}
                {block.type === 'meta_row' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{code}</span><span>{formatIndianCurrency(sellingPrice)}</span></div>}
                {block.type === 'divider' && <div style={{ borderTop: '1px solid black', margin: '2px 0' }} />}
                {block.type === 'spacer' && <div style={{ height: block.styles.height || 10 }} />}
            </div>)}
        </div>
    </div>;
};
