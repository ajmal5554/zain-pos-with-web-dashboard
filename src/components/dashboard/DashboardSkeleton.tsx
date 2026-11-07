import React from 'react';
import { Skeleton } from '../ui/Skeleton';

export const DashboardSkeleton: React.FC = () => {
    return (
        <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading dashboard">
            {/* Top Banner Skeleton */}
            <div className="card bg-gradient-to-r from-primary-600/80 to-primary-800/80 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 sm:p-6 rounded-2xl shadow-sm">
                <div className="space-y-2">
                    <div className="h-7 w-56 bg-white/25 rounded-lg" />
                    <div className="h-4 w-72 sm:w-96 bg-white/20 rounded-md" />
                </div>
                <div className="h-12 w-44 bg-white/20 rounded-xl flex-shrink-0" />
            </div>

            {/* 5 Stats Cards Grid Skeleton */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                {[1, 2, 3, 4, 5].map((i) => (
                    <div
                        key={i}
                        className="stat-card p-4 space-y-3 bg-white dark:bg-dark-card border border-gray-100 dark:border-dark-border rounded-xl"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="space-y-2 flex-1">
                                <Skeleton className="h-3.5 w-24 rounded-md" />
                                <Skeleton className="h-6 w-32 rounded-lg" />
                                <Skeleton className="h-3 w-28 rounded-md mt-1" />
                            </div>
                            <Skeleton className="w-9 h-9 rounded-lg flex-shrink-0" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Sales Overview Chart Skeleton */}
            <div className="card bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-gray-100 dark:border-dark-border">
                    <div className="flex items-center gap-2">
                        <Skeleton className="w-5 h-5 rounded" />
                        <Skeleton className="h-5 w-36 rounded-md" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Skeleton className="h-8 w-16 rounded-md" />
                        <Skeleton className="h-8 w-16 rounded-md" />
                        <Skeleton className="h-8 w-16 rounded-md" />
                        <Skeleton className="h-8 w-16 rounded-md" />
                        <Skeleton className="h-8 w-20 rounded-md" />
                        <Skeleton className="h-8 w-32 rounded-md" />
                    </div>
                </div>

                {/* Simulated Chart Graph Area */}
                <div className="h-[320px] w-full flex flex-col justify-end gap-3 pt-6 px-2">
                    <div className="h-full w-full flex items-end gap-3 sm:gap-4 justify-between pb-4">
                        {[40, 65, 30, 85, 55, 95, 45, 70, 60, 90, 75, 50].map((h, idx) => (
                            <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                                <Skeleton
                                    className="w-full rounded-t-md opacity-70"
                                    style={{ height: `${h}%` }}
                                />
                                <Skeleton className="h-3 w-6 rounded" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Bottom 2-Column Cards Grid Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Selling Products Skeleton */}
                <div className="card bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <Skeleton className="w-5 h-5 rounded" />
                        <Skeleton className="h-5 w-44 rounded-md" />
                    </div>
                    <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
                            >
                                <div className="space-y-1.5 flex-1">
                                    <Skeleton className="h-4 w-36 rounded" />
                                    <Skeleton className="h-3 w-20 rounded" />
                                </div>
                                <Skeleton className="h-5 w-20 rounded" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Low Stock Alerts Skeleton */}
                <div className="card bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <Skeleton className="w-5 h-5 rounded" />
                        <Skeleton className="h-5 w-36 rounded-md" />
                    </div>
                    <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
                            >
                                <div className="space-y-1.5 flex-1">
                                    <Skeleton className="h-4 w-40 rounded" />
                                    <Skeleton className="h-3 w-24 rounded" />
                                </div>
                                <div className="space-y-1.5 text-right flex flex-col items-end">
                                    <Skeleton className="h-4 w-16 rounded" />
                                    <Skeleton className="h-3 w-12 rounded" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

