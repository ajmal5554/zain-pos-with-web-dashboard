import React from 'react';
import {
    Upload,
    XCircle,
    Image as ImageIcon,
    LayoutGrid,
    GalleryHorizontalEnd,
    Plus
} from 'lucide-react';
import { Input } from '../ui/Input';
import { showToast } from '../ui/Toast';
import { normalizeImageForWhatsApp } from '../../lib/imageCollage';

export type CampaignMediaMode = 'SINGLE' | 'COLLAGE' | 'CAROUSEL';

export interface ColorPhotoSlot {
    id: string;
    dataUrl: string;
    mimeType: string;
    filename: string;
    colorLabel: string;
    sizes?: string;
    price?: string;
    uploadedMediaId?: string;
}

interface CampaignMediaPickerProps {
    mode: CampaignMediaMode;
    onModeChange: (mode: CampaignMediaMode) => void;
    // Single Photo
    singlePreviewUrl: string | null;
    singleFile: File | null;
    onSelectSingleFile: (file: File, dataUrl: string) => void;
    onClearSingleFile: () => void;
    // Multi-Color Collage (2-6 photos)
    collagePhotos: ColorPhotoSlot[];
    onCollagePhotosChange: (photos: ColorPhotoSlot[]) => void;
    stitchedPreviewUrl: string | null;
    // 4-Card Carousel
    carouselCards: ColorPhotoSlot[];
    onCarouselCardsChange: (cards: ColorPhotoSlot[]) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
    });
}

function validateImageFile(file: File): boolean {
    if (!file.type.startsWith('image/')) {
        showToast(`"${file.name}" is not a valid image file (.jpg, .png, .webp).`, 'error');
        return false;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast(`"${file.name}" exceeds WhatsApp's 5MB photo limit.`, 'warning');
        return false;
    }
    return true;
}

function dataUrlToJpegFile(dataUrl: string, filename: string): File {
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: 'image/jpeg' });
}

