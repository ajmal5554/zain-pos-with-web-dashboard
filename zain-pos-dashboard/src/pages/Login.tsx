import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { 
  Lock, 
  User as UserIcon, 
  ArrowRight
} from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle,
  CardFooter
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
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
        <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
            <Card className="w-full max-w-sm">
                <CardHeader className="space-y-2 text-center flex flex-col items-center">
                    <div className="h-12 w-12 rounded-xl bg-slate-950 flex items-center justify-center mb-2 p-2 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                        <img src="/icon.ico" className="h-full w-full object-contain rounded" alt="Logo" />
                    </div>
                    <CardTitle className="text-2xl font-bold">Sign In</CardTitle>
                    <CardDescription>
                        Enter your credentials to access the dashboard.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Username</label>
                            <div className="relative">
                                <UserIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Enter username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-9 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-9 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    required
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium">
                                {error}
                            </div>
                        )}

                        <Button 
                            type="submit" 
                            className="w-full"
                            disabled={isLoading}
                        >
                            {isLoading ? 'Signing In...' : 'Sign In'}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter>
                    <Button 
                        variant="outline" 
                        onClick={() => {
                            enterDemoMode();
                            navigate('/');
                        }}
                        className="w-full"
                    >
                        Continue as Guest (Demo)
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
