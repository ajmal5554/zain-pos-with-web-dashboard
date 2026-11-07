import React from 'react';
import { Skeleton } from '../ui/Skeleton';
import { TrendingUp, Layers, Clock, Package, Calendar, BarChart3 } from 'lucide-react';

interface ForecastingSkeletonProps {
    horizon?: number;
}

export const ForecastingSkeleton: React.FC<ForecastingSkeletonProps> = ({ horizon = 6 }) => {
    return (
        <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading sales forecasts">
            {/* 1. Subtitle & Basis Banner Skeleton */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Skeleton className="h-3.5 w-72 rounded" />
                </div>

                <div className="rounded-2xl p-5 border border-primary-100 dark:border-primary-900/40 bg-primary-50/40 dark:bg-primary-950/20">
                    <div className="flex items-start gap-3.5">
                        <div className="p-2 rounded-xl bg-primary-100/70 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 shrink-0">
                            <TrendingUp className="w-5 h-5 opacity-60" />
                        </div>
                        <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-4 w-52 rounded" />
                                <Skeleton className="h-5 w-24 rounded-full" />
                            </div>
                            <Skeleton className="h-3.5 w-full max-w-xl rounded" />
                            <Skeleton className="h-3.5 w-80 rounded" />
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. 4 Hero Stat Cards Grid */}
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {/* Card 1: Next Month Forecast */}
                <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1">
                            <Skeleton className="h-3 w-28 rounded" />
                            <Skeleton className="h-7 w-32 rounded-md" />
                        </div>
                        <div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-400">
                            <TrendingUp className="w-5 h-5 opacity-60" />
                        </div>
                    </div>
                    <div className="pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                        <Skeleton className="h-3 w-20 rounded" />
                    </div>
                </div>

                {/* Card 2: Projected Total */}
                <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1">
                            <Skeleton className="h-3 w-36 rounded" />
                            <Skeleton className="h-7 w-32 rounded-md" />
                        </div>
                        <div className="p-2 rounded-xl bg-primary-50 dark:bg-primary-950/40 text-primary-400">
                            <Layers className="w-5 h-5 opacity-60" />
                        </div>
                    </div>
                    <div className="pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                        <Skeleton className="h-3 w-44 rounded" />
                    </div>
                </div>

                {/* Card 3: Current Month So Far */}
                <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1">
                            <Skeleton className="h-3 w-32 rounded" />
                            <Skeleton className="h-7 w-28 rounded-md" />
                        </div>
                        <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-400">
                            <Clock className="w-5 h-5 opacity-60" />
                        </div>
                    </div>
                    <div className="pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                        <Skeleton className="h-3 w-48 rounded" />
                    </div>
                </div>

                {/* Card 4: Restocking Checks */}
                <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1">
                            <Skeleton className="h-3 w-28 rounded" />
                            <Skeleton className="h-7 w-16 rounded-md" />
                        </div>
                        <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-400">
                            <Package className="w-5 h-5 opacity-60" />
                        </div>
                    </div>
                    <div className="pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                        <Skeleton className="h-3 w-40 rounded" />
                    </div>
                </div>
            </div>

            {/* 3. Sales Forecast Chart & Table Card Skeleton */}
            <section className="card p-5 space-y-5 shadow-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-dark-border pb-4">
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-primary-500/60" />
                            <Skeleton className="h-5 w-56 rounded-md" />
                        </div>
                        <Skeleton className="h-3.5 w-80 rounded" />
                    </div>
                </div>

                {/* Chart Area Skeleton */}
                <div className="h-72 w-full flex flex-col justify-end gap-3 pt-4 px-2">
                    <div className="h-full w-full flex items-end gap-3 sm:gap-4 justify-between pb-3">
                        {[45, 52, 60, 58, 65, 70, 75, 72, 80, 85, 82, 88].map((h, idx) => (
                            <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                                <Skeleton
                                    className="w-full rounded-t-md opacity-70"
                                    style={{ height: `${h}%` }}
                                />
                                <Skeleton className="h-3 w-8 rounded" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Upcoming Months Table Skeleton */}
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-border">
                    <table className="table w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-dark-border">
                                {['Upcoming month', 'Forecast', 'Planning scenario range', 'Same month last year', 'Projected change vs last year'].map((h) => (
                                    <th key={h} className="px-4 py-3 bg-gray-50 dark:bg-dark-bg/70 text-xs font-semibold text-gray-500">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-dark-border">
                            {Array.from({ length: horizon }).map((_, i) => (
                                <tr key={i} className="hover:bg-gray-50/50">
                                    <td className="px-4 py-3"><Skeleton className="h-4 w-20 rounded" /></td>
                                    <td className="px-4 py-3"><Skeleton className="h-4 w-24 rounded font-bold" /></td>
                                    <td className="px-4 py-3"><Skeleton className="h-4 w-36 rounded" /></td>
                                    <td className="px-4 py-3"><Skeleton className="h-4 w-24 rounded" /></td>
                                    <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* 4. Sales Comparisons Section Skeleton */}
            <section className="card p-5 space-y-4 shadow-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl">
                <div className="border-b border-gray-100 dark:border-dark-border pb-3">
                    <div className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-primary-500/60" />
                        <Skeleton className="h-5 w-44 rounded-md" />
                    </div>
                    <Skeleton className="h-3 w-96 rounded mt-1.5" />
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="p-4 rounded-xl border border-gray-100 dark:border-dark-border bg-gray-50/50 dark:bg-dark-bg/20 space-y-2.5">
                            <Skeleton className="h-3.5 w-40 rounded" />
                            <Skeleton className="h-6 w-28 rounded-md" />
                            <Skeleton className="h-3 w-full rounded" />
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
};

