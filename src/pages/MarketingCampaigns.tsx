import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
    Megaphone,
    Send,
    CheckCircle2,
    RefreshCw,
    Image as ImageIcon,
    Phone,
    MapPin,
    MessageCircle,
    Search,
    Clock,
    Info,
    CheckSquare,
    Square,
    MessageSquare
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { showToast } from '../components/ui/Toast';
import { WhatsAppInboxTab } from '../components/marketing/WhatsAppInboxTab';
import {
    CampaignMediaPicker,
    type CampaignMediaMode,
    type ColorPhotoSlot,
} from '../components/marketing/CampaignMediaPicker';
import { stitchColorGridCollage, type StitchedCollageResult } from '../lib/imageCollage';
import { messagingService } from '../services/messaging.service';
import { useWhatsAppInboxStore } from '../store/whatsappInboxStore';
import { db } from '../lib/db';
import type {
    CampaignRecipient,
    SendCampaignPayload,
    MessageLogRecord,
    CarouselCardPayload,
} from '../types/messaging';

interface TemplateVariableValues {
    collectionName: string;
    details: string;
    sizes: string;
    startingPrice: string;
}

const DEFAULT_CAROUSEL_SLOTS: ColorPhotoSlot[] = [
    { id: 'card-0', dataUrl: '', mimeType: '', filename: '', colorLabel: 'Navy Blue', sizes: 'M, L, XL, XXL', price: '1,299' },
    { id: 'card-1', dataUrl: '', mimeType: '', filename: '', colorLabel: 'Olive Green', sizes: 'M, L, XL, XXL', price: '1,299' },
    { id: 'card-2', dataUrl: '', mimeType: '', filename: '', colorLabel: 'Maroon Red', sizes: 'M, L, XL, XXL', price: '1,299' },
    { id: 'card-3', dataUrl: '', mimeType: '', filename: '', colorLabel: 'Classic Beige', sizes: 'M, L, XL, XXL', price: '1,299' },
];

