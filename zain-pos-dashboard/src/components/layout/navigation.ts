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
    { name: 'Overview', href: '/', icon: Home, shortLabel: 'Home' },
    { name: 'Sales', href: '/sales', icon: ShoppingBag, shortLabel: 'Sales' },
    { name: 'Inventory', href: '/inventory', icon: Boxes, shortLabel: 'Stock' },
    { name: 'Products', href: '/products', icon: PackageSearch, shortLabel: 'Products' },
    { name: 'Customers', href: '/customers', icon: UserRoundSearch, shortLabel: 'Customers' },
    { name: 'Invoices', href: '/invoices', icon: Receipt, shortLabel: 'Bills' },
    { name: 'Reports', href: '/reports', icon: BarChart3, shortLabel: 'Reports' },
    { name: 'Forecasting', href: '/forecasting', icon: HandCoins, shortLabel: 'Forecast' },
    { name: 'Users', href: '/users', icon: Users, shortLabel: 'Users' },
    { name: 'Permissions', href: '/permissions', icon: ShieldCheck, shortLabel: 'Access' },
    { name: 'Settings', href: '/settings', icon: Cog, shortLabel: 'Settings' },
    { name: 'Activity', href: '/activity', icon: ClipboardList, shortLabel: 'Logs' }
] as const;
