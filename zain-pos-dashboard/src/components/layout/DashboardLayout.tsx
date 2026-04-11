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

interface DashboardLayoutProps {
    children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    const [sidebarOpen] = useState(true);
    const [darkMode, setDarkMode] = useState(false);
    const location = useLocation();

    // Dark Mode Effect
    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [darkMode]);

    const getTitle = () => {
        return navigation.find((item) => item.href === location.pathname)?.name || 'Overview';
    };

    return (
        <div className="flex min-h-screen w-full flex-col bg-background">
            <Sidebar isOpen={sidebarOpen} />

            <div className="flex flex-col sm:pl-52 flex-1 min-w-0">
                <MobileHeader darkMode={darkMode} setDarkMode={setDarkMode} />
                <div className="hidden sm:block sticky top-0 z-30 bg-background">
                    <Header title={getTitle()} darkMode={darkMode} setDarkMode={setDarkMode} />
                </div>

                <main className="grid flex-1 items-start gap-4 p-4 pb-24 sm:p-6 sm:pb-8 md:gap-8 min-w-0 w-full max-w-full overflow-x-hidden">
                    {children}
                </main>
            </div>

            <MobileNav />

            <Toaster position="top-right" />
        </div>
    );
}
