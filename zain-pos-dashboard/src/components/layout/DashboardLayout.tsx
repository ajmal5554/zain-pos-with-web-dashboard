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
    const [sidebarOpen, setSidebarOpen] = useState(true);
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
        <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.10),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.10),_transparent_24%),linear-gradient(180deg,_#f8fbff_0%,_#edf3fb_100%)] font-sans text-slate-900 dark:bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.10),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(96,165,250,0.12),_transparent_24%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] dark:text-slate-100">
            <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

            <div className={cn(
                "flex-1 flex flex-col overflow-hidden transition-all duration-300",
                sidebarOpen ? "lg:ml-64" : "lg:ml-24"
            )}>
                <MobileHeader darkMode={darkMode} setDarkMode={setDarkMode} />
                <Header title={getTitle()} darkMode={darkMode} setDarkMode={setDarkMode} />

                <main className="flex-1 overflow-y-auto px-4 pb-24 pt-4 lg:px-8 lg:pb-8 lg:pt-6">
                    <div className="mx-auto max-w-[1440px]">
                        {children}
                    </div>
                </main>
            </div>

            <MobileNav />

            <Toaster position="top-right" />
        </div>
    );
}
