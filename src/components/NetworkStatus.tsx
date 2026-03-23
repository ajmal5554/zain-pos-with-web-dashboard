import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle } from 'lucide-react';

interface NetworkStatusProps {
    showText?: boolean;
    className?: string;
}

interface NetworkStatus {
    online: boolean;
    lastChecked: Date;
    checkMethod: 'navigator' | 'ping' | 'initial';
}

interface SyncStatus {
    status: 'idle' | 'syncing' | 'success' | 'error';
    lastSync: Date | null;
}

export const NetworkStatus: React.FC<NetworkStatusProps> = ({
    showText = true,
    className = ''
}) => {
    const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
        online: true,
        lastChecked: new Date(),
        checkMethod: 'initial'
    });
    const [syncStatus, setSyncStatus] = useState<SyncStatus>({
        status: 'idle',
        lastSync: null
    });

    useEffect(() => {
        let unsubscribe: (() => void) | null = null;

        const initializeNetworkStatus = async () => {
            try {
                // Get initial network status
                const initialStatus = await window.electronAPI.network.getStatus();
                setNetworkStatus(initialStatus);

                // Subscribe to network status changes
                unsubscribe = window.electronAPI.network.onChange((status: NetworkStatus) => {
                    setNetworkStatus(status);

                    // Reset sync status when going offline
                    if (!status.online && syncStatus.status === 'syncing') {
                        setSyncStatus(prev => ({ ...prev, status: 'error' }));
                    }
                });
            } catch (error) {
                console.warn('Failed to initialize network status:', error);
            }
        };

        initializeNetworkStatus();

        // Cleanup subscription on unmount
        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    // Handle manual network check
    const handleForceCheck = async () => {
        if (syncStatus.status === 'syncing') return; // Prevent multiple checks

        try {
            setSyncStatus(prev => ({ ...prev, status: 'syncing' }));
            const status = await window.electronAPI.network.forceCheck();
            setNetworkStatus(status);

            // If online, also trigger a sync
            if (status.online) {
                const syncResult = await window.electronAPI.db.syncNow();
                setSyncStatus({
                    status: syncResult.success ? 'success' : 'error',
                    lastSync: new Date()
                });
            } else {
                setSyncStatus(prev => ({ ...prev, status: 'error' }));
            }
        } catch (error) {
            setSyncStatus(prev => ({ ...prev, status: 'error' }));
            console.error('Network check failed:', error);
        }

        // Reset status after 3 seconds
        setTimeout(() => {
            setSyncStatus(prev => ({ ...prev, status: 'idle' }));
        }, 3000);
    };

    const getStatusConfig = () => {
        // Priority: Sync status > Network status
        if (syncStatus.status === 'syncing') {
            return {
                icon: RefreshCw,
                text: 'Syncing',
                className: 'bg-blue-100 text-blue-700 border-blue-300',
                iconClassName: 'animate-spin text-blue-600'
            };
        }

        if (syncStatus.status === 'success') {
            return {
                icon: Wifi,
                text: 'Synced',
                className: 'bg-green-100 text-green-700 border-green-300',
                iconClassName: 'text-green-600'
            };
        }

        if (syncStatus.status === 'error') {
            return {
                icon: AlertCircle,
                text: 'Sync Failed',
                className: 'bg-red-100 text-red-700 border-red-300',
                iconClassName: 'text-red-600'
            };
        }

        // Default to network status
        if (!networkStatus.online) {
            return {
                icon: WifiOff,
                text: 'Offline',
                className: 'bg-red-100 text-red-700 border-red-300',
                iconClassName: 'text-red-600'
            };
        }

        return {
            icon: Wifi,
            text: 'Online',
            className: 'bg-green-100 text-green-700 border-green-300',
            iconClassName: 'text-green-600'
        };
    };

    const config = getStatusConfig();
    const Icon = config.icon;

    // Determine if component should be clickable
    const isClickable = syncStatus.status !== 'syncing';
    const handleClick = isClickable ? handleForceCheck : undefined;

    return (
        <div
            className={`
                flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border
                transition-all duration-200 cursor-pointer hover:scale-105
                ${config.className} ${className}
                ${!isClickable ? 'cursor-not-allowed opacity-75' : 'hover:shadow-sm'}
            `}
            onClick={handleClick}
            title={
                syncStatus.status === 'syncing'
                    ? 'Syncing with cloud...'
                    : networkStatus.online
                    ? 'Click to sync now'
                    : 'No internet connection - Click to retry'
            }
        >
            <Icon className={`w-3.5 h-3.5 ${config.iconClassName}`} />
            {showText && (
                <span className="hidden sm:inline whitespace-nowrap">
                    {config.text}
                </span>
            )}
        </div>
    );
};