import {
    Boxes,
    BarChart3,
    ClipboardList,
    Cog,
    HandCoins,
    Home,
    PackageSearch,
    ShieldCheck,
    Users,
    UserRoundSearch,
    ShoppingBag,
    TrendingUp,
    Banknote,
    Wallet,
    Truck
} from 'lucide-react';

export const navigation = [
    { name: 'Home', href: '/', icon: Home, shortLabel: 'Home' },
    { name: 'Sales', href: '/sales', icon: ShoppingBag, shortLabel: 'Sales' },
    { name: 'Profit & Margins', href: '/profit', icon: TrendingUp, shortLabel: 'Profit' },
    { name: 'Expenses', href: '/expenses', icon: Banknote, shortLabel: 'Expenses' },
    { name: 'Cash Register', href: '/cash-drawer', icon: Wallet, shortLabel: 'Register' },
    { name: 'Stock Levels', href: '/inventory', icon: Boxes, shortLabel: 'Stock' },
    { name: 'Products', href: '/products', icon: PackageSearch, shortLabel: 'Products' },
    { name: 'Purchases', href: '/purchases', icon: Truck, shortLabel: 'Purchases' },
    { name: 'Customers', href: '/customers', icon: UserRoundSearch, shortLabel: 'Customers' },
    { name: 'GST Reports', href: '/reports', icon: BarChart3, shortLabel: 'Reports' },
    { name: 'Future Sales', href: '/forecasting', icon: HandCoins, shortLabel: 'Forecast' },
    { name: 'Users', href: '/users', icon: Users, shortLabel: 'Users' },
    { name: 'Access', href: '/permissions', icon: ShieldCheck, shortLabel: 'Access' },
    { name: 'Settings', href: '/settings', icon: Cog, shortLabel: 'Settings' },
    { name: 'History Logs', href: '/activity', icon: ClipboardList, shortLabel: 'Logs' }
] as const;
