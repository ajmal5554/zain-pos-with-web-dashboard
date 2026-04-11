import * as React from 'react';
import { useEffect, useState } from 'react';
import { Activity, Search, ShoppingCart, Trash2, User, Clock, Terminal, Filter, ShieldAlert } from 'lucide-react';
import api from '@/lib/api';
import { demoActivityLogs, isDemoModeEnabled } from '@/lib/demo';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AuditLog {
    id: string;
    action: string;
    details: string;
    userId: string;
    createdAt: string;
    user?: {
        name: string;
        role: string;
    };
}

/**
 * Security-relevant actions that should appear in activity log
 * Activity log is for audit/security, NOT a duplicate of sales history
 */
const SECURITY_RELEVANT_ACTIONS = [
    // Authentication & Authorization
    'USER_LOGIN',
    'USER_LOGOUT',
    'LOGIN_FAILED',
    'PASSWORD_CHANGE',
    'PERMISSION_CHANGE',
    
    // Critical Business Operations
    'SALE_REFUND',
    'SALE_RETURN',
    'SALE_VOID',
    'SALE_DELETE',
    'SALE_UPDATE', // Only if actual changes detected (backend should handle)
    'DISCOUNT_APPLIED',
    'PRICE_OVERRIDE',
    'INVENTORY_ADJUSTMENT',
    'PRODUCT_DELETE',
    'CUSTOMER_DELETE',
    
    // System Operations
    'DATA_SYNC',
    'REPORT_GENERATED',
    'SETTINGS_CHANGE',
    'BACKUP_CREATED',
    'BACKUP_RESTORED',
    'USER_CREATED',
    'USER_UPDATED',
    'USER_DELETED',
    
    // Financial Reconciliation
    'CASH_DRAWER_OPEN',
    'CASH_DRAWER_CLOSE',
    'SHIFT_START',
    'SHIFT_END',
    'CASH_RECONCILIATION',
    
    // Alerts (security-related only)
    'INVENTORY_ALERT', // Keep for low stock warnings
];

/**
 * Filter out non-security-relevant events
 * These are already tracked elsewhere (Sales History, etc.)
 */
function isSecurityRelevant(action: string): boolean {
    // Convert action to uppercase for comparison
    const normalizedAction = action.toUpperCase();
    
    // Explicitly exclude sales creation - it's in Sales History
    if (normalizedAction.includes('SALE_CREATE') || 
        normalizedAction.includes('SALE_COMPLETED') ||
        normalizedAction === 'SALE CREATE' ||
        normalizedAction === 'SALE COMPLETED') {
        return false;
    }
    
    // Check if action matches any security-relevant pattern
    return SECURITY_RELEVANT_ACTIONS.some(secureAction => 
        normalizedAction.includes(secureAction) || 
        normalizedAction.replace(/ /g, '_') === secureAction
    );
}

export default function ActivityPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');

    useEffect(() => {
        void fetchLogs();
    }, []);

    const fetchLogs = async () => {
        try {
            setLoading(true);

            if (isDemoModeEnabled()) {
                // Filter demo logs to show only security-relevant actions
                const filteredDemoLogs = demoActivityLogs.filter(log => 
                    isSecurityRelevant(log.action)
                );
                setLogs(filteredDemoLogs);
                return;
            }

            const response = await api.get('/activity');
            // Filter backend logs to show only security-relevant actions
            const filteredLogs = (response.data || []).filter((log: AuditLog) => 
                isSecurityRelevant(log.action)
            );
            setLogs(filteredLogs);
        } catch (error) {
            console.error('Failed to fetch activity logs:', error);
        } finally {
            setLoading(false);
        }
    };

    const getIcon = (action: string) => {
        const upperAction = action.toUpperCase();
        
        // Critical/Destructive actions
        if (upperAction.includes('DELETE') || 
            upperAction.includes('VOID') || 
            upperAction.includes('REFUND') ||
            upperAction.includes('RETURN')) {
            return <Trash2 className="text-rose-500 h-5 w-5" />;
        }
        
        // Authentication/User actions
        if (upperAction.includes('LOGIN') || 
            upperAction.includes('LOGOUT') || 
            upperAction.includes('PASSWORD') ||
            upperAction.includes('USER')) {
            return <User className="text-sky-500 h-5 w-5" />;
        }
        
        // System/Admin actions
        if (upperAction.includes('SYNC') || 
            upperAction.includes('BACKUP') || 
            upperAction.includes('SETTINGS') ||
            upperAction.includes('REPORT')) {
            return <ShieldAlert className="text-amber-500 h-5 w-5" />;
        }
        
        // Financial operations
        if (upperAction.includes('SALE') || 
            upperAction.includes('CASH') || 
            upperAction.includes('SHIFT') ||
            upperAction.includes('RECONCILIATION')) {
            return <ShoppingCart className="text-emerald-500 h-5 w-5" />;
        }
        
        return <Activity className="text-slate-500 h-5 w-5" />;
    };

    const filteredLogs = logs.filter((log) =>
        log.details.toLowerCase().includes(filter.toLowerCase()) ||
        log.action.toLowerCase().includes(filter.toLowerCase()) ||
        (log.user?.name || '').toLowerCase().includes(filter.toLowerCase())
    );

    return (
        <div className="flex-1 space-y-4 pt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Activity Log</h2>
                    <p className="text-muted-foreground text-sm">
                        Security audit trail for critical user actions and system events.
                    </p>
                </div>
            </div>

            <Card>
                <CardContent className="p-4">
                    <div className="relative max-w-sm flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search logs..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                </CardContent>
            </Card>

            {loading ? (
                <div className="flex items-center justify-center p-8 text-muted-foreground">
                    Loading logs...
                </div>
            ) : filteredLogs.length > 0 ? (
                <div className="space-y-4">
                    {filteredLogs.map((log) => (
                        <Card key={log.id}>
                             <div className="flex items-start gap-4 p-4">
                                 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted">
                                     {getIcon(log.action)}
                                 </div>
                                 <div className="flex-1 space-y-1">
                                     <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                                         <h3 className="text-sm font-semibold capitalize">
                                             {log.action.replace(/_/g, ' ').toLowerCase()}
                                         </h3>
                                         <div className="flex items-center gap-2 mt-1 sm:mt-0 text-xs text-muted-foreground">
                                             <Clock className="h-3 w-3" />
                                             <span>
                                                 {new Date(log.createdAt).toLocaleString()}
                                             </span>
                                         </div>
                                     </div>
                                     
                                     <p className="text-sm text-muted-foreground">
                                         {log.details}
                                     </p>

                                     <div className="flex items-center gap-2 mt-2 pt-2 border-t text-xs text-muted-foreground">
                                          <User className="h-3 w-3" />
                                          <span>{log.user?.name || 'System'}</span>
                                     </div>
                                 </div>
                             </div>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="p-8 text-center text-muted-foreground border rounded-md bg-card">
                     No logs found matching your search.
                </div>
            )}
        </div>
    );
}