export const CampaignMediaPicker: React.FC<CampaignMediaPickerProps> = ({
    mode,
    onModeChange,
    singlePreviewUrl,
    singleFile,
    onSelectSingleFile,
    onClearSingleFile,
    collagePhotos,
    onCollagePhotosChange,
    stitchedPreviewUrl,
    carouselCards,
    onCarouselCardsChange,
}) => {
    const handleSingleInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !validateImageFile(file)) return;
        const rawDataUrl = await readFileAsDataUrl(file);
        try {
            const normalized = await normalizeImageForWhatsApp(rawDataUrl, file.name);
            const jpegFile = dataUrlToJpegFile(normalized.dataUrl, normalized.filename);
            onSelectSingleFile(jpegFile, normalized.dataUrl);
        } catch {
            onSelectSingleFile(file, rawDataUrl);
        }
        e.target.value = '';
    };

    const handleCollageAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const remaining = 6 - collagePhotos.length;
        if (remaining <= 0) {
            showToast('Maximum 6 color photos allowed in a grid collage.', 'warning');
            return;
        }

        const accepted = files.slice(0, remaining).filter(validateImageFile);
        const newSlots: ColorPhotoSlot[] = [];

        for (let i = 0; i < accepted.length; i++) {
            const f = accepted[i];
            const dataUrl = await readFileAsDataUrl(f);
            newSlots.push({
                id: `grid-${Date.now()}-${i}`,
                dataUrl,
                mimeType: f.type,
                filename: f.name,
                colorLabel: `Color ${collagePhotos.length + newSlots.length + 1}`,
            });
        }

        onCollagePhotosChange([...collagePhotos, ...newSlots]);
        e.target.value = '';
    };

    const handleCarouselSlotUpload = async (slotIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !validateImageFile(file)) return;
        const rawDataUrl = await readFileAsDataUrl(file);
        let finalDataUrl = rawDataUrl;
        let finalMime = file.type;
        let finalFilename = file.name;
        try {
            const normalized = await normalizeImageForWhatsApp(rawDataUrl, file.name);
            finalDataUrl = normalized.dataUrl;
            finalMime = normalized.mimeType;
            finalFilename = normalized.filename;
        } catch {
            // Fallback to original file if canvas normalization fails
        }

        const next = carouselCards.map((card, idx) =>
            idx === slotIndex
                ? {
                      ...card,
                      dataUrl: finalDataUrl,
                      mimeType: finalMime,
                      filename: finalFilename,
                      uploadedMediaId: undefined,
                  }
                : card
        );
        onCarouselCardsChange(next);
        e.target.value = '';
    };

    const updateCollageLabel = (id: string, label: string) => {
        onCollagePhotosChange(
            collagePhotos.map((p) => (p.id === id ? { ...p, colorLabel: label } : p))
        );
    };

    const removeCollagePhoto = (id: string) => {
        onCollagePhotosChange(collagePhotos.filter((p) => p.id !== id));
    };

    const updateCarouselField = (
        slotIndex: number,
        field: 'colorLabel' | 'sizes' | 'price',
        value: string
    ) => {
        onCarouselCardsChange(
            carouselCards.map((c, idx) => (idx === slotIndex ? { ...c, [field]: value } : c))
        );
    };

    return (
        <div className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                    Product Photo Format
                </label>

                {/* Mode Switcher */}
                <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 gap-1">
                    <button
                        type="button"
                        onClick={() => onModeChange('SINGLE')}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                            mode === 'SINGLE'
                                ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                    >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>1 Photo</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onModeChange('COLLAGE')}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                            mode === 'COLLAGE'
                                ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                    >
                        <LayoutGrid className="w-3.5 h-3.5" />
                        <span>Color Grid (2–6)</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onModeChange('CAROUSEL')}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                            mode === 'CAROUSEL'
                                ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                    >
                        <GalleryHorizontalEnd className="w-3.5 h-3.5" />
                        <span>4-Card Carousel</span>
                    </button>
                </div>
            </div>

            {/* MODE 1: SINGLE PHOTO */}
            {mode === 'SINGLE' && (
                <div className="border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl p-5 hover:border-emerald-400 transition-colors text-center bg-gray-50/50 dark:bg-gray-800/20">
                    {singlePreviewUrl ? (
                        <div className="space-y-3">
                            <div className="relative inline-block">
                                <img
                                    src={singlePreviewUrl}
                                    alt="Stock preview"
                                    className="w-48 h-32 object-cover rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mx-auto"
                                />
                                <button
                                    type="button"
                                    onClick={onClearSingleFile}
                                    className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-1 shadow-md hover:bg-rose-600"
                                    title="Remove image"
                                >
                                    <XCircle className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="text-xs text-gray-500">
                                {singleFile?.name} ({(Number(singleFile?.size || 0) / 1024).toFixed(0)} KB)
                            </div>
                        </div>
                    ) : (
                        <label className="cursor-pointer block space-y-2">
                            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center mx-auto">
                                <Upload className="w-5 h-5" />
                            </div>
                            <div className="text-xs font-bold text-gray-700 dark:text-gray-300">
                                Click to pick 1 product photo from your PC
                            </div>
                            <div className="text-[11px] text-gray-400">Supports JPG, PNG, WEBP (Max 5MB)</div>
                            <input type="file" accept="image/*" onChange={handleSingleInput} className="hidden" />
                        </label>
                    )}
                </div>
            )}

            {/* MODE 2: MULTI-IMAGE COLOR GRID PICKER (2 to 6 Photos Auto-Stitched) */}
            {mode === 'COLLAGE' && (
                <div className="space-y-3">
                    <div className="text-[11px] text-gray-500 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-800/40 rounded-xl px-3 py-2">
                        Pick <strong>2 to 6 color photos</strong> of the shirt/item. Zain POS automatically stitches them into a labeled grid collage and attaches it to your <code>new_stock_arrival</code> message!
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {collagePhotos.map((photo) => (
                            <div
                                key={photo.id}
                                className="border border-gray-200 dark:border-gray-700 rounded-xl p-2 bg-white dark:bg-gray-800/60 space-y-2 relative"
                            >
                                <button
                                    type="button"
                                    onClick={() => removeCollagePhoto(photo.id)}
                                    className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-0.5 shadow hover:bg-rose-600 z-10"
                                    title="Remove color"
                                >
                                    <XCircle className="w-4 h-4" />
                                </button>
                                <img
                                    src={photo.dataUrl}
                                    alt={photo.colorLabel}
                                    className="w-full h-24 object-cover rounded-lg"
                                />
                                <Input
                                    value={photo.colorLabel}
                                    onChange={(e) => updateCollageLabel(photo.id, e.target.value)}
                                    placeholder="Color (e.g. Navy)"
                                    className="h-7 text-[11px] px-2"
                                />
                            </div>
                        ))}

                        {collagePhotos.length < 6 && (
                            <label className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl h-[142px] flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 bg-gray-50/50 dark:bg-gray-800/20 text-center p-2">
                                <Plus className="w-5 h-5 text-emerald-600 mb-1" />
                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">
                                    Add Color Photo(s)
                                </span>
                                <span className="text-[10px] text-gray-400">
                                    {collagePhotos.length}/6 selected
                                </span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleCollageAdd}
                                    className="hidden"
                                />
                            </label>
                        )}
                    </div>

                    {stitchedPreviewUrl && (
                        <div className="pt-2">
                            <div className="text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1.5">
                                Auto-Stitched Grid Preview:
                            </div>
                            <img
                                src={stitchedPreviewUrl}
                                alt="Stitched Color Collage"
                                className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* MODE 3: 4-CARD SWIPEABLE CAROUSEL (new_stock_carousel) */}
            {mode === 'CAROUSEL' && (
                <div className="space-y-3">
                    <div className="text-[11px] text-gray-500 bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-200/70 dark:border-indigo-800/40 rounded-xl px-3 py-2">
                        Meta&apos;s <code>new_stock_carousel</code> sends <strong>4 swipeable product cards</strong> — each card shows its own shirt color photo, shade name, available sizes, price, and quick <strong>Book This Color</strong> button.
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {carouselCards.map((card, idx) => (
                            <div
                                key={card.id}
                                className="border border-gray-200 dark:border-gray-700 rounded-2xl p-3 bg-gray-50/60 dark:bg-gray-800/40 space-y-2.5"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                                        Card #{idx + 1}
                                    </span>
                                    {card.dataUrl ? (
                                        <span className="text-[10px] text-emerald-600 font-bold">Photo Ready</span>
                                    ) : (
                                        <span className="text-[10px] text-amber-600 font-semibold">Needs Photo</span>
                                    )}
                                </div>

                                <label className="block cursor-pointer">
                                    {card.dataUrl ? (
                                        <div className="relative group">
                                            <img
                                                src={card.dataUrl}
                                                alt={`Card ${idx + 1}`}
                                                className="w-full h-24 object-cover rounded-xl border border-gray-200 dark:border-gray-700"
                                            />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white text-[11px] font-bold">
                                                Change Photo
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="w-full h-24 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center text-gray-400 hover:border-indigo-400">
                                            <Upload className="w-4 h-4 mb-1" />
                                            <span className="text-[11px] font-semibold">Pick Photo #{idx + 1}</span>
                                        </div>
                                    )}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => handleCarouselSlotUpload(idx, e)}
                                        className="hidden"
                                    />
                                </label>

                                <div className="space-y-1.5">
                                    <Input
                                        value={card.colorLabel}
                                        onChange={(e) => updateCarouselField(idx, 'colorLabel', e.target.value)}
                                        placeholder="Shade (e.g. Navy Blue)"
                                        className="h-8 text-[11px]"
                                    />
                                    <div className="grid grid-cols-2 gap-1.5">
                                        <Input
                                            value={card.sizes || ''}
                                            onChange={(e) => updateCarouselField(idx, 'sizes', e.target.value)}
                                            placeholder="Sizes (M, L, XL)"
                                            className="h-8 text-[11px]"
                                        />
                                        <Input
                                            value={card.price || ''}
                                            onChange={(e) => updateCarouselField(idx, 'price', e.target.value)}
                                            placeholder="Price (1,299)"
                                            className="h-8 text-[11px] font-mono"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

