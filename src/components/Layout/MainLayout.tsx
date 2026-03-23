import React from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Users,
    FileText,
    Settings,
    LogOut,
    Moon,
    Sun,
    Menu,
    X,
    Activity,
    UserCog,
    Shield,
    BrainCircuit,
    Receipt,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { NetworkStatus } from '../NetworkStatus';

type PermissionKey = 'permViewReports' | 'permViewInsights' | 'permManageProducts' | 'permViewSales' | 'permViewGstReports' | 'permManageUsers' | 'permEditSettings';

export const MainLayout: React.FC = () => {
    const [darkMode, setDarkMode] = React.useState(false);
    const [sidebarOpen, setSidebarOpen] = React.useState(true);
    const location = useLocation();
    const navigate = useNavigate();
    const { user, login, logout } = useAuthStore();

    // Real-time Permission Sync - Enhanced version with proper error handling
    React.useEffect(() => {
        if (!user?.id) return;

        const syncPermissions = async () => {
            try {
                // Use secure query with proper permission validation
                const res = await window.electronAPI.db.secureQuery({
                    model: 'user',
                    method: 'findUnique',
                    args: {
                        where: { id: user.id },
                        select: {
                            id: true,
                            username: true,
                            name: true,
                            role: true,
                            isActive: true,
                            permPrintSticker: true,
                            permAddItem: true,
                            permDeleteProduct: true,
                            permVoidSale: true,
                            permViewReports: true,
                            permViewSales: true,
                            permViewGstReports: true,
                            permManageProducts: true,
                            permEditSettings: true,
                            permEditSales: true,
                            permManageInventory: true,
                            permManageUsers: true,
                            permViewCostPrice: true,
                            permChangePayment: true,
                            permDeleteAudit: true,
                            permBulkUpdate: true,
                            permBackDateSale: true,
                            permViewInsights: true,
                            maxDiscount: true,
                        }
                    },
                    userId: user.id
                });

                if (res.success && res.data) {
                    const freshUser = res.data;

                    // Check if user account has been deactivated
                    if (!freshUser.isActive) {
                        console.warn('User account deactivated - logging out');
                        handleLogout();
                        return;
                    }

                    // Only update if permissions actually changed (prevent unnecessary re-renders)
                    const currentPerms = JSON.stringify({
                        role: user.role,
                        isActive: user.isActive,
                        permPrintSticker: user.permPrintSticker,
                        permAddItem: user.permAddItem,
                        permDeleteProduct: user.permDeleteProduct,
                        permVoidSale: user.permVoidSale,
                        permViewReports: user.permViewReports,
                        permViewSales: user.permViewSales,
                        permViewGstReports: user.permViewGstReports,
                        permManageProducts: user.permManageProducts,
                        permEditSettings: user.permEditSettings,
                        permEditSales: user.permEditSales,
                        permManageInventory: user.permManageInventory,
                        permManageUsers: user.permManageUsers,
                        permViewCostPrice: user.permViewCostPrice,
                        permChangePayment: user.permChangePayment,
                        permDeleteAudit: user.permDeleteAudit,
                        permBulkUpdate: user.permBulkUpdate,
                        permBackDateSale: user.permBackDateSale,
                        permViewInsights: user.permViewInsights,
                        maxDiscount: user.maxDiscount
                    });

                    const newPerms = JSON.stringify({
                        role: freshUser.role,
                        isActive: freshUser.isActive,
                        permPrintSticker: freshUser.permPrintSticker,
                        permAddItem: freshUser.permAddItem,
                        permDeleteProduct: freshUser.permDeleteProduct,
                        permVoidSale: freshUser.permVoidSale,
                        permViewReports: freshUser.permViewReports,
                        permViewSales: freshUser.permViewSales,
                        permViewGstReports: freshUser.permViewGstReports,
                        permManageProducts: freshUser.permManageProducts,
                        permEditSettings: freshUser.permEditSettings,
                        permEditSales: freshUser.permEditSales,
                        permManageInventory: freshUser.permManageInventory,
                        permManageUsers: freshUser.permManageUsers,
                        permViewCostPrice: freshUser.permViewCostPrice,
                        permChangePayment: freshUser.permChangePayment,
                        permDeleteAudit: freshUser.permDeleteAudit,
                        permBulkUpdate: freshUser.permBulkUpdate,
                        permBackDateSale: freshUser.permBackDateSale,
                        permViewInsights: freshUser.permViewInsights,
                        maxDiscount: freshUser.maxDiscount
                    });

                    if (currentPerms !== newPerms) {
                        console.log('Permissions updated - refreshing user context');
                        login(freshUser);
                    }
                } else if (res.error) {
                    console.warn('Permission sync failed:', res.error);
                    // If user not found or permission denied, log them out
                    if (res.error.includes('not found') || res.error.includes('Permission denied')) {
                        handleLogout();
                    }
                }
            } catch (error) {
                console.error('Permission sync error:', error);
            }
        };

        // Initial sync after login
        syncPermissions();

        // Set up periodic sync every 30 seconds (less aggressive to prevent UI issues)
        const interval = setInterval(syncPermissions, 30000);

        return () => clearInterval(interval);
    }, [user?.id]);

    React.useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [darkMode]);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const menuItems: Array<{
        path: string;
        icon: React.ElementType;
        label: string;
        adminOnly?: boolean;
        requiredPerm?: PermissionKey;
    }> = [
        { path: '/', icon: LayoutDashboard, label: 'Dashboard', adminOnly: true, requiredPerm: 'permViewReports' },
        { path: '/pos', icon: ShoppingCart, label: 'Point of Sale' },
        { path: '/forecasting', icon: BrainCircuit, label: 'AI Forecaster', adminOnly: true, requiredPerm: 'permViewInsights' },
        { path: '/products', icon: Package, label: 'Products', adminOnly: true, requiredPerm: 'permManageProducts' },
        { path: '/customers', icon: Users, label: 'Customers' },
        { path: '/sales', icon: FileText, label: 'Sales History', adminOnly: true, requiredPerm: 'permViewSales' },
        { path: '/reports', icon: Receipt, label: 'GST Reports', adminOnly: true, requiredPerm: 'permViewGstReports' },
        { path: '/users', icon: UserCog, label: 'User Management', adminOnly: true, requiredPerm: 'permManageUsers' },
        { path: '/permissions', icon: Shield, label: 'User Permissions', adminOnly: true, requiredPerm: 'permManageUsers' },
        { path: '/activity', icon: Activity, label: 'Activity Log', adminOnly: true, requiredPerm: 'permViewReports' },
        { path: '/settings', icon: Settings, label: 'Settings', adminOnly: true, requiredPerm: 'permEditSettings' },
    ];

    const filteredMenuItems = menuItems.filter(
        (item) => !item.adminOnly ||
            user?.role === 'ADMIN' ||
            (item.requiredPerm && user?.[item.requiredPerm])
    );

    return (
        <div className="flex h-screen bg-gray-50 dark:bg-dark-bg">
            {/* Sidebar */}
            <aside
                className={`${sidebarOpen ? 'w-52' : 'w-16'
                    } bg-white dark:bg-dark-card border-r border-gray-200 dark:border-dark-border transition-all duration-300 flex flex-col`}
            >
                {/* Logo */}
                <div className="h-14 flex items-center justify-between px-3 border-b border-gray-200 dark:border-dark-border">
                    {sidebarOpen && (
                        <h1 className="text-lg font-bold gradient-primary bg-clip-text text-transparent">
                            Zain POS
                        </h1>
                    )}
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                    >
                        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                    {filteredMenuItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;

                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`${isActive ? 'sidebar-link-active' : 'sidebar-link'} ${!sidebarOpen ? 'justify-center px-0' : ''}`}
                                title={!sidebarOpen ? item.label : ''}
                            >
                                <Icon className="w-5 h-5 flex-shrink-0" />
                                {sidebarOpen && <span>{item.label}</span>}
                            </Link>
                        );
                    })}
                </nav>

                {/* User info */}
                <div className="p-4 border-t border-gray-200 dark:border-dark-border">
                    {sidebarOpen && (
                        <div className="mb-3">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                {user?.name}
                            </p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                                {user?.role}
                            </p>
                        </div>
                    )}
                    <button
                        onClick={handleLogout}
                        className={`sidebar-link w-full text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 ${!sidebarOpen ? 'justify-center px-0' : ''}`}
                        title={!sidebarOpen ? 'Logout' : ''}
                    >
                        <LogOut className="w-5 h-5 flex-shrink-0" />
                        {sidebarOpen && <span>Logout</span>}
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <header className="h-16 bg-white dark:bg-dark-card border-b border-gray-200 dark:border-dark-border flex items-center justify-between px-6">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                            {menuItems.find((item) => item.path === location.pathname)?.label ||
                                'Dashboard'}
                        </h2>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Network Status Indicator */}
                        <NetworkStatus />

                        <button
                            onClick={() => setDarkMode(!darkMode)}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            title={darkMode ? 'Light mode' : 'Dark mode'}
                        >
                            {darkMode ? (
                                <Sun className="w-5 h-5" />
                            ) : (
                                <Moon className="w-5 h-5" />
                            )}
                        </button>
                    </div>
                </header>

                {/* Page content — POS gets zero padding and hidden overflow (manages its own layout) */}
                <main className={`flex-1 ${location.pathname === '/pos' ? 'overflow-hidden p-0' : 'overflow-y-auto p-6'}`}>
                    <Outlet />
                </main>
            </div>
        </div>
    );
};
