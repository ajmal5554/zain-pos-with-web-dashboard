import { Link, useLocation } from 'react-router-dom';
import {
    LogOut
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { navigation } from './navigation';



export function Sidebar({ isOpen }: { isOpen: boolean }) {
    const { logout } = useAuth();
    const location = useLocation();

    return (
        <aside
            className="fixed inset-y-0 left-0 z-10 hidden w-52 flex-col border-r border-border bg-background sm:flex"
        >
            <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
                <Link to="/" className="flex items-center gap-2 font-semibold pb-1">
                    <img src="/icon.ico" className="h-7 w-7 rounded-md object-contain" alt="Zain POS Logo" />
                    <span className="text-lg">Zain POS</span>
                </Link>
            </div>

            <div className="flex-1 overflow-auto py-2">
                <nav className="grid items-start px-2 text-sm font-medium lg:px-4 space-y-1">
                    {navigation.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.href;

                        return (
                            <Link
                                key={item.name}
                                to={item.href}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
                                    isActive ? "bg-muted text-primary" : "text-muted-foreground"
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div className="mt-auto p-4 border-t">
                <Button
                    variant="ghost"
                    className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
                    onClick={() => { logout(); window.location.href = '/login'; }}
                >
                    <LogOut className="h-4 w-4" />
                    Logout
                </Button>
            </div>
        </aside>
    );
}
