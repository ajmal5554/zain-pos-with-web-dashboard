import { createContext, useContext, useState, type ReactNode } from 'react';
import { startOfDay, endOfDay, subDays, addDays, startOfWeek, startOfMonth, subMonths, addMonths, startOfYear, subYears, addYears, format, isSameDay } from 'date-fns';

export type DateRangeLabel = 'Today' | 'Week' | 'Month' | 'Year' | 'All Time' | 'Custom';

export interface DateRange {
    startDate: Date | null;
    endDate: Date | null;
    label: DateRangeLabel;
}

export function formatActiveRange(dateRange: DateRange): string {
    const { startDate, endDate, label } = dateRange;
    if (!startDate || !endDate) return 'All Time';

    switch (label) {
        case 'Today':
            if (isSameDay(startDate, new Date())) {
                return 'Today';
            }
            return format(startDate, 'dd-MM-yyyy');
        case 'Week':
            return `${format(startDate, 'dd MMM yyyy')} - ${format(endDate, 'dd MMM yyyy')}`;
        case 'Month':
            return format(startDate, 'MMMM yyyy');
        case 'Year':
            return format(startDate, 'yyyy');
        default:
            return `${format(startDate, 'dd-MM-yyyy')} - ${format(endDate, 'dd-MM-yyyy')}`;
    }
}

interface DateFilterContextType {
    dateRange: DateRange;
    setDateRange: (range: DateRange) => void;
    setPreset: (label: DateRangeLabel) => void;
    navigatePrev: () => void;
    navigateNext: () => void;
    navigateCurrent: () => void;
}

const DateFilterContext = createContext<DateFilterContextType | undefined>(undefined);

export function DateFilterProvider({ children }: { children: ReactNode }) {
    const [dateRange, setDateRangeState] = useState<DateRange>({
        startDate: startOfDay(new Date()),
        endDate: endOfDay(new Date()),
        label: 'Today'
    });

    const setDateRange = (range: DateRange) => {
        setDateRangeState(range);
    };

    const setPreset = (label: DateRangeLabel) => {
        const today = new Date();
        let start: Date | null = null;
        let end: Date | null = endOfDay(today);

        switch (label) {
            case 'Today':
                start = startOfDay(today);
                break;
            case 'Week':
                start = startOfWeek(today, { weekStartsOn: 1 }); // Monday start
                break;
            case 'Month':
                start = startOfMonth(today);
                break;
            case 'Year':
                start = startOfYear(today);
                break;
            case 'All Time':
                start = null;
                end = null;
                break;
            default:
                break;
        }

        setDateRangeState({ startDate: start, endDate: end, label });
    };

    const navigatePrev = () => {
        const { startDate, endDate, label } = dateRange;
        if (!startDate || !endDate) return;

        let start = startDate;
        let end = endDate;

        switch (label) {
            case 'Today':
                start = startOfDay(subDays(startDate, 1));
                end = endOfDay(subDays(endDate, 1));
                break;
            case 'Week':
                start = startOfWeek(subDays(startDate, 7), { weekStartsOn: 1 });
                end = endOfDay(addDays(start, 6));
                break;
            case 'Month':
                start = startOfMonth(subMonths(startDate, 1));
                end = endOfDay(subDays(addMonths(start, 1), 1));
                break;
            case 'Year':
                start = startOfYear(subYears(startDate, 1));
                end = endOfDay(subDays(addYears(start, 1), 1));
                break;
            default:
                break;
        }

        setDateRangeState({ startDate: start, endDate: end, label });
    };

    const navigateNext = () => {
        const { startDate, endDate, label } = dateRange;
        if (!startDate || !endDate) return;

        let start = startDate;
        let end = endDate;

        switch (label) {
            case 'Today':
                start = startOfDay(addDays(startDate, 1));
                end = endOfDay(addDays(endDate, 1));
                break;
            case 'Week':
                start = startOfWeek(addDays(startDate, 7), { weekStartsOn: 1 });
                end = endOfDay(addDays(start, 6));
                break;
            case 'Month':
                start = startOfMonth(addMonths(startDate, 1));
                end = endOfDay(subDays(addMonths(start, 1), 1));
                break;
            case 'Year':
                start = startOfYear(addYears(startDate, 1));
                end = endOfDay(subDays(addYears(start, 1), 1));
                break;
            default:
                break;
        }

        setDateRangeState({ startDate: start, endDate: end, label });
    };

    const navigateCurrent = () => {
        setPreset(dateRange.label);
    };

    return (
        <DateFilterContext.Provider value={{ dateRange, setDateRange, setPreset, navigatePrev, navigateNext, navigateCurrent }}>
            {children}
        </DateFilterContext.Provider>
    );
}

export function useDateFilter() {
    const context = useContext(DateFilterContext);
    if (context === undefined) {
        throw new Error('useDateFilter must be used within a DateFilterProvider');
    }
    return context;
}
