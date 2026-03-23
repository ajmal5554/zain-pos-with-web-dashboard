import { Sun, Moon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { NotificationBell } from '@/components/notifications/NotificationBell';

interface HeaderProps {
    title: string;
    darkMode: boolean;
    setDarkMode: (dark: boolean) => void;
}

export function Header({ title, darkMode, setDarkMode }: HeaderProps) {
    const { user, isDemoMode } = useAuth();

    return (
        <header className="hidden lg:flex sticky top-0 z-20 items-center justify-between gap-4 border-b border-slate-200/70 bg-white/[0.82] px-8 py-5 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/[0.82]">
            <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                    {isDemoMode && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                            Demo Mode
                        </span>
                    )}
                </div>
                <h2 className="truncate text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                    {title}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Clean view for store operations, stock, and billing.
                </p>
            </div>
            <div className="flex items-center gap-4">
                <DateRangePicker />

                <NotificationBell />

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDarkMode(!darkMode)}
                    className="rounded-2xl text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"
                >
                    {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </Button>

                <div className="flex items-center gap-3 border-l border-slate-200 pl-4 dark:border-slate-800">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
                        {user?.username?.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                            {user?.name || user?.username}
                        </p>
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">{user?.role}</p>
                    </div>
                </div>
            </div>
        </header>
    );
}
