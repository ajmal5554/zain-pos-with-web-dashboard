import React from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

interface WindowControlsProps {
    className?: string;
    buttonClassName?: string;
}

export const WindowControls: React.FC<WindowControlsProps> = ({
    className = '',
    buttonClassName = '',
}) => {
    const [isMaximized, setIsMaximized] = React.useState(false);

    // If running in a regular web browser, hide window title bar controls
    const isElectron = typeof window !== 'undefined' && (
        navigator.userAgent.toLowerCase().includes('electron') ||
        !!(window as any).process?.versions?.electron
    );

    React.useEffect(() => {
        if (!isElectron) return;
        let unsubscribe = () => {};

        const syncWindowState = async () => {
            try {
                const result = await window.electronAPI?.app?.getWindowState?.();
                if (result?.success) {
                    setIsMaximized(!!result.isMaximized);
                }
            } catch {
                // no-op
            }
        };

        syncWindowState();
        if (window.electronAPI?.app?.onWindowStateChange) {
            unsubscribe = window.electronAPI.app.onWindowStateChange((state: { isMaximized: boolean }) => {
                setIsMaximized(!!state.isMaximized);
            });
        }

        return () => unsubscribe();
    }, [isElectron]);

    if (!isElectron) {
        return null;
    }

    return (
        <div
            className={`flex items-center gap-1 select-none ${className}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
            <button
                type="button"
                onClick={() => void window.electronAPI?.app?.minimizeWindow?.()}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors ${buttonClassName}`}
                aria-label="Minimize window"
                title="Minimize"
            >
                <Minus className="w-3.5 h-3.5" />
            </button>
            <button
                type="button"
                onClick={async () => {
                    const result = await window.electronAPI?.app?.toggleMaximizeWindow?.();
                    if (result?.success) {
                        setIsMaximized(!!result.isMaximized);
                    }
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors ${buttonClassName}`}
                aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
                title={isMaximized ? 'Restore' : 'Maximize'}
            >
                {isMaximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
            <button
                type="button"
                onClick={() => void window.electronAPI?.app?.closeWindow?.()}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-red-500 hover:text-white dark:text-gray-400 dark:hover:bg-red-600 dark:hover:text-white transition-colors ${buttonClassName}`}
                aria-label="Close window"
                title="Close"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
};

