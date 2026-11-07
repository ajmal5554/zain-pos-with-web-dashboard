import React, { useState } from 'react';
import { History, Cpu, HardDrive, Globe, Printer, ChevronDown, ChevronUp, Sparkles, CheckCircle2 } from 'lucide-react';
import packageInfo from '../../../package.json';
import appIcon from '/icon.png';
import releasesData from '../../data/releases.json';

interface ChangelogItem {
    type: 'feature' | 'improvement' | 'fix';
    title: string;
    description: string;
}

interface Release {
    version: string;
    title: string;
    date: string;
    isCurrent?: boolean;
    changes: ChangelogItem[];
}

const RELEASES: Release[] = releasesData as Release[];

export const VersionInfo: React.FC = () => {
    const currentRelease = RELEASES.find((r) => r.isCurrent) || RELEASES[0];
    const olderReleases = RELEASES.filter((r) => r.version !== currentRelease.version);

    const [expandedVersions, setExpandedVersions] = useState<string[]>([]);

    const toggleVersion = (version: string) => {
        setExpandedVersions((prev) =>
            prev.includes(version) ? prev.filter((v) => v !== version) : [...prev, version]
        );
    };

    const expandAll = () => {
        setExpandedVersions(olderReleases.map((r) => r.version));
    };

    const collapseAll = () => {
        setExpandedVersions([]);
    };

    return (
        <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Version & System Details (5 cols) */}
                <div className="lg:col-span-5 space-y-6">
                    {/* Application Details Card */}
                    <div className="p-6 bg-gradient-to-br from-blue-50/50 to-indigo-50/20 dark:from-blue-950/20 dark:to-indigo-950/10 rounded-2xl border border-blue-100 dark:border-blue-900/30 space-y-5 shadow-sm">
                        <div className="flex items-center gap-3">
                            <img src={appIcon} alt="Zain POS" className="w-12 h-12 rounded-xl shadow-sm object-contain flex-shrink-0" />
                            <div>
                                <h3 className="font-bold text-lg text-gray-900 dark:text-white">Zain Gents Palace</h3>
                                <p className="text-xs text-gray-500 font-medium">Point of Sale System</p>
                            </div>
                        </div>

                        <div className="space-y-3 pt-1 text-sm">
                            <div className="flex items-center justify-between py-2 border-b border-blue-100/70 dark:border-blue-900/30">
                                <span className="text-gray-500 dark:text-gray-400">Software Version</span>
                                <span className="font-mono font-bold text-base text-blue-600 dark:text-blue-400">
                                    v{packageInfo.version}
                                </span>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-blue-100/70 dark:border-blue-900/30">
                                <span className="text-gray-500 dark:text-gray-400">Release Date</span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">
                                    {currentRelease?.date || 'October 2026'}
                                </span>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-blue-100/70 dark:border-blue-900/30">
                                <span className="text-gray-500 dark:text-gray-400">System Edition</span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">
                                    Retail POS Desktop
                                </span>
                            </div>

                            <div className="flex items-center justify-between pt-1">
                                <span className="text-gray-500 dark:text-gray-400">Build Status</span>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Latest Version
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* System Specifications Card */}
                    <div className="p-6 bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 space-y-4 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gray-800 dark:bg-gray-700 rounded-xl text-white shadow-sm">
                                <Cpu className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-base text-gray-900 dark:text-white">System Environment</h3>
                                <p className="text-xs text-gray-500">Desktop Architecture</p>
                            </div>
                        </div>

                        <div className="space-y-2 pt-1 text-sm">
                            <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700/60">
                                <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                    <Cpu className="w-4 h-4 text-gray-400" />
                                    Runtime
                                </span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">Desktop Electron</span>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700/60">
                                <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                    <HardDrive className="w-4 h-4 text-gray-400" />
                                    Database
                                </span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">SQLite (Offline-First)</span>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700/60">
                                <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                    <Globe className="w-4 h-4 text-gray-400" />
                                    Cloud Sync
                                </span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">Delta Sync (REST)</span>
                            </div>

                            <div className="flex items-center justify-between py-2">
                                <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                    <Printer className="w-4 h-4 text-gray-400" />
                                    Print Engine
                                </span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">ESC/POS Thermal</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: What's New & Release Archive (7 cols) */}
                <div className="lg:col-span-7 space-y-6">
                    {/* Spotlight Card: Current Release (Always Expanded) */}
                    {currentRelease && (
                        <div className="bg-white dark:bg-gray-800/90 rounded-2xl border-2 border-blue-500/30 dark:border-blue-500/40 p-6 shadow-md space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 dark:border-blue-900/30 pb-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                                            <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                                            What's New in v{currentRelease.version}
                                        </span>
                                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                            Current
                                        </span>
                                    </div>
                                    <h4 className="text-base font-extrabold text-gray-900 dark:text-white mt-1.5">
                                        {currentRelease.title}
                                    </h4>
                                </div>
                                <span className="text-xs text-gray-400 dark:text-gray-500 font-medium self-start sm:self-center">
                                    {currentRelease.date}
                                </span>
                            </div>

                            {/* Current Changes List */}
                            <div className="space-y-3 pt-1">
                                {currentRelease.changes.map((item, idx) => (
                                    <div key={idx} className="flex items-start gap-2.5 text-xs">
                                        <span
                                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider shrink-0 mt-0.5 ${
                                                item.type === 'feature'
                                                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                                    : item.type === 'improvement'
                                                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                                    : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                                            }`}
                                        >
                                            {item.type === 'feature' ? 'New' : item.type === 'improvement' ? 'Update' : 'Fix'}
                                        </span>
                                        <div className="text-gray-700 dark:text-gray-300 leading-relaxed">
                                            <span className="font-bold text-gray-900 dark:text-white">{item.title}:</span>{' '}
                                            {item.description}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Past Releases Accordion Section */}
                    {olderReleases.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between px-1">
                                <div className="flex items-center gap-2">
                                    <History className="w-4 h-4 text-gray-400" />
                                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300">
                                        Past Milestones ({olderReleases.length})
                                    </h4>
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                    <button
                                        type="button"
                                        onClick={expandAll}
                                        className="text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    >
                                        Expand all
                                    </button>
                                    <span className="text-gray-300 dark:text-gray-600">|</span>
                                    <button
                                        type="button"
                                        onClick={collapseAll}
                                        className="text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    >
                                        Collapse all
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {olderReleases.map((release) => {
                                    const isExpanded = expandedVersions.includes(release.version);
                                    return (
                                        <div
                                            key={release.version}
                                            className="bg-white dark:bg-gray-800/70 rounded-xl border border-gray-200/80 dark:border-gray-700/80 overflow-hidden shadow-sm transition-all"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => toggleVersion(release.version)}
                                                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0 pr-3">
                                                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 shrink-0">
                                                        v{release.version}
                                                    </span>
                                                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                                                        {release.title}
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-3 shrink-0">
                                                    <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                                        {release.date}
                                                    </span>
                                                    <span className="text-[10px] text-gray-400 font-medium hidden sm:inline">
                                                        {release.changes.length} changes
                                                    </span>
                                                    {isExpanded ? (
                                                        <ChevronUp className="w-4 h-4 text-gray-400" />
                                                    ) : (
                                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                                    )}
                                                </div>
                                            </button>

                                            {isExpanded && (
                                                <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-700/50 space-y-2.5 bg-gray-50/50 dark:bg-gray-800/40">
                                                    {release.changes.map((item, idx) => (
                                                        <div key={idx} className="flex items-start gap-2.5 text-xs">
                                                            <span
                                                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 mt-0.5 ${
                                                                    item.type === 'feature'
                                                                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                                                        : item.type === 'improvement'
                                                                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                                                        : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                                                                }`}
                                                            >
                                                                {item.type === 'feature' ? 'New' : item.type === 'improvement' ? 'Update' : 'Fix'}
                                                            </span>
                                                            <div className="text-gray-700 dark:text-gray-300 leading-relaxed">
                                                                <span className="font-semibold text-gray-900 dark:text-white">{item.title}:</span>{' '}
                                                                {item.description}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
