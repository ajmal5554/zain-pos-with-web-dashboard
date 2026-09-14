import React, { createContext, useContext, useEffect, useState } from 'react';

const LIQUID_GLASS_STORAGE_KEY = 'zain_liquid_glass';

interface ThemeContextType {
    isLiquidGlass: boolean;
    setIsLiquidGlass: (enabled: boolean) => void;
    toggleLiquidGlass: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [isLiquidGlass, setIsLiquidGlassState] = useState<boolean>(() => {
        const stored = localStorage.getItem(LIQUID_GLASS_STORAGE_KEY);
        if (stored !== null) {
            return stored === 'true';
        }
        // Default to enabled so the user can immediately experience the iOS Liquid Glass look
        return true;
    });

    useEffect(() => {
        if (isLiquidGlass) {
            document.documentElement.classList.add('liquid-glass');
        } else {
            document.documentElement.classList.remove('liquid-glass');
        }
        localStorage.setItem(LIQUID_GLASS_STORAGE_KEY, String(isLiquidGlass));
    }, [isLiquidGlass]);

    const setIsLiquidGlass = (enabled: boolean) => {
        setIsLiquidGlassState(enabled);
    };

    const toggleLiquidGlass = () => {
        setIsLiquidGlassState((prev) => !prev);
    };

    return (
        <ThemeContext.Provider value={{ isLiquidGlass, setIsLiquidGlass, toggleLiquidGlass }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
