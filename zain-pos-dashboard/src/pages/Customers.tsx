import { useState, useEffect } from 'react';
import { UserRoundSearch, Search, Mail, Phone, Calendar, User, MoreHorizontal, FileText, Plus, Fingerprint, Activity, ShieldCheck } from 'lucide-react';
import { StatCard } from '@/components/shared/StatCard';
import { PaginatedTable } from '@/components/shared/PaginatedTable';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger 
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { customerService, type Customer } from '@/features/customers/services/customer.service';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/utils';

export default function CustomersPage() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [data, setData] = useState<{ customers: Customer[], total: number }>({ customers: [], total: 0 });
    const [loading, setLoading] = useState(true);
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

    useEffect(() => {
        void loadCustomers();
    }, [page, search]);

    async function loadCustomers() {
        try {
            setLoading(true);
            const response = await customerService.getCustomers(page, 10, search);
            setData({ customers: response.customers, total: response.pagination.total });
        } catch (error: any) {
            toast.error('Failed to load customers');
        } finally {
            setLoading(false);
        }
    }

    const columns = [
        {
            key: 'name',
            header: 'Customer Name',
            render: (customer: Customer) => (
                <div className="flex items-center gap-3 py-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0 border">
                        <User className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="font-medium text-sm">{customer.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">ID: {customer.id.slice(0, 8).toUpperCase()}</p>
                    </div>
                </div>
            )
        },
        {
            key: 'contact',
            header: 'Contact Info',
            render: (customer: Customer) => (
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        <span>{customer.phone || 'No Phone Number'}</span>
                    </div>
                    {customer.email && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            <span>{customer.email}</span>
                        </div>
                    )}
                </div>
            )
        },
        {
            key: 'gstin',
            header: 'GST Number',
            render: (customer: Customer) => (
                <Badge variant="secondary" className="font-normal">
                    {customer.gstin ? customer.gstin : 'No GST given'}
                </Badge>
            )
        },
        {
            key: 'createdAt',
            header: 'Date Added',
            render: (customer: Customer) => (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>{new Date(customer.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
            )
        },
        {
            key: 'actions',
            header: '',
            render: () => (
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <FileText className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </div>
            )
        }
    ];

    return (
        <div className="flex-1 space-y-4 pt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Customers</h2>
                    <p className="text-muted-foreground text-sm">
                        View and manage your customers.
                    </p>
                </div>
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Customer
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-xl">
                        <DialogHeader>
                            <DialogTitle>Add Customer</DialogTitle>
                            <DialogDescription>Enter details to create a new customer record.</DialogDescription>
                        </DialogHeader>
                        <div className="grid grid-cols-2 gap-4 py-4">
                            <div className="space-y-2 col-span-2">
                                <label className="text-sm font-medium">Customer Name</label>
                                <input 
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                    placeholder="Enter full name" 
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Phone Number</label>
                                <input 
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                    placeholder="+91 XXXXX XXXXX" 
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">GST Number</label>
                                <input 
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                                    placeholder="Optional" 
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
                            <Button>Save Customer</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard title="Total Customers" value={data.total} icon={<User className="h-4 w-4" />} loading={loading} />
                <StatCard title="Active" value={Math.floor(data.total * 0.4)} icon={<Activity className="h-4 w-4" />} loading={loading} />
                <StatCard title="New This Month" value="12" icon={<Calendar className="h-4 w-4" />} loading={loading} />
                <StatCard title="Returning" value="84%" icon={<UserRoundSearch className="h-4 w-4" />} trend={2} loading={loading} />
            </div>

            <Card>
                <CardContent className="p-4">
                    <div className="relative max-w-sm flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search customers..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="rounded-md border bg-card overflow-hidden">
                <CardContent className="p-0">
                    <PaginatedTable
                        columns={columns}
                        data={data.customers}
                        total={data.total}
                        page={page}
                        onPageChange={setPage}
                        loading={loading}
                    />
                </CardContent>
            </div>
        </div>
    );
}
