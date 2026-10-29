import axios from 'axios';
import { API_URL } from './config';
import { DEMO_MODE_KEY } from './demo';

const api = axios.create({
    baseURL: `${API_URL}/api`,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Handle auth errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && localStorage.getItem(DEMO_MODE_KEY) !== 'true' && error.config?.url !== '/auth/login') {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            if (window.location.pathname !== '/login') window.location.replace('/login');
        }
        return Promise.reject(error);
    }
);

export default api;
