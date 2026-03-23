import { Link, useLocation } from 'react-router-dom';
import {
    LogOut
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { navigation } from './navigation';

interface SidebarProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
}

export function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
    const { user, logout } = useAuth();
    const location = useLocation();

    return (
        <aside
            className={cn(
                "hidden lg:flex transition-all duration-300 flex-col fixed inset-y-0 z-30 border-r border-slate-200/70 bg-white/[0.92] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/[0.92]",
                isOpen ? "w-64" : "w-24"
            )}
        >
            <div className="relative overflow-hidden border-b border-slate-200/70 px-4 py-5 dark:border-slate-800">
                {isOpen ? (
                    <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        className="flex w-full min-w-0 items-center gap-3 rounded-2xl text-left transition hover:bg-slate-50 dark:hover:bg-slate-900/60"
                        aria-label="Collapse sidebar"
                        title="Collapse sidebar"
                    >
                        <div className="flex min-w-0 items-center gap-3 px-0.5">
                            <img
                                src="/icon.ico"
                                alt="Zain app icon"
                                className="h-11 w-11 rounded-2xl object-cover"
                            />
                            <div className="min-w-0">
                                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                                    Zain Gents Palace
                                </p>
                                <h1 className="truncate text-lg font-semibold text-slate-950 dark:text-white">
                                    Operations
                                </h1>
                            </div>
                        </div>
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => setIsOpen(true)}
                        className="flex w-full justify-center rounded-2xl py-1 transition hover:bg-slate-50 dark:hover:bg-slate-900/60"
                        aria-label="Expand sidebar"
                        title="Expand sidebar"
                    >
                        <img
                            src="/icon.ico"
                            alt="Zain app icon"
                            className="h-11 w-11 rounded-2xl object-cover"
                        />
                    </button>
                )}
            </div>

            <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-5">
                {navigation.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.href;

                    return (
                        <Link
                            key={item.name}
                            to={item.href}
                            className={cn(
                                "group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition-all",
                                isActive
                                    ? "bg-slate-100 text-slate-950 dark:bg-slate-900 dark:text-white"
                                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900/70 dark:hover:text-white"
                            )}
                            title={!isOpen ? item.name : ''}
                        >
                            <div className={cn(
                                "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border transition-colors",
                                isActive
                                    ? "border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                                    : "border-transparent bg-slate-100 text-slate-500 group-hover:border-slate-200 group-hover:bg-white dark:bg-slate-900 dark:text-slate-400 dark:group-hover:border-slate-800 dark:group-hover:bg-slate-950"
                            )}>
                                <Icon className="h-[18px] w-[18px] stroke-[1.9]" />
                            </div>
                            {isOpen && (
                                <div className="min-w-0">
                                    <span className="block truncate">{item.name}</span>
                                    <span className={cn(
                                        "block text-[11px] uppercase tracking-[0.22em]",
                                        isActive ? "text-slate-400 dark:text-slate-500" : "text-slate-300 dark:text-slate-600"
                                    )}>
                                        {item.shortLabel}
                                    </span>
                                </div>
                            )}
                        </Link>
                    );
                })}
            </nav>

            <div className="border-t border-slate-200/70 p-3 dark:border-slate-800">
                {isOpen && (
                    <div className="mb-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                        <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                            {user?.name || user?.username}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                            {user?.role}
                        </p>
                    </div>
                )}
                <Button
                    variant="ghost"
                    className={cn(
                        "w-full justify-start gap-3 rounded-2xl text-rose-500 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/30",
                        !isOpen && "justify-center px-0"
                    )}
                    onClick={() => { logout(); window.location.href = '/login'; }}
                    title={!isOpen ? 'Logout' : ''}
                >
                    <LogOut className="h-5 w-5 flex-shrink-0" />
                    {isOpen && <span>Logout</span>}
                </Button>
            </div>
        </aside>
    );
}
