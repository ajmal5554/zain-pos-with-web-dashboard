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

        function onSaleEvent(data: { billNo?: string; grandTotal?: number; count?: number }) {
            latestFetchRef.current();

            if (data.billNo) {
                toast.success(`New sale recorded: Rs ${data.grandTotal ?? 0}`, {
                    id: 'new-sale',
                    duration: 3000,
                    icon: 'Sale'
                });
                return;
            }

            if (data.count) {
                toast.success(`Synced ${data.count} new sales`, {
                    id: 'sync-batch',
                    icon: 'Sync'
                });
            }
        }

        socket.on('sale:batch', onSaleEvent);

        return () => {
            socket.off('sale:batch', onSaleEvent);
        };
    }, [isConnected]);

    return { stats, loading, error, refetch: fetchStats };
}
