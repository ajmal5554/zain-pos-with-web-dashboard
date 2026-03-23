import { io } from 'socket.io-client';
import { API_URL } from './config';

export const socket = io(API_URL, {
    autoConnect: true,
    reconnection: true,
    auth: (cb) => {
        const token = localStorage.getItem('token');
        cb({ token });
    },
});

socket.on('connect', () => {
    console.log('socket connected:', socket.id);
});

socket.on('disconnect', () => {
    console.log('socket disconnected');
});

socket.on('sale:batch', (data) => {
    console.log('Real-time Sale Event Received:', data);
});
