import { create } from 'zustand';
import { messagingService } from '../services/messaging.service';
import type { WhatsAppConversation } from '../types/messaging';

export interface IncomingWhatsAppPopup {
    phone: string;
    name: string;
    preview: string;
    receivedAt: string;
    windowOpen: boolean;
}

interface WhatsAppInboxState {
    conversations: WhatsAppConversation[];
    unreadCount: number;
    cloudReachable: boolean;
    loading: boolean;
    initialized: boolean;
    seenInboundAtMap: Record<string, number>;
    popupAlert: IncomingWhatsAppPopup | null;
    targetPhoneToOpen: string | null;

    refreshInbox: (silent?: boolean) => Promise<void>;
    markReadLocally: (phone: string) => void;
    dismissPopup: () => void;
    requestOpenThread: (phone: string | null) => void;
}

function playNotificationChime() {
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const playTone = (freq: number, startOffset: number, duration: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + startOffset);
            gain.gain.setValueAtTime(0.001, now + startOffset);
            gain.gain.exponentialRampToValueAtTime(0.14, now + startOffset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + startOffset);
            osc.stop(now + startOffset + duration);
        };

        playTone(880, 0, 0.14);
        playTone(1174.66, 0.12, 0.22);

        setTimeout(() => {
            ctx.close().catch(() => {});
        }, 600);
    } catch {
        // Ignore browser autoplay restrictions
    }
}

let inFlightFetch = false;

export const useWhatsAppInboxStore = create<WhatsAppInboxState>((set, get) => ({
    conversations: [],
    unreadCount: 0,
    cloudReachable: false,
    loading: false,
    initialized: false,
    seenInboundAtMap: {},
    popupAlert: null,
    targetPhoneToOpen: null,

    refreshInbox: async (silent = true) => {
        if (inFlightFetch) return;
        inFlightFetch = true;
        if (!silent && !get().initialized) {
            set({ loading: true });
        }

        try {
            const res = await messagingService.getConversations();
            const threads = res.conversations || [];
            const totalUnread = threads.reduce((sum, t) => sum + (t.unreadCount || 0), 0);

            const { initialized, seenInboundAtMap } = get();
            const nextSeen = { ...seenInboundAtMap };
            let newestPopup: IncomingWhatsAppPopup | null = null;

            for (const t of threads) {
                const inboundMs = t.lastInboundAt
                    ? new Date(t.lastInboundAt).getTime()
                    : t.lastDirection === 'INBOUND'
                    ? new Date(t.lastMessageAt).getTime()
                    : 0;

                if (inboundMs > 0) {
                    const prevMs = nextSeen[t.phone] || 0;
                    if (initialized && inboundMs > prevMs && t.unreadCount > 0) {
                        newestPopup = {
                            phone: t.phone,
                            name: t.name || `+${t.phone}`,
                            preview: t.lastMessage,
                            receivedAt: t.lastMessageAt,
                            windowOpen: t.windowOpen,
                        };
                    }
                    if (inboundMs > prevMs) {
                        nextSeen[t.phone] = inboundMs;
                    }
                }
            }

            if (newestPopup) {
                playNotificationChime();
                if (!document.hasFocus() && window.electronAPI?.messaging?.showDesktopNotification) {
                    window.electronAPI.messaging
                        .showDesktopNotification({
                            title: `WhatsApp from ${newestPopup.name}`,
                            body: newestPopup.preview,
                            phone: newestPopup.phone,
                        })
                        .catch(() => {});
                }
            }

            set({
                conversations: threads,
                unreadCount: totalUnread,
                cloudReachable: res.cloudReachable,
                loading: false,
                initialized: true,
                seenInboundAtMap: nextSeen,
                ...(newestPopup ? { popupAlert: newestPopup } : {}),
            });
        } catch {
            set({ loading: false });
        } finally {
            inFlightFetch = false;
        }
    },

    markReadLocally: (phone: string) => {
        set((state) => {
            const updated = state.conversations.map((c) =>
                c.phone === phone ? { ...c, unreadCount: 0 } : c
            );
            const totalUnread = updated.reduce((sum, t) => sum + (t.unreadCount || 0), 0);
            const clearPopup = state.popupAlert?.phone === phone ? { popupAlert: null } : {};
            return { conversations: updated, unreadCount: totalUnread, ...clearPopup };
        });
    },

    dismissPopup: () => set({ popupAlert: null }),

    requestOpenThread: (phone: string | null) => set({ targetPhoneToOpen: phone }),
}));

