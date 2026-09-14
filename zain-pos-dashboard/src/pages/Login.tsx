import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { 
  Lock, 
  User as UserIcon, 
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();
    const { login, enterDemoMode } = useAuth();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const success = await login(username, password);
            if (success) {
                navigate('/');
            } else {
                setError('Invalid credentials');
            }
        } catch (err: any) {
            if (err.response?.status === 401 || err.response?.data?.error) {
                setError(err.response?.data?.error || 'Invalid credentials');
            } else {
                setError('Login failed. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen relative flex items-center justify-center p-4 sm:p-6 overflow-hidden bg-slate-950 text-slate-50 selection:bg-amber-500/30 selection:text-amber-200">
            {/* Ambient Background Glows */}
            <div className="absolute -top-32 -left-32 w-80 sm:w-96 h-80 sm:h-96 bg-amber-500/15 rounded-full blur-[100px] sm:blur-[130px] pointer-events-none" />
            <div className="absolute -bottom-32 -right-32 w-80 sm:w-96 h-80 sm:h-96 bg-blue-600/15 rounded-full blur-[100px] sm:blur-[130px] pointer-events-none" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-[140px] pointer-events-none" />

            {/* Subtle Grid Accent */}
            <div 
                className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b15_1px,transparent_1px),linear-gradient(to_bottom,#1e293b15_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" 
            />

            {/* Glassmorphic Card Container */}
            <div className="relative w-full max-w-md">
                <Card className="relative w-full backdrop-blur-2xl bg-slate-900/85 border border-slate-800/80 shadow-2xl shadow-black/80 rounded-2xl overflow-hidden">
                    {/* Top ambient highlight line */}
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

                    <CardHeader className="space-y-3 text-center flex flex-col items-center pt-8 pb-4">
                        {/* Glowing Logo Badge */}
                        <div className="relative mb-1">
                            <div className="absolute -inset-1.5 rounded-2xl bg-gradient-to-r from-amber-500/30 via-emerald-500/20 to-blue-500/20 blur-md" />
                            <div className="relative h-16 w-16 rounded-2xl bg-slate-950 border border-slate-800 p-2.5 shadow-xl flex items-center justify-center">
                                <img src="/icon.ico" className="h-full w-full object-contain" alt="Zain POS Logo" />
                            </div>
                        </div>

                        {/* Tag & Heading */}
                        <div className="space-y-1.5">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs font-medium text-slate-300">
                                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                                <span>Cloud Retail Portal</span>
                            </div>
                            <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                                Zain POS
                            </CardTitle>
                            <CardDescription className="text-slate-400 text-xs sm:text-sm max-w-xs mx-auto">
                                Enter your credentials to access the POS & management dashboard.
                            </CardDescription>
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-5 px-6 pb-8">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Username field */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                                    Username
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                                        <UserIcon className="h-4 w-4" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Enter your username"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        autoComplete="username"
                                        className="flex h-11 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2 pl-10 text-sm text-slate-100 placeholder:text-slate-500 transition-all focus:border-amber-500/50 focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                        required
                                    />
                                </div>
                            </div>

                            {/* Password field */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                                    Password
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                                        <Lock className="h-4 w-4" />
                                    </div>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        autoComplete="current-password"
                                        className="flex h-11 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2 pl-10 pr-10 text-sm text-slate-100 placeholder:text-slate-500 transition-all focus:border-amber-500/50 focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors focus:outline-none"
                                        tabIndex={-1}
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                    >
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* Error Alert */}
                            {error && (
                                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs sm:text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Submit Button */}
                            <Button 
                                type="submit" 
                                className="w-full h-11 rounded-xl font-semibold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 transition-all duration-150 active:scale-[0.99] border-0"
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin text-slate-950" />
                                        <span>Signing In...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Sign In</span>
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                    </>
                                )}
                            </Button>
                        </form>

                        {/* Divider */}
                        <div className="relative my-4">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-slate-800" />
                            </div>
                            <div className="relative flex justify-center text-[11px] uppercase">
                                <span className="bg-slate-900 px-3 text-slate-400 font-medium tracking-wider">
                                    Or explore preview
                                </span>
                            </div>
                        </div>

                        {/* Guest / Demo Button */}
                        <Button 
                            type="button"
                            variant="outline" 
                            onClick={() => {
                                enterDemoMode();
                                navigate('/');
                            }}
                            className="w-full h-11 rounded-xl border-slate-800 bg-slate-950/60 hover:bg-slate-800 hover:text-white text-slate-300 font-medium transition-all duration-150 active:scale-[0.99]"
                        >
                            <Sparkles className="mr-2 h-4 w-4 text-amber-400" />
                            Continue as Guest (Demo)
                        </Button>

                        {/* Footer Security Badges */}
                        <div className="pt-2 flex items-center justify-center gap-2 text-[11px] text-slate-400">
                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                            <span>Real-Time Cloud Sync • Secure Access</span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
