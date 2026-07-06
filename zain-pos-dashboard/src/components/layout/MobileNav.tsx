import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { navigation } from './navigation';
import { Menu } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useState } from 'react';

export function MobileNav() {
    const location = useLocation();
    const [open, setOpen] = useState(false);
    
    // Pick the most important 4 tabs for standard mobile navigation bottom bar
    const primaryNavHrefs = ['/', '/sales', '/inventory', '/reports'];
    const primaryNav = primaryNavHrefs
        .map(href => navigation.find(n => n.href === href))
        .filter((item): item is typeof navigation[number] => !!item);

    return (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200/70 bg-white/[0.95] px-2 pb-safe backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/[0.95]">
            <nav className="flex justify-between items-center px-1 py-1.5 min-h-[60px]">
                {primaryNav.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.href;
                    return (
                        <Link
                            key={item.name}
                            to={item.href}
                            className={cn(
                                "flex min-w-[64px] flex-col items-center justify-center gap-1 rounded-2xl p-1 transition-all",
                                isActive
                                    ? "text-primary dark:text-sky-400 font-bold"
                                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300"
                            )}
                        >
                            <div className={cn(
                                "flex items-center justify-center rounded-xl p-1",
                                isActive && "bg-primary/10 dark:bg-sky-400/10"
                            )}>
                                <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                            </div>
                            <span className="text-[10px] font-medium tracking-wide">
                                {item.shortLabel}
                            </span>
                        </Link>
                    );
                })}

                {/* More Menu using Sheet */}
                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetTrigger asChild>
                        <button
                            className={cn(
                                "flex min-w-[64px] flex-col items-center justify-center gap-1 rounded-2xl p-1 transition-all text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300",
                                open && "text-primary dark:text-sky-400 font-bold"
                            )}
                        >
                            <div className={cn(
                                "flex items-center justify-center rounded-xl p-1",
                                open && "bg-primary/10 dark:bg-sky-400/10"
                            )}>
                                <Menu size={22} strokeWidth={open ? 2.5 : 2} />
                            </div>
                            <span className="text-[10px] font-medium tracking-wide">
                                Menu
                            </span>
                        </button>
                    </SheetTrigger>
                    
                    <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl px-4 pb-8 overflow-y-auto z-50">
                        <SheetHeader className="pb-4 pt-2 text-left border-b">
                            <SheetTitle className="text-xl font-bold">Menu</SheetTitle>
                        </SheetHeader>
                        <div className="grid grid-cols-4 gap-y-6 gap-x-2 pt-6">
                            {navigation.map((item) => {
                                const Icon = item.icon;
                                const isActive = location.pathname === item.href;
                                return (
                                    <Link
                                        key={item.name}
                                        to={item.href}
                                        onClick={() => setOpen(false)}
                                        className={cn(
                                            "flex flex-col items-center gap-2 group",
                                            isActive ? "text-primary" : "text-slate-500 hover:text-foreground dark:text-slate-400"
                                        )}
                                    >
                                        <div className={cn(
                                            "flex h-14 w-14 items-center justify-center rounded-2xl transition-all shadow-sm",
                                            isActive 
                                                ? "bg-primary/10 text-primary ring-1 ring-primary/20" 
                                                : "bg-slate-100 dark:bg-slate-800/60 text-muted-foreground group-hover:bg-slate-200 dark:group-hover:bg-slate-800"
                                        )}>
                                            <Icon size={26} strokeWidth={isActive ? 2.5 : 2} />
                                        </div>
                                        <span className="text-xs font-medium text-center truncate w-full px-1">
                                            {item.shortLabel}
                                        </span>
                                    </Link>
                                );
                            })}
                        </div>
                    </SheetContent>
                </Sheet>
            </nav>
        </div>
    );
}
