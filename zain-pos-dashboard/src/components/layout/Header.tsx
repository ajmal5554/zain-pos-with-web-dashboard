import { Sun, Moon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { cn } from '@/lib/utils';

interface HeaderProps {
    title: string;
    darkMode: boolean;
    setDarkMode: (dark: boolean) => void;
}

export function Header({ title, darkMode, setDarkMode }: HeaderProps) {
    const { user, isDemoMode, logout } = useAuth();

    return (
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6">
            <div className="flex bg-transparent items-center gap-4 w-full justify-between">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-semibold leading-none tracking-tight">
                        {title}
                    </h1>
                    {isDemoMode && (
                        <button 
                            onClick={() => logout()}
                            title="Click to exit Demo Mode and sign in for Live Data"
                            className="flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300 transition-colors"
                        >
                            <div className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                            Demo
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <NotificationBell />

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDarkMode(!darkMode)}
                        className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                        {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </Button>

                    <div className="hidden sm:flex items-center justify-center h-8 w-8 rounded-full border bg-muted text-sm font-medium">
                        {user?.username?.charAt(0).toUpperCase()}
                    </div>
                </div>
            </div>
        </header>
    );
}
