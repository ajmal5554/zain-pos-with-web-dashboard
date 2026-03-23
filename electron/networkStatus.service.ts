/**
 * Network Status Detection Service
 * Monitors internet connectivity and provides real-time status updates
 */

import { BrowserWindow } from 'electron';

export interface NetworkStatus {
    online: boolean;
    lastChecked: Date;
    checkMethod: 'navigator' | 'ping' | 'initial';
}

export class NetworkStatusService {
    private isOnline: boolean = true; // Assume online initially
    private lastChecked: Date = new Date();
    private callbacks: ((status: NetworkStatus) => void)[] = [];
    private mainWindow: BrowserWindow | null = null;
    private checkInterval: NodeJS.Timeout | null = null;

    constructor(mainWindow?: BrowserWindow) {
        this.mainWindow = mainWindow || null;
        this.startPeriodicCheck();
    }

    /**
     * Start periodic connectivity checks every 30 seconds
     */
    private startPeriodicCheck(): void {
        this.checkInterval = setInterval(() => {
            this.checkConnectivity();
        }, 30000); // Check every 30 seconds
    }

    /**
     * Stop periodic connectivity checks
     */
    public stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    /**
     * Check internet connectivity using multiple methods
     */
    private async checkConnectivity(): Promise<void> {
        try {
            // Method 1: Try to fetch a reliable endpoint
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            const response = await fetch('https://www.google.com/favicon.ico', {
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-cache',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            this.updateStatus(true, 'ping');

        } catch (error) {
            // If fetch fails, assume offline
            this.updateStatus(false, 'ping');
        }
    }

    /**
     * Update network status and notify callbacks
     */
    private updateStatus(online: boolean, checkMethod: 'navigator' | 'ping' | 'initial'): void {
        const wasOnline = this.isOnline;
        this.isOnline = online;
        this.lastChecked = new Date();

        const status: NetworkStatus = {
            online,
            lastChecked: this.lastChecked,
            checkMethod
        };

        // Only notify if status actually changed or this is a ping check
        if (wasOnline !== online || checkMethod === 'ping') {
            this.callbacks.forEach(callback => {
                try {
                    callback(status);
                } catch (err) {
                    console.error('Network status callback error:', err);
                }
            });

            // Send to renderer process if main window exists
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('network:statusChanged', status);
            }
        }
    }

    /**
     * Get current network status
     */
    public getStatus(): NetworkStatus {
        return {
            online: this.isOnline,
            lastChecked: this.lastChecked,
            checkMethod: 'initial'
        };
    }

    /**
     * Register a callback for network status changes
     */
    public onChange(callback: (status: NetworkStatus) => void): void {
        this.callbacks.push(callback);
    }

    /**
     * Remove a callback
     */
    public removeCallback(callback: (status: NetworkStatus) => void): void {
        const index = this.callbacks.indexOf(callback);
        if (index > -1) {
            this.callbacks.splice(index, 1);
        }
    }

    /**
     * Manually trigger a connectivity check
     */
    public async forceCheck(): Promise<NetworkStatus> {
        await this.checkConnectivity();
        return this.getStatus();
    }

    /**
     * Set the main window reference for sending status updates
     */
    public setMainWindow(mainWindow: BrowserWindow): void {
        this.mainWindow = mainWindow;
    }
}

// Singleton instance
let networkStatusInstance: NetworkStatusService | null = null;

/**
 * Get the shared NetworkStatusService instance
 */
export function getNetworkStatusService(mainWindow?: BrowserWindow): NetworkStatusService {
    if (!networkStatusInstance) {
        networkStatusInstance = new NetworkStatusService(mainWindow);
    } else if (mainWindow && !networkStatusInstance['mainWindow']) {
        networkStatusInstance.setMainWindow(mainWindow);
    }
    return networkStatusInstance;
}

/**
 * Clean up the network status service
 */
export function cleanupNetworkStatusService(): void {
    if (networkStatusInstance) {
        networkStatusInstance.stop();
        networkStatusInstance = null;
    }
}