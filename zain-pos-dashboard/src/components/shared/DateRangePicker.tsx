import { useState } from 'react';
import { useDateFilter, type DateRangeLabel, formatActiveRange } from '@/contexts/DateFilterContext';
import { Calendar, ChevronDown, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function DateRangePicker() {
    const { dateRange, setPreset, setDateRange, navigatePrev, navigateNext } = useDateFilter();
    const [isOpen, setIsOpen] = useState(false);
    const [showCustom, setShowCustom] = useState(false); // To toggle custom date inputs

    // Temporary state for custom date inputs
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    const presets: DateRangeLabel[] = [
        'Today', 'Week', 'Month', 'Year', 'All Time'
    ];

    const handlePresetSelect = (label: DateRangeLabel) => {
        setPreset(label);
        setIsOpen(false);
        setShowCustom(false);
    };

    const handleCustomApply = () => {
        if (customStart && customEnd) {
            setDateRange({
                startDate: new Date(customStart),
                endDate: new Date(customEnd),
                label: 'Custom'
            });
            setIsOpen(false);
            setShowCustom(false);
        }
    };

    return (
        <div className="flex items-center gap-1">
            {/* Prev Period Button */}
            {dateRange.label !== 'All Time' && (
                <button
                    onClick={navigatePrev}
                    title={`Previous ${dateRange.label}`}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 shrink-0"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>
            )}

            {/* Date Picker Trigger & Popover */}
            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 select-none"
                >
                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate max-w-[100px] sm:max-w-none">
                        {formatActiveRange(dateRange)}
                    </span>
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform text-slate-400 shrink-0", isOpen && "rotate-180")} />
                </button>

                {/* Dropdown Menu */}
                {isOpen && (
                    <>
                        <div className="absolute left-0 sm:right-0 sm:left-auto z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.45)] animate-in fade-in zoom-in-95 duration-100 dark:border-slate-700 dark:bg-slate-900">
                            <div className="space-y-1">
                                {presets.map((preset) => (
                                    <button
                                        key={preset}
                                        onClick={() => handlePresetSelect(preset)}
                                        className={cn(
                                            "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between",
                                            dateRange.label === preset
                                                ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-slate-100 font-medium"
                                                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                        )}
                                    >
                                        {preset}
                                        {dateRange.label === preset && <Check className="w-4 h-4" />}
                                    </button>
                                ))}

                                <div className="my-1 border-t border-slate-100 pt-1 dark:border-slate-700">
                                    <button
                                        onClick={() => setShowCustom(!showCustom)}
                                        className={cn(
                                            "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between",
                                            dateRange.label === 'Custom'
                                                ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-slate-100 font-medium"
                                                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                        )}
                                    >
                                        Custom Range
                                        {dateRange.label === 'Custom' && <Check className="w-4 h-4" />}
                                    </button>
                                </div>

                                {/* Custom Date Inputs */}
                                {(showCustom || dateRange.label === 'Custom') && (
                                    <div className="space-y-2 rounded-xl bg-slate-50 p-2 text-sm dark:bg-slate-950/50">
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500">Start Date</label>
                                            <input
                                                type="date"
                                                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                                                value={customStart}
                                                onChange={(e) => setCustomStart(e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500">End Date</label>
                                            <input
                                                type="date"
                                                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                                                value={customEnd}
                                                onChange={(e) => setCustomEnd(e.target.value)}
                                            />
                                        </div>
                                        <button
                                            onClick={handleCustomApply}
                                            className="w-full rounded-lg bg-slate-950 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                                        >
                                            Apply
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Backdrop to close */}
                        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    </>
                )}
            </div>

            {/* Next Period Button */}
            {dateRange.label !== 'All Time' && (
                <button
                    onClick={navigateNext}
                    title={`Next ${dateRange.label}`}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 shrink-0"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            )}
        </div>
    );
}
