import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Store, Wifi } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../lib/config';

const quickStats = [
    { label: 'Remote admin', value: 'Live' },
    { label: 'Connected API', value: 'Render' },
    { label: 'Access scope', value: 'Users, settings, reports' }
];

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login, enterDemoMode } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(username, password);
            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.error || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    const handleDemoMode = () => {
        enterDemoMode();
        navigate('/');
    };

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f7fb] text-slate-950">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.08),_transparent_28%)]" />
            <div className="relative mx-auto grid min-h-screen max-w-[1440px] grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
                <section className="hidden px-10 py-12 lg:flex lg:flex-col lg:justify-between xl:px-16">
                    <div className="max-w-xl">
                        <div className="inline-flex items-center gap-4 rounded-full border border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
                            <img src="/icon.ico" alt="Zain POS" className="h-11 w-11 rounded-2xl bg-slate-950/5 object-contain p-1.5" />
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Zain POS</p>
                                <p className="text-lg font-semibold tracking-tight text-slate-900">Web Control Panel</p>
                            </div>
                        </div>

                        <div className="mt-12">
                            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-700">Remote Operations</p>
                            <h1 className="mt-5 max-w-2xl text-5xl font-semibold leading-[1.02] tracking-tight text-slate-950">
                                Control store settings, users, products, and reports from anywhere.
                            </h1>
                            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
                                The web dashboard mirrors the POS admin surface for management work, without exposing the checkout terminal.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-3">
                        {quickStats.map((item) => (
                            <div key={item.label} className="rounded-[1.75rem] border border-slate-200/80 bg-white/92 p-5 shadow-[0_24px_50px_-34px_rgba(15,23,42,0.38)]">
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{item.label}</p>
                                <p className="mt-4 text-lg font-semibold tracking-tight text-slate-950">{item.value}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="flex items-center justify-center px-4 py-8 sm:px-6 lg:px-10 xl:px-14">
                    <div className="w-full max-w-[560px] rounded-[2rem] border border-slate-200/80 bg-white/96 p-6 shadow-[0_35px_80px_-40px_rgba(15,23,42,0.42)] backdrop-blur sm:p-8">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-3 lg:hidden">
                                    <img src="/icon.ico" alt="Zain POS" className="h-12 w-12 rounded-2xl bg-slate-100 object-contain p-1.5" />
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Zain POS</p>
                                        <p className="text-base font-semibold text-slate-900">Web Dashboard</p>
                                    </div>
                                </div>
                                <p className="mt-5 text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">Secure Sign In</p>
                                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Admin access</h2>
                                <p className="mt-3 text-sm leading-6 text-slate-500">
                                    Sign in with your hosted API credentials to manage settings, permissions, products, GST reports, and forecasting.
                                </p>
                            </div>
                            <div className="hidden rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-700 sm:block">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                        </div>

                        <div className="mt-8 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                <Store className="h-4 w-4 text-sky-700" />
                                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Role</p>
                                <p className="mt-1 text-sm font-medium text-slate-900">Admin dashboard</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                <Wifi className="h-4 w-4 text-sky-700" />
                                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">API</p>
                                <p className="mt-1 truncate text-sm font-medium text-slate-900">{API_URL.replace(/^https?:\/\//, '')}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                <ArrowRight className="h-4 w-4 text-sky-700" />
                                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Default login</p>
                                <p className="mt-1 text-sm font-medium text-slate-900">admin / admin123</p>
                            </div>
                        </div>

                        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                            {error && (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                                    {error}
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-slate-700">
                                    Username
                                </label>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base text-slate-950 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                    placeholder="Enter username"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-slate-700">
                                    Password
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base text-slate-950 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                    placeholder="Enter password"
                                    required
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3.5 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loading ? 'Signing in...' : 'Sign In'}
                                {!loading && <ArrowRight className="h-4 w-4" />}
                            </button>

                            {import.meta.env.DEV && (
                                <button
                                    type="button"
                                    onClick={handleDemoMode}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-base font-medium text-slate-700 transition hover:bg-slate-50"
                                >
                                    Continue In Demo Mode
                                </button>
                            )}
                        </form>
                    </div>
                </section>
            </div>
        </div>
    );
}
