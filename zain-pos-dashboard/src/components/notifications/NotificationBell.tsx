import { useState, useRef, useEffect } from 'react';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import type { Notification } from '@/contexts/NotificationContext';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

export function NotificationBell() {
    const { notifications, unreadCount, markAsRead, markAllAsRead, subscribePush, isPushEnabled } = useNotifications();


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
        // If it has a link or action, handle it?
        // Usually clicking notification navigates.
        // For now, if referencing an invoice, maybe link to invoices?
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <Button
                variant="ghost"
                size="icon"
                className="relative text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"
                onClick={() => setIsOpen(!isOpen)}
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <>
                        <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-500" />
                        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-950 px-1 text-[10px] font-semibold text-white dark:bg-sky-400 dark:text-slate-950">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    </>
                )}
            </Button>

            {isOpen && (
                <div className="absolute right-0 z-50 mt-3 w-[22rem] overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/[0.95] shadow-[0_32px_80px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/[0.95] md:w-[25rem]">
                    <div className="border-b border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Notifications</h3>
                                <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                                    {unreadCount > 0 ? `${unreadCount} unread updates` : 'Everything is caught up'}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                {!isPushEnabled && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={subscribePush}
                                        className="h-8 rounded-full px-3 text-xs font-semibold text-sky-700 hover:bg-sky-50 hover:text-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/30"
                                    >
                                        Enable Push
                                    </Button>
                                )}
                                {unreadCount > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={markAllAsRead}
                                        className="h-8 rounded-full px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"
                                    >
                                        Mark all read
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="max-h-[70vh] overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="px-6 py-12 text-center">
                                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                                    <Bell className="h-6 w-6" />
                                </div>
                                <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-300">
                                    No notifications yet
                                </p>
                                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                                    Live sales and audit events will appear here.
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {notifications.map((notification) => (
                                    <div
                                        key={notification.id}
                                        className={cn(
                                            "group px-4 py-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/70",
                                            !notification.read && "bg-sky-50/50 dark:bg-sky-950/10"
                                        )}
                                        onClick={() => handleNotificationClick(notification)}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={cn(
                                                "mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full",
                                                !notification.read ? "bg-sky-500" : "bg-slate-200 dark:bg-slate-800"
                                            )} />
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex items-start justify-between gap-3">
                                                    <p className={cn(
                                                        "text-sm leading-5",
                                                        !notification.read
                                                            ? "font-semibold text-slate-950 dark:text-white"
                                                            : "font-medium text-slate-600 dark:text-slate-300"
                                                    )}>
                                                        {notification.title}
                                                    </p>
                                                    <span className="whitespace-nowrap text-[10px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                                                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                                                    </span>
                                                </div>
                                                <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                                                    {notification.message}
                                                </p>
                                                <div className="flex items-center justify-between pt-1">
                                                    {notification.referenceId ? (
                                                        <Link
                                                            to="/invoices"
                                                            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-800 dark:text-sky-300"
                                                            onClick={() => setIsOpen(false)}
                                                        >
                                                            View record <ExternalLink className="h-3 w-3" />
                                                        </Link>
                                                    ) : (
                                                        <span className="text-xs text-slate-400 dark:text-slate-500">
                                                            Activity feed item
                                                        </span>
                                                    )}
                                                    {!notification.read && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-slate-900 dark:hover:text-white"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                markAsRead(notification.id);
                                                            }}
                                                        >
                                                            <Check className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// Mobile Notification Page Link/Icon (simpler version for mobile header if needed)
export function MobileNotificationBell() {
    // const { unreadCount } = useNotifications();

    // On mobile, maybe we just navigate to a page or open a drawer?
    // User requested "Red dot on bell icon".
    // Let's reuse the dropdown logic but maybe full screen or just same logic.
    // For now, same component works.
    return <NotificationBell />;

    // Alternatively, if we wanted a link to /notifications page:
    /*
    return (
        <Link to="/notifications" className="relative p-2">
            <Bell className="w-6 h-6 text-gray-600" />
            {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
            )}
        </Link>
    );
    */
}
