import { Sun, Moon, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { NotificationBell } from '@/components/notifications/NotificationBell';

interface MobileHeaderProps {
    darkMode: boolean;
    setDarkMode: (dark: boolean) => void;
}

export function MobileHeader({ darkMode, setDarkMode }: MobileHeaderProps) {
    const { logout, user } = useAuth();

    return (
        <div className="flex flex-col sm:hidden sticky top-0 z-30 border-b bg-background px-4 py-3 gap-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <img src="/icon.ico" className="h-6 w-6 rounded-md object-contain" alt="Zain POS Logo" />
                    <span className="font-semibold text-lg">Zain POS</span>
                </div>
                <div className="flex items-center gap-2">
                    <NotificationBell />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => setDarkMode(!darkMode)}
                    >
                        {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => { logout(); window.location.href = '/login'; }}
                    >
                        <LogOut className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <div className="w-full flex justify-end">
                <DateRangePicker />
            </div>
        </div>
    );
}
