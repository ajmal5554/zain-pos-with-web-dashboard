import { Sun, Moon, LogOut, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

interface MobileHeaderProps {
    darkMode: boolean;
    setDarkMode: (dark: boolean) => void;
}

export function MobileHeader({ darkMode, setDarkMode }: MobileHeaderProps) {
    const { logout, user } = useAuth();
    const { isLiquidGlass, toggleLiquidGlass } = useTheme();

    return (
        <div className="flex flex-col sm:hidden sticky top-0 z-30 border-b bg-background px-4 py-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <img src="/icon.ico" className="h-6 w-6 rounded-md object-contain" alt="Zain POS Logo" />
                    <span className="font-semibold text-lg">Zain POS</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <NotificationBell />
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Toggle iOS Liquid Glass"
                        className={cn(
                            "h-8 w-8 transition-all",
                            isLiquidGlass 
                                ? "text-indigo-600 bg-indigo-500/15 dark:text-indigo-300 dark:bg-indigo-400/20" 
                                : "text-muted-foreground hover:text-foreground"
                        )}
                        onClick={toggleLiquidGlass}
                    >
                        <Sparkles className="h-4 w-4" />
                    </Button>
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
        </div>
    );
}
