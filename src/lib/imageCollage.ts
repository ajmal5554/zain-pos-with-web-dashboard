export interface CollagePhotoInput {
    dataUrl: string;
    label?: string;
}

export interface StitchedCollageResult {
    dataUrl: string;
    base64Data: string;
    mimeType: string;
    filename: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image for collage'));
        img.src = src;
    });
}

function drawCoverImage(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    w: number,
    h: number
) {
    const imgRatio = img.width / img.height;
    const boxRatio = w / h;
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;

    if (imgRatio > boxRatio) {
        sw = img.height * boxRatio;
        sx = (img.width - sw) / 2;
    } else {
        sh = img.width / boxRatio;
        sy = (img.height - sh) / 2;
    }

    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawRoundedRectClip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function computeTileBoxes(
    count: number,
    canvasW: number,
    canvasH: number,
    pad: number,
    gap: number
): Array<{ x: number; y: number; w: number; h: number }> {
    const innerW = canvasW - pad * 2;
    const innerH = canvasH - pad * 2;

    if (count === 2) {
        const w = (innerW - gap) / 2;
        return [
            { x: pad, y: pad, w, h: innerH },
            { x: pad + w + gap, y: pad, w, h: innerH },
        ];
    }

    if (count === 3) {
        // 1 large hero tile on left + 2 stacked tiles on right
        const leftW = innerW * 0.54;
        const rightW = innerW - leftW - gap;
        const halfH = (innerH - gap) / 2;
        return [
            { x: pad, y: pad, w: leftW, h: innerH },
            { x: pad + leftW + gap, y: pad, w: rightW, h: halfH },
            { x: pad + leftW + gap, y: pad + halfH + gap, w: rightW, h: halfH },
        ];
    }

    if (count === 4) {
        const w = (innerW - gap) / 2;
        const h = (innerH - gap) / 2;
        return [
            { x: pad, y: pad, w, h },
            { x: pad + w + gap, y: pad, w, h },
            { x: pad, y: pad + h + gap, w, h },
            { x: pad + w + gap, y: pad + h + gap, w, h },
        ];
    }

    // 5 or 6 images -> 3x2 grid
    const cols = 3;
    const rows = 2;
    const w = (innerW - gap * (cols - 1)) / cols;
    const h = (innerH - gap * (rows - 1)) / rows;
    const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        // If 5 items, expand bottom row tiles slightly to fill cleanly
        if (count === 5 && row === 1) {
            const bottomW = (innerW - gap) / 2;
            boxes.push({
                x: pad + col * (bottomW + gap),
                y: pad + h + gap,
                w: bottomW,
                h,
            });
        } else {
            boxes.push({
                x: pad + col * (w + gap),
                y: pad + row * (h + gap),
                w,
                h,
            });
        }
    }
    return boxes;
}

/**
 * Auto-stitch 2 to 6 color/product photos into a single crisp WhatsApp-ready JPEG lookbook grid.
 */
export async function stitchColorGridCollage(
    photos: CollagePhotoInput[],
    collectionTitle?: string
): Promise<StitchedCollageResult> {
    const valid = photos.slice(0, 6);
    if (valid.length < 2) {
        throw new Error('Select at least 2 photos to generate a color grid collage.');
    }

    const canvasW = 1200;
    const canvasH = valid.length === 4 ? 1000 : 880;
    const pad = 20;
    const gap = 14;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Could not initialize collage canvas');
    }

    // Clean crisp white studio backdrop
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const images = await Promise.all(valid.map((p) => loadImage(p.dataUrl)));
    const boxes = computeTileBoxes(valid.length, canvasW, canvasH, pad, gap);

    for (let i = 0; i < valid.length; i++) {
        const box = boxes[i];
        ctx.save();
        drawRoundedRectClip(ctx, box.x, box.y, box.w, box.h, 16);
        ctx.clip();
        drawCoverImage(ctx, images[i], box.x, box.y, box.w, box.h);

        // Label badge at bottom-left of tile if provided
        const label = valid[i].label?.trim();
        if (label) {
            ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
            const textMetrics = ctx.measureText(label);
            const pillW = Math.min(box.w - 24, textMetrics.width + 32);
            const pillH = 42;
            const pillX = box.x + 12;
            const pillY = box.y + box.h - pillH - 12;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
            drawRoundedRectClip(ctx, pillX, pillY, pillW, pillH, 10);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, pillX + 16, pillY + pillH / 2 + 1, pillW - 32);
        }

        ctx.restore();
    }

    // Brand badge top-left
    const badgeText = collectionTitle?.trim()
        ? `${valid.length} Colors • ${collectionTitle.trim()}`
        : `${valid.length} Colors Available • ZAIN GENTS PALACE`;
    ctx.font = 'bold 24px system-ui, -apple-system, sans-serif';
    const badgeWidth = Math.min(canvasW - 80, ctx.measureText(badgeText).width + 40);
    ctx.save();
    ctx.fillStyle = 'rgba(5, 150, 105, 0.92)';
    drawRoundedRectClip(ctx, pad + 14, pad + 14, badgeWidth, 46, 23);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, pad + 34, pad + 38, badgeWidth - 40);
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const base64Data = dataUrl.split(',')[1] || '';

    return {
        dataUrl,
        base64Data,
        mimeType: 'image/jpeg',
        filename: `color-grid-${Date.now()}.jpg`,
    };
}

/**
 * Normalize any user-selected image (including .webp, transparent .png, or high-res photos)
 * into a clean RGB JPEG under 1600px so Meta WhatsApp Cloud API never rejects media delivery.
 */
export async function normalizeImageForWhatsApp(
    dataUrl: string,
    originalFilename?: string,
    maxDimension: number = 1600
): Promise<StitchedCollageResult> {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxDimension / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round((img.width || 800) * scale));
    const height = Math.max(1, Math.round((img.height || 800) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Could not initialize image normalization canvas');
    }

    // Fill white backdrop so transparent PNGs convert cleanly to JPEG
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const normalizedUrl = canvas.toDataURL('image/jpeg', 0.9);
    const base64Data = normalizedUrl.split(',')[1] || '';
    const baseName = (originalFilename || 'product').replace(/\.[^.]+$/, '');

    return {
        dataUrl: normalizedUrl,
        base64Data,
        mimeType: 'image/jpeg',
        filename: `${baseName}.jpg`,
    };
}

/**
 * Reconstruct a browser File instance from a JPEG/image Data URL (used when restoring saved campaign photos).
 */
export function dataUrlToJpegFile(dataUrl: string, filename: string, mimeType: string = 'image/jpeg'): File {
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename || 'product.jpg', { type: mimeType || 'image/jpeg' });
}

