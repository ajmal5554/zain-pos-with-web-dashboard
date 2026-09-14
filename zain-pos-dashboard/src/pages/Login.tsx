import React, { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LogIn, User, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const navigate = useNavigate();
    const { login } = useAuth();

    // Lock document scroll so mobile phones cannot scroll or bounce the login page
    useEffect(() => {
        const originalHtmlOverflow = document.documentElement.style.overflow;
        const originalBodyOverflow = document.body.style.overflow;
        const originalOverscroll = document.body.style.overscrollBehavior;

        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.body.style.overscrollBehavior = 'none';

        return () => {
            document.documentElement.style.overflow = originalHtmlOverflow;
            document.body.style.overflow = originalBodyOverflow;
            document.body.style.overscrollBehavior = originalOverscroll;
        };
    }, []);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const success = await login(username, password);
            if (success) {
                navigate('/');
            } else {
                setError('Invalid username or password');
            }
        } catch (err: any) {
            if (err.response?.status === 401 || err.response?.data?.error) {
                setError(err.response?.data?.error || 'Invalid credentials');
            } else {
                setError('Login failed. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 w-full h-[100dvh] overflow-hidden overscroll-none touch-none flex items-center justify-center p-4 bg-gradient-to-br from-gray-50 via-blue-50/50 to-indigo-100/60 select-none">
            {/* Subtle Radial Dots Overlay like POS app */}
            <div 
                className="absolute inset-0 opacity-[0.035] pointer-events-none" 
                style={{
                    backgroundImage: `radial-gradient(circle at 2px 2px, rgba(99, 102, 241, 0.25) 1px, transparent 0)`,
                    backgroundSize: '36px 36px'
                }}
            />

            {/* Soft Ambient Blurred Gradient Orbs matching POS app */}
            <div className="absolute top-0 right-0 w-80 sm:w-96 h-80 sm:h-96 bg-gradient-to-br from-blue-400/25 to-indigo-500/25 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-80 sm:w-96 h-80 sm:h-96 bg-gradient-to-tr from-indigo-400/25 to-blue-500/25 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 sm:w-[32rem] h-72 sm:h-[32rem] bg-gradient-to-r from-blue-200/20 via-indigo-200/20 to-purple-200/20 rounded-full blur-3xl pointer-events-none" />

            {/* Login Card */}
            <div className="w-full max-w-sm sm:max-w-md relative z-10">
                <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-200/60 p-6 sm:p-8">
                    {/* Logo & Branding */}
                    <div className="text-center mb-6 sm:mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl mb-4 shadow-lg shadow-blue-500/30">
                            <LogIn className="w-8 h-8 text-white" strokeWidth={2} />
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                            ZAIN GENTS PALACE
                        </h1>
                        <p className="text-gray-500 text-xs sm:text-sm font-medium mt-1">
                            Point of Sale System
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm">
                                {error}
                            </div>
                        )}

                        <div className="space-y-1.5 sm:space-y-2">
                            <label className="block text-xs sm:text-sm font-semibold text-gray-700">
                                Select User
                            </label>
                            <div className="relative">
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400 pointer-events-none" strokeWidth={2} />
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Enter your username"
                                    autoComplete="username"
                                    className="w-full pl-10 sm:pl-11 pr-4 py-2.5 sm:py-3 bg-gray-50/80 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 placeholder:text-gray-400 font-medium text-sm"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5 sm:space-y-2">
                            <label className="block text-xs sm:text-sm font-semibold text-gray-700">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400 pointer-events-none" strokeWidth={2} />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Enter your password"
                                    autoComplete="current-password"
                                    className="w-full pl-10 sm:pl-11 pr-11 py-2.5 sm:py-3 bg-gray-50/80 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 placeholder:text-gray-400 font-medium text-sm"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors focus:outline-none p-1"
                                    tabIndex={-1}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={2} /> : <Eye className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={2} />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full mt-4 sm:mt-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/25 hover:shadow-blue-500/35 text-sm sm:text-base flex items-center justify-center active:scale-[0.99]"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin text-white" />
                                    <span>Signing in...</span>
                                </>
                            ) : (
                                <span>Sign In</span>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
