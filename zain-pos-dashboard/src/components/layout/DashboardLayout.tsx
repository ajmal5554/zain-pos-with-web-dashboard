import * as React from 'react';
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { cn } from '@/lib/utils';
import { Toaster } from 'react-hot-toast';
import { navigation } from './navigation';
import { useTheme } from '@/contexts/ThemeContext';

interface DashboardLayoutProps {
    children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    const [sidebarOpen] = useState(true);
    const [darkMode, setDarkMode] = useState(false);
    const { isLiquidGlass } = useTheme();
    const location = useLocation();

    // Dark Mode Effect & System Bar Sync
    useEffect(() => {
        const metaThemeColor = document.querySelector("meta[name='theme-color']");
        const metaColorScheme = document.querySelector("meta[name='color-scheme']");
        if (darkMode) {
            document.documentElement.classList.add('dark');
            if (metaThemeColor) metaThemeColor.setAttribute('content', '#020617');
            if (metaColorScheme) metaColorScheme.setAttribute('content', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            if (metaThemeColor) metaThemeColor.setAttribute('content', '#ffffff');
            if (metaColorScheme) metaColorScheme.setAttribute('content', 'light');
        }
    }, [darkMode]);

    const getTitle = () => {
        return navigation.find((item) => item.href === location.pathname)?.name || 'Overview';
    };

    return (
        <div className="flex h-screen w-full flex-col bg-background overflow-hidden relative">
            {/* Ambient Aurora Orbs for iOS Liquid Glass Theme */}
            {isLiquidGlass && (
                <div className="pointer-events-none fixed inset-0 overflow-hidden z-0 transition-opacity duration-500">
                    <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-gradient-to-br from-blue-400/20 via-indigo-400/20 to-purple-400/20 blur-[110px]" />
                    <div className="absolute top-1/3 -right-28 w-96 h-96 rounded-full bg-gradient-to-bl from-teal-400/15 via-sky-400/15 to-blue-400/15 blur-[120px]" />
                    <div className="absolute -bottom-28 left-1/3 w-[30rem] h-[30rem] rounded-full bg-gradient-to-tr from-purple-400/15 via-pink-400/10 to-amber-400/15 blur-[130px]" />
                </div>
            )}

            <Sidebar isOpen={sidebarOpen} />

            <div className="flex flex-col sm:pl-52 flex-1 min-w-0 h-full overflow-hidden">
                <MobileHeader darkMode={darkMode} setDarkMode={setDarkMode} />
                <div className="hidden sm:block">
                    <Header title={getTitle()} darkMode={darkMode} setDarkMode={setDarkMode} />
                </div>

                <main className="grid flex-1 items-start gap-4 p-4 pb-28 sm:p-6 sm:pb-8 md:gap-8 min-w-0 w-full max-w-full overflow-y-auto overflow-x-hidden">
                    {children}
                </main>
            </div>

            <MobileNav />

            <Toaster position="top-right" />
        </div>
    );
}
