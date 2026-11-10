import { useState, useRef, useEffect } from 'react';
import { Bell, Check, BellOff, BellRing } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import type { Notification } from '@/contexts/NotificationContext';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function NotificationBell() {
    const { notifications, unreadCount, markAsRead, markAllAsRead, subscribePush, pushStatus } = useNotifications();

    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on click/touch outside or Escape
    useEffect(() => {
        function handleClickOutside(event: MouseEvent | TouchEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const handleNotificationClick = async (notification: Notification) => {
        if (!notification.read) {
            await markAsRead(notification.id);
        }
    };

    const pushLabel = () => {
        switch (pushStatus) {
            case 'subscribed': return { text: '✓ Push On', color: 'text-green-500', show: false };
            case 'denied': return { text: '🚫 Push Blocked', color: 'text-destructive', show: true };
            case 'unsupported': return { text: 'Push N/A', color: 'text-muted-foreground', show: false };
            case 'unsubscribed': return { text: 'Enable Push', color: 'text-primary', show: true };
            default: return { text: 'Enable Push', color: 'text-primary', show: true };
        }
    };

    const label = pushLabel();

    return (
        <div className="relative" ref={dropdownRef}>
            <Button
                variant="ghost"
                size="icon"
                aria-label="Notifications"
                aria-expanded={isOpen}
                className="relative text-muted-foreground"
                onClick={() => setIsOpen(!isOpen)}
            >
                {pushStatus === 'subscribed' ? (
                    <BellRing className="w-5 h-5 text-primary" />
                ) : pushStatus === 'denied' ? (
                    <BellOff className="w-5 h-5 text-destructive" />
                ) : (
                    <Bell className="w-5 h-5" />
                )}
                {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </Button>

            {isOpen && (
                <Card className="fixed inset-x-3 top-14 z-50 flex flex-col max-h-[calc(100dvh-5.5rem)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem] md:w-[25rem] sm:max-h-[75vh] shadow-lg border bg-popover text-popover-foreground">
                    <CardHeader className="p-3 sm:p-4 border-b space-y-0 flex flex-row flex-wrap items-center justify-between gap-2 shrink-0">
                        <div className="min-w-0">
                            <CardTitle className="text-sm font-semibold">Notifications</CardTitle>
                            <CardDescription className="text-xs">
                                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-1.5 sm:gap-2 items-center shrink-0">
                            {/* Push status badge */}
                            {label.show ? (
                                pushStatus === 'denied' ? (
                                    <span className={cn('text-xs font-medium', label.color)}>
                                        {label.text}
                                    </span>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={subscribePush}
                                        className="h-7 px-2.5 text-xs border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                                    >
                                        🔔 Enable Push
                                    </Button>
                                )
                            ) : pushStatus === 'subscribed' ? (
                                <span className="text-xs text-green-500 font-medium">✓ Push On</span>
                            ) : null}

                            {unreadCount > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={markAllAsRead}
                                    className="h-7 px-2 text-xs"
                                >
                                    Mark all read
                                </Button>
                            )}
                        </div>
                    </CardHeader>

                    {/* Banner if push is denied */}
                    {pushStatus === 'denied' && (
                        <div className="px-3 sm:px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive shrink-0">
                            ⚠️ Notifications blocked. Go to browser Settings → Site permissions → Notifications → Reset for this site.
                        </div>
                    )}

                    <CardContent className="p-0 flex-1 overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="p-6 sm:p-8 text-center flex flex-col items-center">
                                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                                    <Bell className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <p className="text-sm font-medium">No notifications</p>
                                <p className="text-xs text-muted-foreground mt-1">Live updates will appear here.</p>
                            </div>
                        ) : (
                            <div className="divide-y">
                                {notifications.map((notification) => (
                                    <div
                                        key={notification.id}
                                        className={cn(
                                            "flex items-start gap-3 sm:gap-4 p-3 sm:p-4 hover:bg-muted/50 cursor-default transition-colors",
                                            !notification.read && "bg-muted/30"
                                        )}
                                        onClick={() => handleNotificationClick(notification)}
                                    >
                                        <div className={cn(
                                            "mt-1.5 h-2 w-2 rounded-full shrink-0",
                                            !notification.read ? "bg-primary" : "bg-transparent"
                                        )} />
                                        <div className="flex-1 min-w-0 space-y-1">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className={cn(
                                                    "text-sm font-medium min-w-0 break-words",
                                                    !notification.read ? "text-foreground" : "text-muted-foreground"
                                                )}>
                                                    {notification.title}
                                                </p>
                                                <span className="text-[11px] sm:text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                                                    {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                                                </span>
                                            </div>
                                            <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 break-words">
                                                {notification.message}
                                            </p>
                                            <div className="flex items-center justify-between pt-1.5 gap-2">
                                                {notification.type === 'product_added' ? (
                                                    <Link
                                                        to="/products"
                                                        className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                                                        onClick={() => setIsOpen(false)}
                                                    >
                                                        View Product
                                                    </Link>
                                                ) : notification.type === 'low_stock' ? (
                                                    <Link
                                                        to="/inventory"
                                                        className="text-xs font-medium text-destructive hover:underline flex items-center gap-1"
                                                        onClick={() => setIsOpen(false)}
                                                    >
                                                        View Inventory
                                                    </Link>
                                                ) : notification.referenceId ? (
                                                    <Link
                                                        to="/sales"
                                                        className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                                                        onClick={() => setIsOpen(false)}
                                                    >
                                                        View Bill
                                                    </Link>
                                                ) : (
                                                    <Link
                                                        to="/sales"
                                                        className="text-xs font-medium text-muted-foreground hover:underline flex items-center gap-1"
                                                        onClick={() => setIsOpen(false)}
                                                    >
                                                        Sales Activity
                                                    </Link>
                                                )}
                                                {!notification.read && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label="Mark notification as read"
                                                        className="h-6 w-6 rounded-full shrink-0"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            markAsRead(notification.id);
                                                        }}
                                                    >
                                                        <Check className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export function MobileNotificationBell() {
    return <NotificationBell />;
}
