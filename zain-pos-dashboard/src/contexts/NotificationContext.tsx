import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { toast } from 'react-hot-toast';
import { API_URL } from '../lib/config';

export interface Notification {
    id: string;
    type: 'sale' | 'invoice_deleted' | 'invoice_updated';
    title: string;
    message: string;
    read: boolean;
    createdAt: string;
    referenceId?: string;
    metadata?: any;
}

export type PushStatus = 'unknown' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

interface NotificationContextType {
    notifications: Notification[];
    unreadCount: number;
    loading: boolean;
    pushStatus: PushStatus;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    subscribePush: () => Promise<void>;
    isPushEnabled: boolean;
}

const VAPID_PUBLIC_KEY = 'BDJxTZeB4JeyjNGNYEVBzMcOL2GbbeqK_zT86JaoH23gqrxVtOJMeVUuroZ_yiL8Ay2t8y1KM6Fm273kNC34XPY';

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
    const { user, token } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [pushStatus, setPushStatus] = useState<PushStatus>('unknown');
    const subscribeAttempted = useRef(false);

    const isPushEnabled = pushStatus === 'subscribed';

    // ── Register push subscription with backend ──────────────────────────────
    const saveSubscriptionToBackend = useCallback(async (sub: PushSubscription, authToken: string) => {
        const res = await fetch(`${API_URL}/api/notifications/subscribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify(sub.toJSON())
        });
        if (!res.ok) throw new Error(`Backend subscribe failed: ${res.status}`);
    }, []);

    // ── Core subscribe function ───────────────────────────────────────────────
    const subscribePush = useCallback(async () => {
        if (!user || !token) return;

        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('[Push] Not supported in this browser');
            setPushStatus('unsupported');
            return;
        }

        try {
            const registration = await navigator.serviceWorker.ready;

            // Request permission if not already granted
            let permission = Notification.permission;
            if (permission === 'default') {
                permission = await Notification.requestPermission();
            }

            if (permission !== 'granted') {
                console.warn('[Push] Permission denied or dismissed:', permission);
                setPushStatus('denied');
                return;
            }

            // Check if a subscription already exists
            let sub = await registration.pushManager.getSubscription();

            if (!sub) {
                // Create new subscription
                sub = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                });
                console.log('[Push] New subscription created:', sub.endpoint.slice(0, 60) + '...');
            } else {
                console.log('[Push] Existing subscription found, re-registering with backend');
            }

            // Always save/re-save to backend to ensure DB is in sync
            await saveSubscriptionToBackend(sub, token);

            setPushStatus('subscribed');
            toast.success('🔔 Push notifications enabled!');
        } catch (error: any) {
            console.error('[Push] Subscribe failed:', error);
            // Don't show error toast for dismissed permission dialogs
            if (error?.name !== 'NotAllowedError') {
                toast.error('Push setup failed — check console');
            }
            setPushStatus('unsubscribed');
        }
    }, [user, token, saveSubscriptionToBackend]);

    // ── Socket + initial fetch ────────────────────────────────────────────────
    useEffect(() => {
        if (!user || !token) return;

        setLoading(true);

        fetch(`${API_URL}/api/notifications`, {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setNotifications(data);
                    setUnreadCount(data.filter((n: Notification) => !n.read).length);
                }
            })
            .catch(err => console.error('[Notifications] Fetch failed:', err))
            .finally(() => setLoading(false));

        // WebSocket — prefer WS transport, reconnect forever
        const socket = io(API_URL, {
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10000,
        });

        socket.on('connect', () => console.log('[Socket] Connected:', socket.id));
        socket.on('disconnect', reason => console.warn('[Socket] Disconnected:', reason));

        socket.on('notification', (notification: Notification) => {
            const audio = new Audio('/sounds/notification.mp3');
            audio.play().catch(() => { });
            toast(`${notification.title}: ${notification.message}`, { icon: '🔔', duration: 5000 });
            setNotifications(prev => [notification, ...prev]);
            setUnreadCount(prev => prev + 1);
        });

        return () => { socket.disconnect(); };
    }, [user, token]);

    // ── Check current push state on login ─────────────────────────────────────
    useEffect(() => {
        if (!user || !token) return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            setPushStatus('unsupported');
            return;
        }

        navigator.serviceWorker.ready.then(async reg => {
            const sub = await reg.pushManager.getSubscription();
            const permission = Notification.permission;

            if (permission === 'denied') {
                setPushStatus('denied');
                return;
            }

            if (sub) {
                // Has subscription — re-register with backend silently
                try {
                    await saveSubscriptionToBackend(sub, token);
                    setPushStatus('subscribed');
                    console.log('[Push] Subscription re-confirmed with backend');
                } catch (e) {
                    console.warn('[Push] Backend re-registration failed:', e);
                    setPushStatus('subscribed'); // still subscribed in browser
                }
            } else {
                setPushStatus('unsubscribed');
            }
        }).catch(e => {
            console.warn('[Push] SW ready failed:', e);
            setPushStatus('unsupported');
        });
    }, [user, token, saveSubscriptionToBackend]);

    // ── Auto-subscribe 3s after login if push not enabled ────────────────────
    useEffect(() => {
        if (!user || !token) return;
        if (pushStatus === 'subscribed' || pushStatus === 'denied' || pushStatus === 'unsupported') return;
        if (subscribeAttempted.current) return;

        const timer = setTimeout(async () => {
            subscribeAttempted.current = true;
            console.log('[Push] Auto-subscribing...');
            await subscribePush();
        }, 3500);

        return () => clearTimeout(timer);
    }, [user, token, pushStatus, subscribePush]);

    // Reset attempt flag on logout
    useEffect(() => {
        if (!user) subscribeAttempted.current = false;
    }, [user]);

    // ── Actions ───────────────────────────────────────────────────────────────
    const markAsRead = async (id: string) => {
        try {
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
            setUnreadCount(prev => Math.max(0, prev - 1));
            await fetch(`${API_URL}/api/notifications/${id}/read`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (error) {
            console.error('Failed to mark as read', error);
        }
    };

    const markAllAsRead = async () => {
        try {
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            setUnreadCount(0);
            await fetch(`${API_URL}/api/notifications/read-all`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (error) {
            console.error('Failed to mark all as read', error);
        }
    };

    return (
        <NotificationContext.Provider value={{
            notifications,
            unreadCount,
            loading,
            pushStatus,
            markAsRead,
            markAllAsRead,
            subscribePush,
            isPushEnabled
        }}>
            {children}
        </NotificationContext.Provider>
    );
}

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (!context) throw new Error('useNotifications must be used within a NotificationProvider');
    return context;
};

// Utility
function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}
