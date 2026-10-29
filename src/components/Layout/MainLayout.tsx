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
    Menu,
    X,
    Activity,
    UserCog,
    Shield,
    TrendingUp,
    Receipt,
    Wallet,
    Calendar,
    Shirt,
    Truck,
    Banknote,
    BarChart3,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { NetworkStatus } from '../NetworkStatus';
import appIcon from '/icon.png';

type PermissionKey = 'permViewReports' | 'permViewInsights' | 'permManageProducts' | 'permViewSales' | 'permViewGstReports' | 'permManageUsers' | 'permEditSettings' | 'permManageCashDrawer' | 'permManageInventory';
type ShopBrand = {
    shopName: string;
    logo: string;
};

export const MainLayout: React.FC = () => {
    const [sidebarOpen, setSidebarOpen] = React.useState(true);
    const [shopBrand, setShopBrand] = React.useState<ShopBrand>({
        shopName: 'Zain POS',
        logo: '',
    });
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
                            permManageCashDrawer: true,
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
                        permManageCashDrawer: user.permManageCashDrawer,
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
                        permManageCashDrawer: freshUser.permManageCashDrawer,
                        maxDiscount: freshUser.maxDiscount
                    });

                    if (currentPerms !== newPerms) {
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
        document.documentElement.classList.remove('dark');
    }, []);

    React.useEffect(() => {
        const loadShopBrand = async () => {
            try {
                const result = await window.electronAPI.settings.get({ key: 'SHOP_SETTINGS' });
                if (result?.success && result.data) {
                    const parsed = JSON.parse(result.data as string);
                    setShopBrand({
                        shopName: parsed?.shopName || 'Zain POS',
                        logo: parsed?.logo || '',
                    });
                }
            } catch {
                // no-op
            }
        };

        const handleBrandUpdate = (event: Event) => {
            const detail = (event as CustomEvent<ShopBrand>).detail;
            setShopBrand({
                shopName: detail?.shopName || 'Zain POS',
                logo: detail?.logo || '',
            });
        };

        loadShopBrand();
        window.addEventListener('shop-brand-updated', handleBrandUpdate);

        return () => {
            window.removeEventListener('shop-brand-updated', handleBrandUpdate);
        };
    }, []);

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
        { path: '/forecasting', icon: TrendingUp, label: 'Sales Forecasting', adminOnly: true, requiredPerm: 'permViewInsights' },
        { path: '/products', icon: Shirt, label: 'Products', adminOnly: true, requiredPerm: 'permManageProducts' },
        { path: '/purchases', icon: Truck, label: 'Purchases', adminOnly: true, requiredPerm: 'permManageInventory' },
        { path: '/stock', icon: Package, label: 'Stock', adminOnly: true, requiredPerm: 'permManageInventory' },
        { path: '/customers', icon: Users, label: 'Customers' },
        { path: '/sales', icon: Receipt, label: 'Sales History', adminOnly: true, requiredPerm: 'permViewSales' },
        { path: '/profit', icon: BarChart3, label: 'Profit & Analysis', adminOnly: true },
        { path: '/expenses', icon: Banknote, label: 'Expenses', adminOnly: true, requiredPerm: 'permManageCashDrawer' },
        { path: '/cash-drawer', icon: Wallet, label: 'Cash Register', adminOnly: true, requiredPerm: 'permManageCashDrawer' },
        { path: '/reports', icon: FileText, label: 'GST Reports', adminOnly: true, requiredPerm: 'permViewGstReports' },
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
        <div className="flex h-full bg-gray-50 dark:bg-dark-bg">
            {/* Sidebar */}
            <aside
                className={`${
                    sidebarOpen ? 'w-52' : 'w-16'
                } bg-white dark:bg-dark-card border-r border-gray-200 dark:border-dark-border transition-[width] duration-300 ease-in-out overflow-hidden flex flex-col flex-shrink-0 will-change-[width]`}
            >
                {/* Logo & Toggle */}
                <div className={`h-16 flex items-center ${sidebarOpen ? 'justify-between px-3' : 'justify-center px-2'} border-b border-gray-200 dark:border-dark-border`}>
                    <div
                        className={`flex items-center overflow-hidden transition-all duration-300 ease-in-out ${
                            sidebarOpen ? 'max-w-[140px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'
                        }`}
                    >
                        <div className="flex items-center gap-2.5 whitespace-nowrap">
                            <img
                                src={appIcon}
                                alt="Zain POS"
                                className="w-7 h-7 object-contain flex-shrink-0"
                            />
                            <h1 className="text-lg font-bold gradient-primary bg-clip-text text-transparent">
                                Zain POS
                            </h1>
                        </div>
                    </div>
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex-shrink-0 transition-colors duration-200"
                        title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                    >
                        {sidebarOpen ? <X className="w-5 h-5 text-gray-600 dark:text-gray-300" /> : <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />}
                    </button>
                </div>

                {/* Navigation */}
                <nav className={`flex-1 space-y-1 overflow-y-auto ${!sidebarOpen ? 'no-scrollbar px-2.5' : 'px-3'} pt-3 pb-8`}>
                    {filteredMenuItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;

                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`${isActive ? 'sidebar-link-active' : 'sidebar-link'} ${
                                    !sidebarOpen ? 'justify-center !px-0' : ''
                                }`}
                                title={!sidebarOpen ? item.label : ''}
                            >
                                <Icon className="w-5 h-5 flex-shrink-0" />
                                <span
                                    className={`whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out ${
                                        sidebarOpen
                                            ? 'max-w-[140px] opacity-100 ml-3'
                                            : 'max-w-0 opacity-0 ml-0 pointer-events-none'
                                    }`}
                                >
                                    {item.label}
                                </span>
                            </Link>
                        );
                    })}
                </nav>

                {/* User info */}
                <div className={`border-t border-gray-200 dark:border-dark-border ${!sidebarOpen ? 'p-2.5' : 'p-3'}`}>
                    <div
                        className={`overflow-hidden transition-all duration-300 ease-in-out ${
                            sidebarOpen ? 'max-h-16 opacity-100 mb-2' : 'max-h-0 opacity-0 mb-0 pointer-events-none'
                        }`}
                    >
                        <div className="px-2.5 py-1 whitespace-nowrap">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                {user?.name}
                            </p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                {user?.role}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className={`w-full h-10 flex items-center ${
                            !sidebarOpen ? 'justify-center !px-0' : 'px-2.5'
                        } rounded-xl text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-200`}
                        title={!sidebarOpen ? 'Logout' : ''}
                    >
                        <LogOut className="w-5 h-5 flex-shrink-0" />
                        <span
                            className={`whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out ${
                                sidebarOpen
                                    ? 'max-w-[140px] opacity-100 ml-3'
                                    : 'max-w-0 opacity-0 ml-0 pointer-events-none'
                            }`}
                        >
                            Logout
                        </span>
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <header className="h-16 bg-white dark:bg-dark-card border-b border-gray-200 dark:border-dark-border flex items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                            {menuItems.find((item) => item.path === location.pathname)?.label ||
                                'Dashboard'}
                        </h2>
                        {location.pathname === '/cash-drawer' && (
                            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700">
                                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                {new Date().toLocaleDateString('en-IN', {
                                    weekday: 'short',
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                })}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Network Status Indicator */}
                        <NetworkStatus />
                    </div>
                </header>

                {/* Page content */}
                <main className={`flex-1 ${
                    location.pathname === '/pos'
                        ? 'overflow-hidden p-0'
                        : 'overflow-y-auto p-6'
                }`}>
                    <Outlet />
                </main>
            </div>
        </div>
    );
};



