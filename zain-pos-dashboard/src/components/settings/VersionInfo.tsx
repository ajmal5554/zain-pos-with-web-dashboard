import React, { useState } from 'react';
import { History, Cpu, HardDrive, Globe, Printer, ChevronDown, ChevronUp, Sparkles, CheckCircle2 } from 'lucide-react';
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
  const olderReleases = RELEASES.filter((r) => r.version !== currentRelease?.version);

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
    <div className="w-full space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Version & System Details */}
        <div className="lg:col-span-5 space-y-6">
          <div className="p-6 bg-gradient-to-br from-blue-50/50 to-indigo-50/20 dark:from-blue-950/20 dark:to-indigo-950/10 rounded-2xl border border-blue-100 dark:border-blue-900/30 space-y-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center p-2 shadow-sm text-white font-bold text-xl">
                Z
              </div>
              <div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">Zain Gents Palace</h3>
                <p className="text-xs text-muted-foreground font-medium">Store Management & Decision Portal</p>
              </div>
            </div>

            <div className="space-y-3 pt-1 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-blue-100/70 dark:border-blue-900/30">
                <span className="text-muted-foreground">Software Version</span>
                <span className="font-mono font-bold text-base text-blue-600 dark:text-blue-400">
                  v3.1.0 (Web)
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-blue-100/70 dark:border-blue-900/30">
                <span className="text-muted-foreground">Release Date</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {currentRelease?.date || 'November 2026'}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-blue-100/70 dark:border-blue-900/30">
                <span className="text-muted-foreground">System Edition</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  Web Management & Decision Dashboard
                </span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-muted-foreground">Build Status</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Synced with v3.1.0
                </span>
              </div>
            </div>
          </div>

          <div className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-900 dark:bg-slate-800 rounded-xl text-white shadow-sm">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">System Architecture</h3>
                <p className="text-xs text-muted-foreground">Web Cloud / PWA Client</p>
              </div>
            </div>

            <div className="space-y-2 pt-1 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Cpu className="w-4 h-4 text-muted-foreground" />
                  Platform
                </span>
                <span className="font-medium">React + Vite PWA</span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <HardDrive className="w-4 h-4 text-muted-foreground" />
                  Cloud Backend
                </span>
                <span className="font-medium">Node / Express API</span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  Desktop POS Sync
                </span>
                <span className="font-medium">Continuous Delta Sync</span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Printer className="w-4 h-4 text-muted-foreground" />
                  Thermal Preview
                </span>
                <span className="font-medium">ESC/POS 80mm Visualizer</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Release Highlights & Archive */}
        <div className="lg:col-span-7 space-y-6">
          {currentRelease && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-blue-500/30 p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 dark:border-blue-900/30 pb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    What's New in v{currentRelease.version}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                    Active Milestone
                  </span>
                </div>
                <span className="text-xs text-muted-foreground font-medium">{currentRelease.date}</span>
              </div>

              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                {currentRelease.title}
              </h4>

              <div className="space-y-3 pt-1">
                {currentRelease.changes.map((change, idx) => (
                  <div key={idx} className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase ${
                          change.type === 'feature'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : change.type === 'improvement'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        }`}
                      >
                        {change.type}
                      </span>
                      <h5 className="font-semibold text-sm text-slate-800 dark:text-slate-100">
                        {change.title}
                      </h5>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed pl-1">
                      {change.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Older Releases Accordion */}
          {olderReleases.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-muted-foreground" />
                  <h4 className="font-bold text-base text-slate-900 dark:text-white">
                    Version History & Release Archive
                  </h4>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={expandAll}
                    className="text-primary hover:underline font-medium"
                  >
                    Expand All
                  </button>
                  <span className="text-muted-foreground">•</span>
                  <button
                    onClick={collapseAll}
                    className="text-muted-foreground hover:underline"
                  >
                    Collapse All
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {olderReleases.map((release) => {
                  const isExpanded = expandedVersions.includes(release.version);
                  return (
                    <div
                      key={release.version}
                      className="rounded-xl border border-slate-200/70 dark:border-slate-800 overflow-hidden transition-all"
                    >
                      <button
                        onClick={() => toggleVersion(release.version)}
                        className="w-full flex items-center justify-between p-4 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100/50 text-left transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                            v{release.version}
                          </span>
                          <span className="text-xs text-muted-foreground font-medium hidden sm:inline">
                            {release.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{release.date}</span>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-4 bg-white dark:bg-slate-900 space-y-3 border-t border-slate-100 dark:border-slate-800">
                          {release.changes.map((change, idx) => (
                            <div key={idx} className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase ${
                                    change.type === 'feature'
                                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30'
                                      : change.type === 'improvement'
                                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30'
                                      : 'bg-amber-50 text-amber-600 dark:bg-amber-900/30'
                                  }`}
                                >
                                  {change.type}
                                </span>
                                <h6 className="font-medium text-xs text-slate-800 dark:text-slate-200">
                                  {change.title}
                                </h6>
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed pl-1">
                                {change.description}
                              </p>
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

