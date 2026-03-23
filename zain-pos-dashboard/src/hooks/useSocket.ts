import { useEffect, useState } from 'react';
import { socket } from '@/lib/socket';

export function useSocket() {
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [lastSale, setLastSale] = useState<any>(null);

    useEffect(() => {
        function onConnect() {
            setIsConnected(true);
            console.log('Socket connected');
        }

        function onDisconnect() {
            setIsConnected(false);
            console.log('Socket disconnected');
        }

        function onSalesBatch(payload: any) {
            console.log('Realtime Sale Batch Received:', payload);
            setLastSale(payload);
        }

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('sale:batch', onSalesBatch);

        // If already connected when this hook mounts
        if (socket.connected) {
            onConnect();
        }

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('sale:batch', onSalesBatch);
        };
    }, []);

    return { socket, isConnected, lastSale };
}
