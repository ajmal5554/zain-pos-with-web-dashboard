import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import api from '../lib/api';
import { DEMO_MODE_KEY, DEMO_TOKEN } from '@/lib/demo';

interface User {
    id: string;
    username: string;
    name: string;
    role: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (username: string, password: string) => Promise<void>;
    enterDemoMode: () => void;
    logout: () => void;
    isLoading: boolean;
    isDemoMode: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_USER: User = {
    id: 'demo-user',
    username: 'demo',
    name: 'Demo Admin',
    role: 'ADMIN'
};
export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isDemoMode, setIsDemoMode] = useState(false);

    useEffect(() => {
        const demoMode = localStorage.getItem(DEMO_MODE_KEY) === 'true';
        const savedToken = localStorage.getItem('token');
        const savedUser = localStorage.getItem('user');

        if (demoMode) {
            setUser(DEMO_USER);
            setToken(DEMO_TOKEN);
            setIsDemoMode(true);
            setIsLoading(false);
            return;
        }

        if (savedToken && savedUser) {
            try {
                setUser(JSON.parse(savedUser));
                setToken(savedToken);
            } catch (e) {
                console.error('Failed to parse saved user', e);
                localStorage.removeItem('user');
                localStorage.removeItem('token');
            }
        }
        setIsLoading(false);
    }, []);

    const login = async (username: string, password: string) => {
        const response = await api.post('/auth/login', { username, password });
        const { token, user } = response.data;

        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        setUser(user);
        setToken(token);
        setIsDemoMode(false);
        localStorage.removeItem(DEMO_MODE_KEY);
    };

    const enterDemoMode = () => {
        localStorage.setItem(DEMO_MODE_KEY, 'true');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(DEMO_USER);
        setToken(DEMO_TOKEN);
        setIsDemoMode(true);
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem(DEMO_MODE_KEY);
        setUser(null);
        setToken(null);
        setIsDemoMode(false);
    };

    return (
        <AuthContext.Provider value={{ user, token, login, enterDemoMode, logout, isLoading, isDemoMode }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
