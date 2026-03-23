import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { navigation } from './navigation';

export function MobileNav() {
    const location = useLocation();
    const mobileNav = navigation.filter((item) => item.href !== '/reports');

    return (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200/70 bg-white/[0.9] px-2 pb-safe backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/[0.9]">
            <nav className="flex justify-around gap-1 p-2">
                {mobileNav.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.href;
                    return (
                        <Link
                            key={item.name}
                            to={item.href}
                            className={cn(
                                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2.5 transition-all",
                                isActive
                                    ? "bg-slate-950 text-white shadow-[0_14px_24px_-18px_rgba(15,23,42,1)] dark:bg-sky-400 dark:text-slate-950"
                                    : "text-slate-500 dark:text-slate-400"
                            )}
                        >
                            <Icon size={18} />
                            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.18em]">
                                {item.shortLabel}
                            </span>
                        </Link>
                    );
                })}
            </nav>
        </div>
    );
}
