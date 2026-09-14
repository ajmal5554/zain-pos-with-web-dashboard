import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, X, Check, Barcode, Package, ChevronDown } from 'lucide-react';
import { formatIndianCurrency } from '../../lib/format';

export interface ProductVariantItem {
    id: string;
    barcode?: string | null;
    sku?: string | null;
    stock: number;
    sellingPrice: number;
    size?: string;
    color?: string;
    product: {
        name: string;
        category?: string;
        [key: string]: any;
    };
    [key: string]: any;
}

interface ReplacementProductPickerProps {
    products: ProductVariantItem[];
    onSelectProduct: (variant: ProductVariantItem) => void;
    existingItemQuantities?: Record<string, number>;
    placeholder?: string;
    disabled?: boolean;
}

const PAGE_SIZE = 25;

export const ReplacementProductPicker: React.FC<ReplacementProductPickerProps> = ({
    products,
    onSelectProduct,
    existingItemQuantities = {},
    placeholder = 'Search product name, size, color or scan barcode...',
    disabled = false
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);



    // Helper to find exact barcode or SKU match with robust format handling
    const findBarcodeMatch = useCallback((rawQuery: string): ProductVariantItem | undefined => {
        const cleaned = rawQuery.trim().toLowerCase();
        if (!cleaned) return undefined;

        // 1. Direct exact barcode match
        const exactBarcode = products.find(p => {
            const b = String(p.barcode || '').trim().toLowerCase();
            return b === cleaned;
        });
        if (exactBarcode) return exactBarcode;

        // 2. Direct exact SKU match
        const exactSku = products.find(p => {
            const s = String(p.sku || '').trim().toLowerCase();
            return s === cleaned;
        });
        if (exactSku) return exactSku;

        // 3. Digits-only match (in case scanner has leading/trailing characters or prefix)
        const digitsOnly = cleaned.replace(/\D/g, '');
        if (digitsOnly && digitsOnly.length >= 4) {
            const digitMatch = products.find(p => {
                const bDigits = String(p.barcode || '').replace(/\D/g, '');
                return bDigits === digitsOnly;
            });
            if (digitMatch) return digitMatch;
        }

        return undefined;
    }, [products]);

    // Compute filtered products: prioritizes barcodes, SKUs, and names
    const filteredProducts = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) {
            return products;
        }

        const queryTokens = query.split(/\s+/).filter(Boolean);
        const exactBarcodeMatches: ProductVariantItem[] = [];
        const startsWithMatches: ProductVariantItem[] = [];
        const containsMatches: ProductVariantItem[] = [];

        for (const p of products) {
            const barcode = String(p.barcode || '').trim().toLowerCase();
            const sku = String(p.sku || '').trim().toLowerCase();
            const name = String(p.product?.name || '').trim().toLowerCase();
            const size = String(p.size || '').trim().toLowerCase();
            const color = String(p.color || '').trim().toLowerCase();
            const price = String(p.sellingPrice || '');

            if (barcode === query || sku === query) {
                exactBarcodeMatches.push(p);
                continue;
            }

            const combinedText = `${name} ${size} ${color} ${barcode} ${sku} ${price}`;
            const matchesAll = queryTokens.every(token => combinedText.includes(token));

            if (matchesAll) {
                if (name.startsWith(query) || barcode.startsWith(query) || sku.startsWith(query)) {
                    startsWithMatches.push(p);
                } else {
                    containsMatches.push(p);
                }
            }
        }

        return [...exactBarcodeMatches, ...startsWithMatches, ...containsMatches];
    }, [products, searchQuery]);

    // Reset display limit and highlighted index on search query change or when dropdown opens
    useEffect(() => {
        setDisplayLimit(PAGE_SIZE);
        setHighlightedIndex(0);
    }, [searchQuery, isOpen]);

    // Slice currently visible products for lightning-fast DOM rendering
    const visibleProducts = useMemo(() => {
        return filteredProducts.slice(0, displayLimit);
    }, [filteredProducts, displayLimit]);

    // Progressive infinite scroll: loads the next batch as user scrolls near bottom
    const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        if (scrollTop + clientHeight >= scrollHeight - 60) {
            setDisplayLimit(prev => {
                if (prev < filteredProducts.length) {
                    return Math.min(prev + PAGE_SIZE, filteredProducts.length);
                }
                return prev;
            });
        }
    };

    // Scroll highlighted item into view
    useEffect(() => {
        if (isOpen && listRef.current && listRef.current.children[highlightedIndex]) {
            const el = listRef.current.children[highlightedIndex] as HTMLElement;
            if (el) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [highlightedIndex, isOpen]);

    // Handle clicks outside: capture phase ensures events are caught before Modal's stopPropagation()
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside, true);
        document.addEventListener('touchstart', handleClickOutside, true);
        document.addEventListener('click', handleClickOutside, true);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside, true);
            document.removeEventListener('touchstart', handleClickOutside, true);
            document.removeEventListener('click', handleClickOutside, true);
        };
    }, []);

    const handleSelect = useCallback((variant: ProductVariantItem) => {
        onSelectProduct(variant);
        setSearchQuery('');
        setIsOpen(false);
        setHighlightedIndex(0);
        setTimeout(() => inputRef.current?.focus(), 50);
    }, [onSelectProduct]);

    // Global barcode scanner listener: captures scans even if focus is temporarily outside the input
    useEffect(() => {
        let scanBuffer = '';
        let lastKeyTime = Date.now();

        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (disabled) return;

            if (
                document.activeElement &&
                document.activeElement !== inputRef.current &&
                (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')
            ) {
                return;
            }

            const now = Date.now();
            const timeDiff = now - lastKeyTime;
            lastKeyTime = now;

            if (e.key === 'Enter') {
                if (scanBuffer.length >= 3) {
                    const scanned = scanBuffer.trim();
                    const match = findBarcodeMatch(scanned);
                    if (match) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSelect(match);
                        scanBuffer = '';
                        return;
                    }
                }
                scanBuffer = '';
            } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (timeDiff > 100) {
                    scanBuffer = e.key;
                } else {
                    scanBuffer += e.key;
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown, true);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
    }, [disabled, findBarcodeMatch, handleSelect]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
            } else if (visibleProducts.length > 0) {
                setHighlightedIndex(prev => {
                    const next = (prev + 1) % visibleProducts.length;
                    // If moving past visible limit, increase display limit
                    if (next >= displayLimit - 2 && displayLimit < filteredProducts.length) {
                        setDisplayLimit(l => Math.min(l + PAGE_SIZE, filteredProducts.length));
                    }
                    return next;
                });
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
            } else if (visibleProducts.length > 0) {
                setHighlightedIndex(prev => (prev - 1 + visibleProducts.length) % visibleProducts.length);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const trimmed = searchQuery.trim().toLowerCase();
            if (!trimmed && filteredProducts.length === 0) return;

            // Check if exact barcode match exists anywhere in all products
            const exactMatch = findBarcodeMatch(trimmed);
            if (exactMatch) {
                handleSelect(exactMatch);
                return;
            }

            // Otherwise select the currently highlighted or first result
            if (visibleProducts.length > 0) {
                const selected = visibleProducts[highlightedIndex] || visibleProducts[0];
                if (selected) {
                    handleSelect(selected);
                }
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

    return (
        <div ref={containerRef} className="relative w-full">
            {/* Search Input Box */}
            <div className="relative flex items-center">
                <Search className="absolute left-3 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                    ref={inputRef}
                    type="text"
                    disabled={disabled}
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onClick={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    className="w-full pl-9 pr-16 py-2 text-xs md:text-sm bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-orange-500 dark:focus:border-orange-500 transition-all text-gray-900 dark:text-white placeholder:text-gray-400 h-10 shadow-sm"
                />
                <div className="absolute right-2.5 flex items-center gap-1">
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery('');
                                inputRef.current?.focus();
                            }}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                            title="Clear search"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            setIsOpen(prev => !prev);
                            inputRef.current?.focus();
                        }}
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                        title={isOpen ? 'Collapse list' : 'Expand list'}
                    >
                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Dropdown Results List */}
            {isOpen && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center text-[10px] text-gray-500 font-medium">
                        <span>
                            {searchQuery
                                ? `Matching items (${filteredProducts.length})`
                                : `Showing ${visibleProducts.length} of ${products.length} products`}
                        </span>
                        {filteredProducts.length > visibleProducts.length ? (
                            <span className="text-orange-600 dark:text-orange-400 font-medium">
                                Scroll down to load more
                            </span>
                        ) : (
                            <span className="hidden sm:inline text-gray-400">
                                Use ↑ ↓ to navigate, ↵ to select
                            </span>
                        )}
                    </div>

                    <div
                        ref={listRef}
                        onScroll={handleListScroll}
                        className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/60"
                    >
                        {visibleProducts.length > 0 ? (
                            <>
                                {visibleProducts.map((p, idx) => {
                                    const isHighlighted = idx === highlightedIndex;
                                    const addedQty = existingItemQuantities[p.id] || 0;
                                    const isAlreadyAdded = addedQty > 0;
                                    const variantDetails = [p.size, p.color].filter(Boolean).join(' • ');

                                    return (
                                        <div
                                            key={p.id}
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                handleSelect(p);
                                            }}
                                            onMouseEnter={() => setHighlightedIndex(idx)}
                                            className={`p-2.5 px-3 cursor-pointer flex items-center justify-between transition-colors ${
                                                isHighlighted
                                                    ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-950 dark:text-orange-100'
                                                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-800 dark:text-gray-200'
                                            }`}
                                        >
                                            <div className="min-w-0 flex-1 pr-3">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-xs text-gray-900 dark:text-white truncate">
                                                        {p.product?.name}
                                                    </span>
                                                    {isAlreadyAdded && (
                                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300">
                                                            <Check className="w-2.5 h-2.5" /> Added (x{addedQty})
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center flex-wrap gap-1.5 mt-1">
                                                    {variantDetails && (
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                                                            {variantDetails}
                                                        </span>
                                                    )}
                                                    {p.barcode && (
                                                        <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-400 font-mono">
                                                            <Barcode className="w-2.5 h-2.5" /> {p.barcode}
                                                        </span>
                                                    )}
                                                    <span
                                                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                            p.stock > 0
                                                                ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300'
                                                                : 'text-amber-700 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-400'
                                                        }`}
                                                    >
                                                        {p.stock > 0 ? `${p.stock} in stock` : '0 stock'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <div className="text-xs font-black text-orange-600 dark:text-orange-400">
                                                    {formatIndianCurrency(p.sellingPrice)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {visibleProducts.length < filteredProducts.length && (
                                    <div className="p-2.5 text-center text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50/50 dark:bg-gray-800/30">
                                        Showing {visibleProducts.length} of {filteredProducts.length} items • Scroll down to load more
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="p-6 text-center text-gray-400 dark:text-gray-500">
                                <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                                <p className="text-xs font-medium">No products found matching &ldquo;{searchQuery}&rdquo;</p>
                                <p className="text-[10px] mt-1 text-gray-400">
                                    Try searching with product name, size, or scanning barcode
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