export const MarketingCampaigns: React.FC = () => {
    const location = useLocation();
    // Tab Navigation
    const [activeTab, setActiveTab] = useState<'BROADCAST' | 'INBOX' | 'HISTORY'>(() =>
        new URLSearchParams(location.search).get('tab') === 'inbox' ? 'INBOX' : 'BROADCAST'
    );
    const unreadInboxCount = useWhatsAppInboxStore((s) => s.unreadCount);

    useEffect(() => {
        if (new URLSearchParams(location.search).get('tab') === 'inbox') {
            setActiveTab('INBOX');
        }
    }, [location.search]);

    // Customer & Audience State
    const [customers, setCustomers] = useState<CampaignRecipient[]>([]);
    const [loadingCustomers, setLoadingCustomers] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
    const [activeSegment, setActiveSegment] = useState<'ALL' | 'RECENT' | 'VIP' | 'INACTIVE'>('ALL');

    // Campaign Builder State
    const [campaignName, setCampaignName] = useState('New Stock Drop - Linen Collection');
    const [mediaMode, setMediaMode] = useState<CampaignMediaMode>('SINGLE');
    const [variables, setVariables] = useState<TemplateVariableValues>({
        collectionName: 'Pure Linen Casual Shirts',
        details: 'Pure breathable linen in 6 premium colors',
        sizes: 'M, L, XL, XXL',
        startingPrice: '1,299',
    });

    // Image & Carousel Media State
    const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
    const [uploadedMediaId, setUploadedMediaId] = useState<string | null>(null);
    const [collagePhotos, setCollagePhotos] = useState<ColorPhotoSlot[]>([]);
    const [stitchedCollage, setStitchedCollage] = useState<StitchedCollageResult | null>(null);
    const [uploadedCollageMediaId, setUploadedCollageMediaId] = useState<string | null>(null);
    const [carouselCards, setCarouselCards] = useState<ColorPhotoSlot[]>(DEFAULT_CAROUSEL_SLOTS);
    const [isUploadingMedia, setIsUploadingMedia] = useState(false);

    const activeTemplateName = mediaMode === 'CAROUSEL' ? 'new_stock_carousel' : 'new_stock_arrival';

    // Dispatching Progress State
    const [isSending, setIsSending] = useState(false);
    const [sendProgress, setSendProgress] = useState({ current: 0, total: 0, success: 0, failed: 0 });
    const [showConfirmModal, setShowConfirmModal] = useState(false);

    // History & Logs
    const [logs, setLogs] = useState<MessageLogRecord[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const statusPollTimersRef = useRef<number[]>([]);

    useEffect(() => {
        return () => {
            statusPollTimersRef.current.forEach((id) => window.clearTimeout(id));
            statusPollTimersRef.current = [];
        };
    }, []);

    // Load Customers and Past Sales on Mount
    useEffect(() => {
        loadAudienceData();
    }, []);

    const loadAudienceData = async () => {
        setLoadingCustomers(true);
        try {
            const [customerData, salesData] = await Promise.all([
                db.customers.findMany({ orderBy: { createdAt: 'desc' } }).catch(() => []),
                db.sales.findMany({
                    where: { status: 'COMPLETED' },
                    select: {
                        id: true,
                        customerPhone: true,
                        customerName: true,
                        grandTotal: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: 'desc' },
                }).catch(() => []),
            ]);

            // Calculate spend and last visit per phone
            const spendMap: Record<string, { totalSpend: number; lastVisit: Date; name: string }> = {};
            if (Array.isArray(salesData)) {
                salesData.forEach((s: any) => {
                    const phone = (s.customerPhone || '').trim();
                    if (!phone) return;
                    if (!spendMap[phone]) {
                        spendMap[phone] = {
                            totalSpend: 0,
                            lastVisit: new Date(s.createdAt),
                            name: s.customerName || '',
                        };
                    }
                    spendMap[phone].totalSpend += Number(s.grandTotal) || 0;
                    const saleDate = new Date(s.createdAt);
                    if (saleDate > spendMap[phone].lastVisit) {
                        spendMap[phone].lastVisit = saleDate;
                    }
                });
            }

            // Merge unique customers
            const audienceMap = new Map<string, CampaignRecipient>();
            (customerData || []).forEach((c: any) => {
                const phone = (c.phone || '').trim();
                if (!phone) return;
                const metrics = spendMap[phone];
                audienceMap.set(phone, {
                    id: c.id,
                    name: c.name || metrics?.name || 'Customer',
                    phone: phone,
                    totalSpend: metrics?.totalSpend || 0,
                    lastVisitDate: metrics?.lastVisit ? metrics.lastVisit.toISOString() : c.createdAt,
                });
            });

            // Add customers from sales who weren't in customers table
            Object.keys(spendMap).forEach((phone) => {
                if (!audienceMap.has(phone)) {
                    const data = spendMap[phone];
                    audienceMap.set(phone, {
                        id: `cust-phone-${phone}`,
                        name: data.name && !data.name.toLowerCase().includes('walk-in') ? data.name : `Customer ${phone}`,
                        phone: phone,
                        totalSpend: data.totalSpend,
                        lastVisitDate: data.lastVisit.toISOString(),
                    });
                }
            });

            const finalAudience = Array.from(audienceMap.values());
            setCustomers(finalAudience);

            // Default to selecting all customers
            setSelectedCustomerIds(new Set(finalAudience.map((c) => c.id)));
        } catch (err: any) {
            console.error('Failed to load audience:', err);
            showToast('Failed to load customer list', 'error');
        } finally {
            setLoadingCustomers(false);
        }
    };

    const loadHistory = async () => {
        setLoadingLogs(true);
        try {
            const syncRes = await messagingService.syncDeliveryStatuses().catch(() => ({ updated: 0, failedCount: 0, latestErrors: [] }));
            const historyLogs = await messagingService.getLogs({ limit: 100 });
            setLogs(historyLogs || []);
            return syncRes;
        } catch (err) {
            console.warn('Failed to load logs:', err);
            return { updated: 0, failedCount: 0, latestErrors: [] };
        } finally {
            setLoadingLogs(false);
        }
    };

    // Filter customers based on segment and search
    const filteredAudience = useMemo(() => {
        const now = new Date().getTime();
        const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

        return customers.filter((c) => {
            const matchesSearch =
                !searchQuery ||
                c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.phone.includes(searchQuery);

            if (!matchesSearch) return false;

            const visitTime = c.lastVisitDate ? new Date(c.lastVisitDate).getTime() : 0;
            const isRecent = now - visitTime <= sixtyDaysMs;

            if (activeSegment === 'RECENT') return isRecent;
            if (activeSegment === 'INACTIVE') return !isRecent;
            if (activeSegment === 'VIP') return (c.totalSpend || 0) >= 3000;
            return true;
        });
    }, [customers, activeSegment, searchQuery]);

    // Auto-stitch Multi-Color Grid whenever photos or collection title changes
    useEffect(() => {
        if (mediaMode !== 'COLLAGE' || collagePhotos.length < 2) {
            setStitchedCollage(null);
            setUploadedCollageMediaId(null);
            return;
        }
        let cancelled = false;
        stitchColorGridCollage(
            collagePhotos.map((p) => ({ dataUrl: p.dataUrl, label: p.colorLabel })),
            variables.collectionName
        )
            .then((result) => {
                if (!cancelled) {
                    setStitchedCollage(result);
                    setUploadedCollageMediaId(null);
                }
            })
            .catch((err) => {
                if (!cancelled) console.warn('Collage preview error:', err);
            });
        return () => {
            cancelled = true;
        };
    }, [mediaMode, collagePhotos, variables.collectionName]);

    // Toggle customer selection
    const toggleCustomerSelection = (id: string) => {
        setSelectedCustomerIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAllFiltered = () => {
        setSelectedCustomerIds((prev) => {
            const next = new Set(prev);
            filteredAudience.forEach((c) => next.add(c.id));
            return next;
        });
    };

    const deselectAllFiltered = () => {
        setSelectedCustomerIds((prev) => {
            const next = new Set(prev);
            filteredAudience.forEach((c) => next.delete(c.id));
            return next;
        });
    };

    // Upload a base64 Data URL to Meta WhatsApp Media API
    const uploadDataUrlToMeta = async (dataUrl: string, mimeType: string, filename: string): Promise<string | null> => {
        const base64Data = dataUrl.split(',')[1];
        if (!base64Data) {
            showToast('Could not parse image data for upload.', 'error');
            return null;
        }
        const res = await messagingService.uploadMedia(base64Data, mimeType, filename);
        if (!res.success || !res.mediaId) {
            showToast(`Image upload failed: ${res.error || 'Unknown error'}`, 'error');
            return null;
        }
        return res.mediaId;
    };

    // Start Campaign Broadcast
    const handleStartBroadcast = async () => {
        setShowConfirmModal(false);

        const recipientsToSend = customers.filter((c) => selectedCustomerIds.has(c.id));
        if (recipientsToSend.length === 0) {
            showToast('Please select at least one customer to broadcast to', 'warning');
            return;
        }

        // Validate photos per mode
        if (mediaMode === 'SINGLE' && (!selectedImageFile || !imagePreviewUrl)) {
            showToast('Please pick a product photo before broadcasting.', 'warning');
            return;
        }
        if (mediaMode === 'COLLAGE' && collagePhotos.length < 2) {
            showToast('Please add 2 to 6 color photos for the stitched color grid.', 'warning');
            return;
        }
        if (mediaMode === 'CAROUSEL' && carouselCards.some((c) => !c.dataUrl)) {
            showToast('Please select photos for all 4 Carousel cards before broadcasting.', 'warning');
            return;
        }

        setIsSending(true);
        setSendProgress({ current: 0, total: recipientsToSend.length, success: 0, failed: 0 });

        let headerMediaId: string | undefined;
        let preparedCarouselCards: CarouselCardPayload[] | undefined;

        setIsUploadingMedia(true);
        try {
            if (mediaMode === 'SINGLE' && selectedImageFile && imagePreviewUrl) {
                const id = uploadedMediaId || (await uploadDataUrlToMeta(imagePreviewUrl, selectedImageFile.type, selectedImageFile.name));
                if (!id) return;
                setUploadedMediaId(id);
                headerMediaId = id;
            } else if (mediaMode === 'COLLAGE') {
                const collage =
                    stitchedCollage ||
                    (await stitchColorGridCollage(
                        collagePhotos.map((p) => ({ dataUrl: p.dataUrl, label: p.colorLabel })),
                        variables.collectionName
                    ));
                const id = uploadedCollageMediaId || (await uploadDataUrlToMeta(collage.dataUrl, collage.mimeType, collage.filename));
                if (!id) return;
                setUploadedCollageMediaId(id);
                headerMediaId = id;
            } else if (mediaMode === 'CAROUSEL') {
                const uploadedSlots: CarouselCardPayload[] = [];
                const updatedCards = [...carouselCards];

                for (let i = 0; i < updatedCards.length; i++) {
                    const card = updatedCards[i];
                    const id = card.uploadedMediaId || (await uploadDataUrlToMeta(card.dataUrl, card.mimeType || 'image/jpeg', card.filename || `card-${i + 1}.jpg`));
                    if (!id) return;
                    updatedCards[i] = { ...card, uploadedMediaId: id };
                    uploadedSlots.push({
                        mediaId: id,
                        colorName: card.colorLabel || `Color ${i + 1}`,
                        sizes: card.sizes || variables.sizes || 'M, L, XL',
                        price: card.price || variables.startingPrice || '999',
                    });
                }
                setCarouselCards(updatedCards);
                preparedCarouselCards = uploadedSlots;
            }
        } catch (uploadErr: any) {
            showToast(`Media preparation failed: ${uploadErr.message}`, 'error');
            return;
        } finally {
            setIsUploadingMedia(false);
        }

        try {
            const payload: SendCampaignPayload = {
                campaignName,
                templateName: activeTemplateName,
                languageCode: 'en_US',
                headerMediaId,
                carouselCards: preparedCarouselCards,
                templateParams: [
                    variables.collectionName || 'New Collection',
                    variables.details || 'Fresh stock available in store',
                    variables.sizes || 'All Sizes',
                    variables.startingPrice || '999',
                ],
                recipients: recipientsToSend,
            };

            const result = await messagingService.sendCampaign(payload);

            if (result.sent > 0) {
                showToast(
                    `Meta accepted ${result.sent} campaign message(s) for delivery. Verifying phone delivery status...`,
                    'info'
                );

                statusPollTimersRef.current.forEach((id) => window.clearTimeout(id));
                statusPollTimersRef.current = [4000, 10000].map((delayMs) =>
                    window.setTimeout(async () => {
                        const syncRes = await loadHistory();
                        if (syncRes.failedCount > 0 && syncRes.latestErrors.length > 0) {
                            showToast(`Meta delivery failure: ${syncRes.latestErrors[0]}`, 'error');
                        }
                    }, delayMs)
                );
            }
            if (result.failed > 0) {
                const firstErr = result.errors?.[0]?.error;
                showToast(
                    firstErr
                        ? `${result.failed} message(s) rejected: ${firstErr}`
                        : `${result.failed} messages could not be delivered.`,
                    'warning'
                );
            }
        } catch (err: any) {
            showToast(`Campaign broadcast error: ${err.message}`, 'error');
        } finally {
            setIsSending(false);
            setIsUploadingMedia(false);
            loadHistory();
        }
    };

    const selectedRecipientsCount = useMemo(() => {
        return customers.filter((c) => selectedCustomerIds.has(c.id)).length;
    }, [customers, selectedCustomerIds]);

    const estimatedMetaCost = (selectedRecipientsCount * 1.0).toFixed(2);

    return (
        <div className="w-full space-y-6 pb-8">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                        <span className="p-2 bg-white/20 backdrop-blur-md rounded-xl">
                            <Megaphone className="w-5 h-5 text-white" />
                        </span>
                        <h1 className="text-xl md:text-2xl font-bold tracking-tight">WhatsApp Marketing Hub</h1>
                        <span className="bg-emerald-400/30 text-emerald-100 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-emerald-300/30">
                            Meta Cloud API
                        </span>
                    </div>
                    <p className="text-emerald-100 text-xs md:text-sm max-w-2xl">
                        Send new stock lookbook photos, festive discount announcements, and store credit alerts directly to your customers' WhatsApp.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/15 text-xs text-emerald-50">
                        <div className="text-emerald-200 text-[10px] uppercase font-bold tracking-wider">Registered Shop Phone</div>
                        <div className="font-mono font-bold text-sm text-white">+91 97784 04804</div>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-2">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setActiveTab('BROADCAST')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                            activeTab === 'BROADCAST'
                                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                    >
                        <Megaphone className="w-4 h-4" />
                        <span>Create & Broadcast Campaign</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('INBOX')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                            activeTab === 'INBOX'
                                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                    >
                        <MessageSquare className="w-4 h-4" />
                        <span>Live Customer Inbox</span>
                        {unreadInboxCount > 0 && (
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                activeTab === 'INBOX'
                                    ? 'bg-white text-emerald-700'
                                    : 'bg-emerald-600 text-white'
                            }`}>
                                {unreadInboxCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('HISTORY');
                            loadHistory();
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                            activeTab === 'HISTORY'
                                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                    >
                        <Clock className="w-4 h-4" />
                        <span>Broadcast History & Logs</span>
                    </button>
                </div>

                {activeTab === 'BROADCAST' && (
                    <div className="text-xs text-gray-500 flex items-center gap-1.5">
                        <Info className="w-4 h-4 text-emerald-600" />
                        <span>Meta Marketing Rate: <strong>~₹1.00 / message</strong></span>
                    </div>
                )}
            </div>

            {/* TAB 1: BROADCAST CAMPAIGN */}
            {activeTab === 'BROADCAST' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* LEFT COLUMN: Campaign Builder Form (7 Cols) */}
                    <div className="lg:col-span-7 space-y-6">
                        {/* Section 1: Campaign Details & Dynamic Content */}
                        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/80 dark:border-gray-800 p-6 shadow-sm space-y-5">
                            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800">
                                <h2 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center text-xs">1</span>
                                    <span>New Stock Announcement Details</span>
                                </h2>
                                <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md border ${
                                    mediaMode === 'CAROUSEL'
                                        ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800'
                                        : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                                }`}>
                                    Template: {activeTemplateName}
                                </span>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                        Campaign Name (Internal Reference)
                                    </label>
                                    <Input
                                        value={campaignName}
                                        onChange={(e) => setCampaignName(e.target.value)}
                                        placeholder="e.g. Linen Shirts Festive Drop"
                                        className="h-10 text-xs"
                                    />
                                </div>

                                <div className={`grid grid-cols-1 ${mediaMode !== 'CAROUSEL' ? 'sm:grid-cols-2' : ''} gap-4`}>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                            Collection / Item Name
                                        </label>
                                        <Input
                                            value={variables.collectionName}
                                            onChange={(e) => setVariables({ ...variables, collectionName: e.target.value })}
                                            placeholder="e.g. Premium Linen Shirts"
                                            className="h-10 text-xs"
                                        />
                                    </div>
                                    {mediaMode !== 'CAROUSEL' && (
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                                Available Sizes
                                            </label>
                                            <Input
                                                value={variables.sizes}
                                                onChange={(e) => setVariables({ ...variables, sizes: e.target.value })}
                                                placeholder="e.g. M, L, XL, XXL"
                                                className="h-10 text-xs"
                                            />
                                        </div>
                                    )}
                                </div>

                                {mediaMode !== 'CAROUSEL' && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                                Collection Highlights / Fabric Details
                                            </label>
                                            <Input
                                                value={variables.details}
                                                onChange={(e) => setVariables({ ...variables, details: e.target.value })}
                                                placeholder="e.g. Pure breathable linen in 6 vibrant colors"
                                                className="h-10 text-xs"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                                Starting Price (₹)
                                            </label>
                                            <Input
                                                value={variables.startingPrice}
                                                onChange={(e) => setVariables({ ...variables, startingPrice: e.target.value })}
                                                placeholder="e.g. 1,299"
                                                className="h-10 text-xs font-mono"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Section 2: Single Photo, Auto-Stitched Color Grid, or 4-Card Carousel */}
                            <CampaignMediaPicker
                                mode={mediaMode}
                                onModeChange={setMediaMode}
                                singlePreviewUrl={imagePreviewUrl}
                                singleFile={selectedImageFile}
                                onSelectSingleFile={(file, dataUrl) => {
                                    setSelectedImageFile(file);
                                    setImagePreviewUrl(dataUrl);
                                    setUploadedMediaId(null);
                                }}
                                onClearSingleFile={() => {
                                    setSelectedImageFile(null);
                                    setImagePreviewUrl(null);
                                    setUploadedMediaId(null);
                                }}
                                collagePhotos={collagePhotos}
                                onCollagePhotosChange={setCollagePhotos}
                                stitchedPreviewUrl={stitchedCollage?.dataUrl || null}
                                carouselCards={carouselCards}
                                onCarouselCardsChange={setCarouselCards}
                            />
                        </div>

                        {/* Section 3: Target Audience Selector */}
                        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/80 dark:border-gray-800 p-6 shadow-sm space-y-4">
                            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800">
                                <h2 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center text-xs">2</span>
                                    <span>Select Customer Audience</span>
                                </h2>
                                <span className="text-xs font-bold text-emerald-600">
                                    {selectedRecipientsCount} of {customers.length} selected
                                </span>
                            </div>

                            {/* Segment Filter Pills */}
                            <div className="flex flex-wrap items-center gap-2">
                                {[
                                    { key: 'ALL', label: 'All Customers' },
                                    { key: 'RECENT', label: 'Active (< 60 Days)' },
                                    { key: 'VIP', label: 'VIP Spenders (> ₹3,000)' },
                                    { key: 'INACTIVE', label: 'Re-engage Inactive (> 60 Days)' },
                                ].map((seg) => (
                                    <button
                                        key={seg.key}
                                        onClick={() => setActiveSegment(seg.key as any)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                            activeSegment === seg.key
                                                ? 'bg-emerald-600 text-white shadow-sm'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                                        }`}
                                    >
                                        {seg.label}
                                    </button>
                                ))}
                            </div>

                            {/* Search and Bulk Controls */}
                            <div className="flex items-center justify-between gap-3 pt-2">
                                <div className="relative flex-1">
                                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                    <Input
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search customer by name or phone..."
                                        className="h-9 pl-9 text-xs"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={selectAllFiltered}
                                        className="text-xs h-9"
                                    >
                                        Select All
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={deselectAllFiltered}
                                        className="text-xs h-9 text-gray-500"
                                    >
                                        Clear
                                    </Button>
                                </div>
                            </div>

                            {/* Customer List Table */}
                            <div className="border border-gray-100 dark:border-gray-800 rounded-2xl max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                                {loadingCustomers ? (
                                    <div className="p-8 text-center text-xs text-gray-400">
                                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                                        Loading customer database...
                                    </div>
                                ) : filteredAudience.length === 0 ? (
                                    <div className="p-6 text-center text-xs text-gray-400">
                                        No customers match the current filter.
                                    </div>
                                ) : (
                                    filteredAudience.map((c) => {
                                        const isSelected = selectedCustomerIds.has(c.id);
                                        return (
                                            <div
                                                key={c.id}
                                                onClick={() => toggleCustomerSelection(c.id)}
                                                className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
                                                    isSelected
                                                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                                                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span className={isSelected ? 'text-emerald-600' : 'text-gray-300'}>
                                                        {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                                    </span>
                                                    <div>
                                                        <div className="text-xs font-bold text-gray-900 dark:text-white">
                                                            {c.name}
                                                        </div>
                                                        <div className="text-[11px] font-mono text-gray-500">
                                                            {c.phone}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="text-right">
                                                    <div className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400">
                                                        ₹{(c.totalSpend || 0).toLocaleString('en-IN')}
                                                    </div>
                                                    <div className="text-[10px] text-gray-400">
                                                        Total Purchases
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Real-Time WhatsApp Phone Mockup (5 Cols) */}
                    <div className="lg:col-span-5 space-y-6 sticky top-6">
                        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/80 dark:border-gray-800 p-6 shadow-sm space-y-4">
                            <h2 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                                <span className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center text-xs">3</span>
                                <span>Live WhatsApp Customer Preview</span>
                            </h2>

                            {/* Phone Frame Simulator */}
                            <div className="bg-slate-900 rounded-[32px] p-3 shadow-2xl border-4 border-slate-800 max-w-sm mx-auto">
                                {/* Top Speaker / Camera Notch */}
                                <div className="w-24 h-4 bg-slate-800 rounded-full mx-auto mb-3" />

                                {/* Phone Screen */}
                                <div className="bg-[#EFEAE2] dark:bg-[#0b141a] rounded-[24px] overflow-hidden flex flex-col min-h-[460px] text-gray-900 dark:text-white border border-slate-700">
                                    {/* WhatsApp Chat Header */}
                                    <div className="bg-[#075E54] text-white px-3.5 py-2.5 flex items-center justify-between shadow-md">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-full bg-purple-700 text-white flex items-center justify-center font-bold text-xs border border-white/30">
                                                ZAIN
                                            </div>
                                            <div>
                                                <div className="font-bold text-xs flex items-center gap-1">
                                                    <span>Zain Gents Palace</span>
                                                    <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                                                </div>
                                                <div className="text-[10px] text-emerald-100">Official Business Account</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Chat Body */}
                                    <div className="p-3 flex-1 flex flex-col justify-end space-y-2.5 overflow-hidden">
                                        {mediaMode === 'CAROUSEL' ? (
                                            <>
                                                {/* Carousel Intro Bubble */}
                                                <div className="bg-white dark:bg-[#1f2c34] rounded-2xl rounded-tl-none p-2.5 shadow-md border border-black/5 dark:border-white/5 text-[11px] leading-relaxed text-gray-800 dark:text-gray-200 max-w-[92%]">
                                                    <p>
                                                        Hello <strong>Rahul</strong>! Fresh arrivals of{' '}
                                                        <strong className="text-emerald-700 dark:text-emerald-400">
                                                            {variables.collectionName || '[Collection]'}
                                                        </strong>{' '}
                                                        have just landed at <strong>Zain Gents Palace</strong>, Chirammal Tower, Nileshwar. Swipe through the cards below to explore all 4 color options and reserve yours!
                                                    </p>
                                                </div>

                                                {/* Horizontal Scrollable 4-Card Carousel Strip */}
                                                <div className="flex gap-2 overflow-x-auto pb-1.5 snap-x">
                                                    {carouselCards.map((card, idx) => (
                                                        <div
                                                            key={card.id}
                                                            className="w-44 flex-shrink-0 snap-start bg-white dark:bg-[#1f2c34] rounded-2xl p-2 shadow-md border border-black/5 dark:border-white/5 space-y-1.5"
                                                        >
                                                            {card.dataUrl ? (
                                                                <img
                                                                    src={card.dataUrl}
                                                                    alt={card.colorLabel}
                                                                    className="w-full h-24 object-cover rounded-xl"
                                                                />
                                                            ) : (
                                                                <div className="w-full h-24 rounded-xl bg-gray-100 dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-[10px] text-gray-400">
                                                                    Photo #{idx + 1}
                                                                </div>
                                                            )}
                                                            <div className="text-[10px] leading-snug text-gray-800 dark:text-gray-200">
                                                                Shade: <strong>{card.colorLabel || `Color ${idx + 1}`}</strong> — Now available in sizes {card.sizes || 'M, L, XL'} starting at Rs.{card.price || '1,299'}. Grab yours at Zain Gents Palace today!
                                                            </div>
                                                            <div className="pt-1 border-t border-gray-100 dark:border-gray-700/60 space-y-1">
                                                                <div className="w-full py-1 bg-gray-50 dark:bg-gray-800 rounded text-emerald-600 dark:text-emerald-400 font-bold text-[10px] text-center">
                                                                    💬 Book This Color
                                                                </div>
                                                                <div className="w-full py-1 bg-gray-50 dark:bg-gray-800 rounded text-emerald-600 dark:text-emerald-400 font-bold text-[10px] text-center">
                                                                    📍 Visit Store
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            /* Single Photo or Auto-Stitched Multi-Color Grid Bubble */
                                            <div className="bg-white dark:bg-[#1f2c34] rounded-2xl rounded-tl-none p-2.5 shadow-md border border-black/5 dark:border-white/5 space-y-2 max-w-[92%]">
                                                {/* Photo Header */}
                                                {(() => {
                                                    const previewSrc =
                                                        mediaMode === 'COLLAGE'
                                                            ? stitchedCollage?.dataUrl || collagePhotos[0]?.dataUrl
                                                            : imagePreviewUrl;
                                                    return previewSrc ? (
                                                        <img
                                                            src={previewSrc}
                                                            alt="Product"
                                                            className="w-full h-36 object-cover rounded-xl"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-32 rounded-xl bg-gray-100 dark:bg-gray-800/80 border-2 border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center text-gray-400 text-xs">
                                                            <ImageIcon className="w-6 h-6 mb-1 text-gray-400" />
                                                            <span>
                                                                {mediaMode === 'COLLAGE'
                                                                    ? 'Add 2–6 photos to stitch grid'
                                                                    : 'Product Photo will appear here'}
                                                            </span>
                                                        </div>
                                                    );
                                                })()}

                                                {/* Message Content */}
                                                <div className="text-[11px] leading-relaxed text-gray-800 dark:text-gray-200 space-y-1.5 pt-1">
                                                    <p>
                                                        Hello <strong>Rahul</strong>! 🌟
                                                    </p>
                                                    <p>
                                                        Fresh arrivals at <strong>ZAIN GENTS PALACE</strong>! Our new collection of{' '}
                                                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                                            {variables.collectionName || '[Collection Name]'}
                                                        </span>{' '}
                                                        is now available in store.
                                                    </p>
                                                    <div className="bg-gray-50 dark:bg-gray-800/40 p-2 rounded-lg space-y-0.5 text-[10px]">
                                                        <div>👕 <strong>Details:</strong> {variables.details || '[Details]'}</div>
                                                        <div>📏 <strong>Sizes:</strong> {variables.sizes || '[Sizes]'}</div>
                                                        <div>🏷️ <strong>Starting at:</strong> ₹{variables.startingPrice || '[Price]'}</div>
                                                    </div>
                                                    <p className="text-[10px] text-gray-600 dark:text-gray-400">
                                                        Visit us at Chirammal Tower, Raja Road, Nileshwar to grab yours before stock runs out!
                                                    </p>
                                                    <div className="text-[9px] text-gray-400 text-right">
                                                        Reply STOP to opt out
                                                    </div>
                                                </div>

                                                {/* Action Buttons Mockup */}
                                                <div className="pt-2 border-t border-gray-100 dark:border-gray-700/60 space-y-1.5">
                                                    <button className="w-full py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 rounded-lg text-emerald-600 dark:text-emerald-400 font-bold text-[11px] flex items-center justify-center gap-1.5">
                                                        <MapPin className="w-3 h-3" />
                                                        <span>Visit Store (Google Maps)</span>
                                                    </button>
                                                    <button className="w-full py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 rounded-lg text-emerald-600 dark:text-emerald-400 font-bold text-[11px] flex items-center justify-center gap-1.5">
                                                        <Phone className="w-3 h-3" />
                                                        <span>Call Store</span>
                                                    </button>
                                                    <button className="w-full py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 rounded-lg text-gray-700 dark:text-gray-300 font-medium text-[11px] flex items-center justify-center gap-1.5">
                                                        <MessageCircle className="w-3 h-3" />
                                                        <span>Check My Size</span>
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Broadcast CTA Card */}
                            <div className="bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl p-4 space-y-3">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-600 dark:text-gray-400">Recipients to Receive:</span>
                                    <span className="font-bold text-gray-900 dark:text-white font-mono">
                                        {selectedRecipientsCount} Customers
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-600 dark:text-gray-400">Estimated Meta Charge:</span>
                                    <span className="font-bold text-emerald-700 dark:text-emerald-400 font-mono text-sm">
                                        ~₹{estimatedMetaCost} INR
                                    </span>
                                </div>

                                <Button
                                    onClick={() => setShowConfirmModal(true)}
                                    disabled={selectedRecipientsCount === 0 || isSending || isUploadingMedia}
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 rounded-xl shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2"
                                >
                                    {isUploadingMedia ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            <span>Uploading Lookbook Photo...</span>
                                        </>
                                    ) : isSending ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            <span>Broadcasting ({sendProgress.current}/{sendProgress.total})...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-4 h-4" />
                                            <span>Send Broadcast Campaign</span>
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: LIVE CUSTOMER INBOX & AUTO-REPLY */}
            {activeTab === 'INBOX' && (
                <WhatsAppInboxTab />
            )}

            {/* TAB 3: BROADCAST HISTORY & LOGS */}
            {activeTab === 'HISTORY' && (
                <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/80 dark:border-gray-800 p-6 shadow-sm space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800">
                        <div>
                            <h2 className="font-bold text-sm text-gray-900 dark:text-white">
                                Recent WhatsApp Message & Campaign Logs
                            </h2>
                            <p className="text-xs text-gray-500">
                                Live delivery status directly from Meta Cloud API records.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={loadHistory}
                            disabled={loadingLogs}
                            className="text-xs flex items-center gap-1.5"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                            <span>Refresh Logs</span>
                        </Button>
                    </div>

                    <div className="rounded-2xl border border-amber-200/80 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                        <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                        <div className="space-y-1">
                            <div className="font-bold">Why can a message show &ldquo;Accepted&rdquo; or &ldquo;Sent&rdquo; without arriving on a phone?</div>
                            <p className="text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-300/90">
                                Meta&apos;s API first returns <strong>Accepted</strong> before attempting phone delivery, then reports the final result via Webhook: <strong>DELIVERED / READ</strong> or <strong>FAILED</strong> (common causes for Marketing templates in India: <strong>#131049</strong> per-user marketing frequency limit, <strong>#131042</strong> prepaid billing/payment balance, or an unapproved Display Name limit). Click <strong>Refresh Logs</strong> a few seconds after sending to sync webhook errors.
                            </p>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 font-semibold border-y border-gray-100 dark:border-gray-800">
                                <tr>
                                    <th className="py-3 px-4">Date & Time</th>
                                    <th className="py-3 px-4">Recipient</th>
                                    <th className="py-3 px-4">Channel & Provider</th>
                                    <th className="py-3 px-4">Message Summary</th>
                                    <th className="py-3 px-4">Delivery Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {loadingLogs ? (
                                    <tr>
                                        <td colSpan={5} className="py-8 text-center text-gray-400">
                                            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                                            Loading message logs...
                                        </td>
                                    </tr>
                                ) : logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="py-8 text-center text-gray-400">
                                            No message dispatches found.
                                        </td>
                                    </tr>
                                ) : (
                                    logs.map((log) => (
                                        <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                                            <td className="py-3 px-4 text-gray-500 font-mono text-[11px]">
                                                {new Date(log.createdAt).toLocaleString('en-IN', {
                                                    dateStyle: 'medium',
                                                    timeStyle: 'short',
                                                })}
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="font-bold text-gray-900 dark:text-white">
                                                    {log.customerName || 'Customer'}
                                                </div>
                                                <div className="text-[11px] font-mono text-gray-400">
                                                    {log.customerPhone}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                                    {log.channel}
                                                </span>
                                                <div className="text-[10px] text-gray-400">{log.provider}</div>
                                            </td>
                                            <td className="py-3 px-4 max-w-xs truncate text-gray-600 dark:text-gray-300">
                                                {log.messageText}
                                            </td>
                                            <td className="py-3 px-4 space-y-1">
                                                {(() => {
                                                    const badgeClass =
                                                        log.status === 'DELIVERED' || log.status === 'READ'
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                                            : log.status === 'FAILED'
                                                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                                                            : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
                                                    const statusLabel =
                                                        log.status === 'SENT' && log.provider === 'WhatsApp Cloud API'
                                                            ? 'ACCEPTED (Queued)'
                                                            : log.status;
                                                    return (
                                                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}`}>
                                                            {statusLabel}
                                                        </span>
                                                    );
                                                })()}
                                                {log.error && (
                                                    <div className="text-[11px] text-rose-600 dark:text-rose-400 max-w-xs leading-snug">
                                                        {log.error}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* In-App Confirm Dialog (Strictly no window.confirm per rules) */}
            <ConfirmDialog
                isOpen={showConfirmModal}
                title="Confirm WhatsApp Broadcast Dispatch"
                message={`Are you sure you want to broadcast "${campaignName}" to ${selectedRecipientsCount} customer(s)? Estimated Meta delivery cost is ~₹${estimatedMetaCost} INR deducted from your prepaid balance.`}
                confirmText="Yes, Send Broadcast Now"
                cancelText="Review Again"
                variant="primary"
                onConfirm={handleStartBroadcast}
                onClose={() => setShowConfirmModal(false)}
            />
        </div>
    );
};
