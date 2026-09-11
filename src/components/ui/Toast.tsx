import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
}

// Global programmatic trigger
export const showToast = (message: string, type: ToastType = 'info', durationMs: number = 3500) => {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app-toast', {
            detail: { message: String(message ?? ''), type, durationMs }
        }));
    }
};

export const ToastContainer: React.FC = () => {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    useEffect(() => {
        // Intercept native window.alert to prevent native modal freezing in Electron
        const originalAlert = window.alert;
        window.alert = (msg?: any) => {
            showToast(String(msg ?? ''), 'warning');
        };

        const handleToastEvent = (e: Event) => {
            const customEvent = e as CustomEvent<{ message: string; type?: ToastType; durationMs?: number }>;
            const { message, type = 'info', durationMs = 3500 } = customEvent.detail || {};
            if (!message) return;

            const id = Date.now() + Math.random();
            const newToast: ToastItem = { id, message, type };

            setToasts(prev => [...prev.slice(-4), newToast]); // Keep up to 5 toasts

            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, durationMs);
        };

        window.addEventListener('app-toast', handleToastEvent);

        return () => {
            window.removeEventListener('app-toast', handleToastEvent);
            window.alert = originalAlert;
        };
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none max-w-md w-full px-4">
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-xs sm:text-sm font-semibold transition-all animate-in fade-in slide-in-from-top-3 duration-200 ${
                        toast.type === 'error'
                            ? 'bg-red-600 text-white border-red-700 shadow-red-500/25 ring-2 ring-red-400/30'
                            : toast.type === 'success'
                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-emerald-500/25 ring-2 ring-emerald-400/30'
                            : toast.type === 'warning'
                            ? 'bg-amber-500 text-white border-amber-600 shadow-amber-500/25 ring-2 ring-amber-400/30'
                            : 'bg-blue-600 text-white border-blue-700 shadow-blue-500/25 ring-2 ring-blue-400/30'
                    }`}
                >
                    {toast.type === 'error' && <AlertCircle className="w-5 h-5 flex-shrink-0 animate-pulse" />}
                    {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
                    {toast.type === 'success' && <CheckCircle className="w-5 h-5 flex-shrink-0" />}
                    {toast.type === 'info' && <Info className="w-5 h-5 flex-shrink-0" />}
                    
                    <span className="flex-1 leading-snug whitespace-pre-line">{toast.message}</span>
                    
                    <button
                        type="button"
                        onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                        className="p-1 hover:bg-white/20 rounded-lg transition-colors text-white/80 hover:text-white flex-shrink-0"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
};
