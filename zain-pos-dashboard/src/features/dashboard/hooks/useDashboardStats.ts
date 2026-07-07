import { useState, useEffect, useCallback, useRef } from 'react';
import { dashboardService, type DashboardStats } from '../services/dashboard.service';
import { useSocket } from '@/hooks/useSocket';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { socket } from '@/lib/socket';
import { toast } from 'react-hot-toast';
import { demoDashboardStats, isDemoModeEnabled } from '@/lib/demo';

export function useDashboardStats() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { dateRange } = useDateFilter();
    const { isConnected } = useSocket();

    const latestFetchRef = useRef<() => void>(() => {});

    const fetchStats = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            if (isDemoModeEnabled()) {
                setStats(demoDashboardStats);
                return;
            }

            const data = await dashboardService.getStats(dateRange.startDate!, dateRange.endDate!);
            setStats(data);
        } catch (err: any) {
            console.error('Failed to fetch dashboard stats', err);
            const msg = err?.response?.data?.error || err?.message || 'Unknown error';
            setError(`Could not load dashboard: ${msg}`);
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => {
        latestFetchRef.current = fetchStats;
    }, [fetchStats]);

    useEffect(() => {
        if (dateRange.startDate && dateRange.endDate) {
            fetchStats();
        }
    }, [fetchStats, dateRange.startDate, dateRange.endDate]);

    useEffect(() => {
        if (isDemoModeEnabled() || !isConnected) return;

        function onSaleBatch(data: { count?: number }) {
            latestFetchRef.current();
            if (data.count) {
                toast.success(`Synced ${data.count} new sales`, {
                    id: 'sync-batch',
                    icon: '🔄'
                });
            }
        }

        function onSaleVoided(data: { billNo?: string }) {
            latestFetchRef.current();
            if (data.billNo) {
                toast.error(`Invoice Voided: Bill #${data.billNo}`, {
                    id: `void-${data.billNo}`,
                    duration: 4000,
                    icon: '🚫'
                });
            }
        }

        function onSaleUpdated(data: { billNo?: string }) {
            latestFetchRef.current();
            if (data.billNo) {
                toast.success(`Invoice Updated: Bill #${data.billNo}`, {
                    id: `update-${data.billNo}`,
                    duration: 4000,
                    icon: '📝'
                });
            }
        }

        socket.on('sale:batch', onSaleBatch);
        socket.on('sale:voided', onSaleVoided);
        socket.on('sale:updated', onSaleUpdated);

        return () => {
            socket.off('sale:batch', onSaleBatch);
            socket.off('sale:voided', onSaleVoided);
            socket.off('sale:updated', onSaleUpdated);
        };
    }, [isConnected]);

    return { stats, loading, error, refetch: fetchStats };
}
