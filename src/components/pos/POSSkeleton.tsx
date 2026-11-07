import React from 'react';
import { Skeleton } from '../ui/Skeleton';
import { Scan, User, CreditCard, ArrowRight } from 'lucide-react';

export const POSSkeleton: React.FC = () => {
    return (
        <div
            className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 select-none animate-pulse"
            aria-busy="true"
            aria-label="Loading POS session"
        >
            {/* 1. TOP METADATA & SCAN BAR */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-stretch justify-between flex-shrink-0">
                {/* Left: Metadata (Bill No, Date, Customer) */}
                <div className="flex-1 flex items-center gap-3 p-2 min-w-0">
                    {/* Bill No */}
                    <div className="flex flex-col flex-shrink-0 space-y-1">
                        <span className="text-[10px] font-bold uppercase text-gray-400">Bill No</span>
                        <Skeleton className="h-8 w-16 rounded border border-gray-200 dark:border-gray-700" />
                    </div>

                    {/* Invoice Date */}
                    <div className="flex flex-col flex-shrink-0 space-y-1">
                        <span className="text-[10px] font-bold uppercase text-gray-400">Invoice Date</span>
                        <Skeleton className="h-8 w-24 rounded border border-gray-200 dark:border-gray-700" />
                    </div>

                    {/* Customer */}
                    <div className="flex flex-col flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase text-gray-400">Customer</span>
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-3 w-16 rounded" />
                                <Skeleton className="h-3 w-10 rounded" />
                            </div>
                        </div>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
                                <User className="w-4 h-4 opacity-40" />
                            </div>
                            <Skeleton className="h-9 w-full rounded-md border border-gray-200 dark:border-gray-700" />
                        </div>
                    </div>
                </div>

                {/* Right: Scan Barcode Box (w-64) */}
                <div className="w-64 flex-shrink-0 flex flex-col p-2 border-l border-gray-200 dark:border-gray-700 space-y-1">
                    <span className="text-[10px] font-bold uppercase text-primary-500/70 flex items-center gap-1">
                        <Scan className="w-3 h-3" /> Scan Barcode (F1)
                    </span>
                    <Skeleton className="h-9 w-full rounded border border-primary-200 dark:border-primary-900" />
                </div>
            </div>

            {/* 2. MAIN CONTENT SPLIT */}
            <div className="flex-1 flex overflow-hidden min-h-0">
                {/* LEFT: Billing Table (75%) */}
                <div className="flex-[3] flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 min-h-0 overflow-x-auto">
                    <div className="flex flex-col flex-1 min-h-0">
                        {/* Table Header */}
                        <div className="grid grid-cols-[32px_120px_1fr_70px_90px_50px_90px_36px] gap-2 bg-gray-100 dark:bg-gray-900 border-b border-gray-300 dark:border-gray-700 text-xs font-bold uppercase text-gray-400 py-2.5 px-2 min-w-[600px]">
                            <div className="text-center">#</div>
                            <div>Barcode</div>
                            <div>Item Name</div>
                            <div className="text-right">Rate</div>
                            <div className="text-center">Qty</div>
                            <div className="text-right">Tax%</div>
                            <div className="text-right">Total</div>
                            <div className="text-center"></div>
                        </div>

                        {/* Table Body Placeholder (Subtle empty-cart scan indicator) */}
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-gray-300 dark:text-gray-600">
                            <Scan className="w-16 h-16 mb-3 opacity-30 animate-pulse" />
                            <Skeleton className="h-5 w-40 rounded mb-2" />
                            <Skeleton className="h-3.5 w-56 rounded opacity-60" />
                        </div>
                    </div>

                    {/* Footer Totals */}
                    <div className="bg-gray-100 dark:bg-gray-900 border-t border-gray-300 dark:border-gray-700 p-2 shadow-inner">
                        <div className="flex justify-between items-end h-full">
                            {/* Items / Qty / Tax */}
                            <div className="flex gap-6 text-sm text-gray-400 font-medium pb-3">
                                <div className="flex items-center gap-1.5">
                                    <span>Items:</span>
                                    <Skeleton className="h-4 w-5 rounded" />
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span>Qty:</span>
                                    <Skeleton className="h-4 w-5 rounded" />
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span>Tax:</span>
                                    <Skeleton className="h-4 w-12 rounded" />
                                </div>
                            </div>

                            {/* Grand Total & Action Buttons */}
                            <div className="flex gap-4 items-end">
                                <div className="text-right mb-3 space-y-1">
                                    <div className="text-xs uppercase text-gray-400 font-semibold">Grand Total</div>
                                    <Skeleton className="h-7 w-28 rounded-md" />
                                </div>

                                <div className="flex gap-2 h-14">
                                    <div className="h-full px-6 flex items-center justify-center rounded-lg bg-red-100/60 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-400 font-bold text-sm">
                                        Clear (F4)
                                    </div>
                                    <div className="h-full px-8 text-lg font-bold flex items-center justify-center gap-2 rounded-lg bg-emerald-100/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400">
                                        <CreditCard className="w-5 h-5 opacity-70" />
                                        <span>Checkout</span>
                                        <ArrowRight className="w-4 h-4 opacity-70" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT: Product Sidebar (w-64) */}
                <div className="w-64 bg-gray-50 dark:bg-gray-900 flex flex-col border-l border-gray-200 dark:border-gray-700 min-h-0 flex-shrink-0">
                    {/* Search Input Box */}
                    <div className="p-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                        <Skeleton className="h-10 w-full rounded-md" />
                    </div>

                    {/* Subheader */}
                    <div className="px-3 py-1 bg-gray-100 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 text-[10px] font-bold uppercase tracking-wider text-gray-400 flex justify-between items-center">
                        <span>Top Selling & Suggestions</span>
                        <Skeleton className="h-2.5 w-12 rounded" />
                    </div>

                    {/* Product Cards List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div
                                key={i}
                                className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex justify-between items-start"
                            >
                                <div className="min-w-0 flex-1 pr-2 space-y-1.5">
                                    <Skeleton className="h-4 w-28 rounded" />
                                    <div className="flex items-center gap-1.5 mt-1">
                                        <Skeleton className="h-3 w-12 rounded" />
                                        <Skeleton className="h-3 w-14 rounded" />
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0 space-y-1 flex flex-col items-end">
                                    <Skeleton className="h-4 w-12 rounded" />
                                    <Skeleton className="h-2.5 w-14 rounded" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

