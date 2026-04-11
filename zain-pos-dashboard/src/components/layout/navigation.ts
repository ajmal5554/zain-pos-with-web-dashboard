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
    Receipt,
    ShoppingBag
} from 'lucide-react';

export const navigation = [
    { name: 'Home', href: '/', icon: Home, shortLabel: 'Home' },
    { name: 'Sales', href: '/sales', icon: ShoppingBag, shortLabel: 'Sales' },
    { name: 'Stock', href: '/inventory', icon: Boxes, shortLabel: 'Stock' },
    { name: 'Products', href: '/products', icon: PackageSearch, shortLabel: 'Products' },
    { name: 'Customers', href: '/customers', icon: UserRoundSearch, shortLabel: 'Customers' },
    { name: 'Bills', href: '/invoices', icon: Receipt, shortLabel: 'Bills' },
    { name: 'Reports', href: '/reports', icon: BarChart3, shortLabel: 'Reports' },
    { name: 'Future Sales', href: '/forecasting', icon: HandCoins, shortLabel: 'Forecast' },
    { name: 'Users', href: '/users', icon: Users, shortLabel: 'Users' },
    { name: 'Access', href: '/permissions', icon: ShieldCheck, shortLabel: 'Access' },
    { name: 'Settings', href: '/settings', icon: Cog, shortLabel: 'Settings' },
    { name: 'History Logs', href: '/activity', icon: ClipboardList, shortLabel: 'Logs' }
] as const;
