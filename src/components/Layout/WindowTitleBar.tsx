import React from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

type ShopBrand = {
    shopName: string;
    logo: string;
};

export const WindowTitleBar: React.FC = () => {
    const [isMaximized, setIsMaximized] = React.useState(false);
    const [shopBrand, setShopBrand] = React.useState<ShopBrand>({
        shopName: 'ZAIN GENTS PALACE POS',
        logo: '',
    });

    React.useEffect(() => {
        let unsubscribe = () => { };

        const syncWindowState = async () => {
            try {
                const result = await window.electronAPI.app.getWindowState();
                if (result?.success) {
                    setIsMaximized(!!result.isMaximized);
                }
            } catch {
                // no-op
            }
        };

        syncWindowState();
        unsubscribe = window.electronAPI.app.onWindowStateChange((state: { isMaximized: boolean }) => {
            setIsMaximized(!!state.isMaximized);
        });

        return () => unsubscribe();
    }, []);

    React.useEffect(() => {
        const loadShopBrand = async () => {
            try {
                const result = await window.electronAPI.settings.get({ key: 'SHOP_SETTINGS' });
                if (result?.success && result.data) {
                    const parsed = JSON.parse(result.data as string);
                    setShopBrand({
                        shopName: parsed?.shopName || 'ZAIN GENTS PALACE POS',
                        logo: parsed?.logo || '',
                    });
                }
            } catch {
                // no-op
            }
        };

        const handleBrandUpdate = (event: Event) => {
            const detail = (event as CustomEvent<ShopBrand>).detail;
            setShopBrand({
                shopName: detail?.shopName || 'ZAIN GENTS PALACE POS',
                logo: detail?.logo || '',
            });
        };

        loadShopBrand();
        window.addEventListener('shop-brand-updated', handleBrandUpdate);

        return () => {
            window.removeEventListener('shop-brand-updated', handleBrandUpdate);
        };
    }, []);

    return (
        <div
            className="h-8 bg-gray-50 dark:bg-dark-bg border-b border-gray-200 dark:border-dark-border flex items-center justify-between pl-4"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            <div className="flex items-center gap-2 text-sm text-gray-700 select-none">
                {shopBrand.logo ? (
                    <img
                        src={shopBrand.logo}
                        alt={shopBrand.shopName}
                        className="w-4 h-4 object-contain flex-shrink-0"
                    />
                ) : null}
                <span className="font-medium tracking-tight">{shopBrand.shopName}</span>
            </div>

            <div
                className="flex items-stretch h-full"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <button
                    type="button"
                    onClick={() => void window.electronAPI.app.minimizeWindow()}
                    className="w-12 h-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
                    aria-label="Minimize window"
                >
                    <Minus className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onClick={async () => {
                        const result = await window.electronAPI.app.toggleMaximizeWindow();
                        if (result?.success) {
                            setIsMaximized(!!result.isMaximized);
                        }
                    }}
                    className="w-12 h-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
                    aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
                >
                    {isMaximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                </button>
                <button
                    type="button"
                    onClick={() => void window.electronAPI.app.closeWindow()}
                    className="w-12 h-full flex items-center justify-center text-gray-600 hover:bg-red-500 hover:text-white transition-colors"
                    aria-label="Close window"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
