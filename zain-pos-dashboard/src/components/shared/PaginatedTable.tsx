import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type ReactNode } from 'react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';

interface PaginatedTableProps<T> {
    data: T[];
    columns: {
        header: string;
        accessor?: keyof T;
        render?: (item: T) => ReactNode;
        className?: string;
        mobileHidden?: boolean; // hide column on mobile
    }[];
    page: number;
    total?: number;
    onPageChange: (page: number) => void;
    loading?: boolean;
    emptyMessage?: string;
    itemsPerPage?: number;
    onLimitChange?: (limit: number) => void;
}

export function PaginatedTable<T extends { id: string | number }>({
    data,
    columns,
    page,
    total = 0,
    onPageChange,
    loading = false,
    emptyMessage = "No records found",
    itemsPerPage = 10,
    onLimitChange
}: PaginatedTableProps<T>) {

    const totalPages = Math.max(1, Math.ceil(total / itemsPerPage));

    const getPageNumbers = () => {
        const pages: (number | string)[] = [];
        if (totalPages <= 5) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            if (page <= 3) {
                pages.push(1, 2, 3, '...', totalPages);
            } else if (page >= totalPages - 2) {
                pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages);
            } else {
                pages.push(1, '...', page, '...', totalPages);
            }
        }
        return pages;
    };

    return (
        <div className="w-full space-y-3">
            {/* Scrollable table wrapper — fixes overflow on mobile */}
            <div className="overflow-x-auto w-full">
                <Table className="min-w-full">
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            {columns.map((col, idx) => (
                                <TableHead
                                    key={idx}
                                    className={cn(
                                        col.mobileHidden && "hidden sm:table-cell",
                                        col.className
                                    )}
                                >
                                    {col.header}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            Array.from({ length: 5 }).map((_, idx) => (
                                <TableRow key={idx}>
                                    {columns.map((col, colIdx) => (
                                        <TableCell
                                            key={colIdx}
                                            className={cn(col.mobileHidden && "hidden sm:table-cell")}
                                        >
                                            <div className="h-4 bg-muted rounded animate-pulse" />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : data.length > 0 ? (
                            data.map((row) => (
                                <TableRow key={row.id} className="group transition-colors">
                                    {columns.map((col, colIdx) => (
                                        <TableCell
                                            key={colIdx}
                                            className={cn(
                                                col.mobileHidden && "hidden sm:table-cell",
                                                col.className
                                            )}
                                        >
                                            {col.render ? col.render(row) : (col.accessor ? String(row[col.accessor]) : null)}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground text-sm">
                                    {emptyMessage}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between gap-2 px-2 py-1 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Show</span>
                    <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                        value={itemsPerPage}
                        onChange={(e) => onLimitChange?.(Number(e.target.value))}
                        disabled={loading || !onLimitChange}
                    >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                    </select>
                    <span className="text-xs text-muted-foreground">of {total}</span>
                </div>

                <div className="flex items-center gap-1">
                    <Button
                        variant="outline"
                        size="icon"
                        disabled={page <= 1 || loading}
                        onClick={() => onPageChange(page - 1)}
                        className="h-8 w-8"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>

                    <div className="flex items-center gap-0.5">
                        {getPageNumbers().map((p, idx) => (
                            typeof p === 'number' ? (
                                <Button
                                    key={idx}
                                    variant={p === page ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => onPageChange(p)}
                                    disabled={loading}
                                    className="h-8 w-8 text-xs p-0"
                                >
                                    {p}
                                </Button>
                            ) : (
                                <span key={idx} className="px-1 text-muted-foreground text-xs">…</span>
                            )
                        ))}
                    </div>

                    <Button
                        variant="outline"
                        size="icon"
                        disabled={page >= totalPages || loading}
                        onClick={() => onPageChange(page + 1)}
                        className="h-8 w-8"
                    >
                        <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
