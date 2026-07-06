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

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
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
                <Card className="absolute right-0 z-50 mt-2 w-[22rem] md:w-[25rem] shadow-md border bg-popover text-popover-foreground">
                    <CardHeader className="p-4 border-b space-y-0 flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="text-sm font-semibold">Notifications</CardTitle>
                            <CardDescription className="text-xs">
                                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                            </CardDescription>
                        </div>
                        <div className="flex gap-2 items-center">
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
                                        className="h-7 text-xs border-primary text-primary hover:bg-primary hover:text-primary-foreground"
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
                                    className="h-7 text-xs"
                                >
                                    Mark all read
                                </Button>
                            )}
                        </div>
                    </CardHeader>

                    {/* Banner if push is denied */}
                    {pushStatus === 'denied' && (
                        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive">
                            ⚠️ Notifications blocked. Go to browser Settings → Site permissions → Notifications → Reset for this site.
                        </div>
                    )}

                    <CardContent className="p-0 max-h-[60vh] overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="p-8 text-center flex flex-col items-center">
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
                                            "flex items-start gap-4 p-4 hover:bg-muted/50 cursor-default transition-colors",
                                            !notification.read && "bg-muted/30"
                                        )}
                                        onClick={() => handleNotificationClick(notification)}
                                    >
                                        <div className={cn(
                                            "mt-1.5 h-2 w-2 rounded-full shrink-0",
                                            !notification.read ? "bg-primary" : "bg-transparent"
                                        )} />
                                        <div className="flex-1 space-y-1">
                                            <div className="flex items-center justify-between">
                                                <p className={cn(
                                                    "text-sm font-medium",
                                                    !notification.read ? "text-foreground" : "text-muted-foreground"
                                                )}>
                                                    {notification.title}
                                                </p>
                                                <span className="text-xs text-muted-foreground">
                                                    {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                                                </span>
                                            </div>
                                            <p className="text-sm text-muted-foreground line-clamp-2">
                                                {notification.message}
                                            </p>
                                            <div className="flex items-center justify-between pt-2">
                                                {notification.referenceId ? (
                                                    <Link
                                                        to="/invoices"
                                                        className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                                                        onClick={() => setIsOpen(false)}
                                                    >
                                                        View record
                                                    </Link>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">Activity</span>
                                                )}
                                                {!notification.read && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6 rounded-full"
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
