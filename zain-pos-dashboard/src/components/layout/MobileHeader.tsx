import { Sun, Moon, LogOut, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { NotificationBell } from '@/components/notifications/NotificationBell';

interface MobileHeaderProps {
    darkMode: boolean;
    setDarkMode: (dark: boolean) => void;
}

export function MobileHeader({ darkMode, setDarkMode }: MobileHeaderProps) {
    const { logout, user, isDemoMode } = useAuth();

    return (
        <div className="lg:hidden sticky top-0 z-30 border-b border-slate-200/70 bg-white/[0.92] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/[0.92]">
            <div className="px-4 pt-4">
                <div className="dashboard-surface relative overflow-hidden rounded-[1.75rem] px-4 pb-4 pt-4">
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_58%),radial-gradient(circle_at_top_right,_rgba(15,23,42,0.10),_transparent_52%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_58%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),_transparent_52%)]" />
                    <div className="relative flex items-center justify-between">
                        <div className="min-w-0">
                            <div className="mb-3 flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-sky-400 dark:text-slate-950">
                                    <Sparkles className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-[11px] font-semibold uppercase tracking-[0.26em] text-sky-700 dark:text-sky-300">
                                        Zain Gents Palace
                                    </p>
                                    <h1 className="truncate text-base font-semibold tracking-tight text-slate-950 dark:text-white">
                                        Commerce Console
                                    </h1>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em]">
                                <span className="rounded-full bg-slate-950 px-2.5 py-1 text-white dark:bg-sky-400 dark:text-slate-950">
                                    Mobile
                                </span>
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                                    {isDemoMode ? 'Demo Session' : user?.role || 'Dashboard'}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <NotificationBell />

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDarkMode(!darkMode)}
                                className="text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"
                            >
                                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                            </Button>

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => { logout(); window.location.href = '/login'; }}
                                className="text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/20"
                            >
                                <LogOut className="w-5 h-5" />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
            <div className="px-4 pb-4 pt-3">
                <DateRangePicker />
            </div>
        </div>
    );
}
