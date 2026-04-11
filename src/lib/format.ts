// Indian currency formatting utility
export function formatIndianCurrency(amount: number): string {
    // Format as Indian numbering system: 12,34,567.89
    const isNegative = amount < 0;
    const absAmount = Math.abs(amount);

    const [integerPart, decimalPart] = absAmount.toFixed(2).split('.');

    // Indian numbering: last 3 digits, then groups of 2
    let formatted = '';
    const len = integerPart.length;

    if (len <= 3) {
        formatted = integerPart;
    } else {
        // Last 3 digits
        formatted = integerPart.slice(len - 3);
        let remaining = integerPart.slice(0, len - 3);

        // Groups of 2 from right to left
        while (remaining.length > 0) {
            if (remaining.length <= 2) {
                formatted = remaining + ',' + formatted;
                remaining = '';
            } else {
                formatted = remaining.slice(remaining.length - 2) + ',' + formatted;
                remaining = remaining.slice(0, remaining.length - 2);
            }
        }
    }

    const result = `₹${formatted}.${decimalPart}`;
    return isNegative ? `-${result}` : result;
}

// Calculate percentage change with contextual messaging for better UX
export function calculatePercentageChange(current: number, previous: number): {
    percentage: number;
    isIncrease: boolean;
    display: string;
    contextualMessage?: string;
    showContextual?: boolean;
} {
    // Tiny baselines produce meaningless swings like "-99%+".
    // Treat them as insufficient comparison data instead.
    const isTinyBaseline = Math.abs(previous) < 1;

    // Handle zero previous value with contextual messaging
    if (previous === 0 || isTinyBaseline) {
        if (current === 0) {
            return {
                percentage: 0,
                isIncrease: false,
                display: 'No sales today',
                contextualMessage: 'No activity',
                showContextual: true
            };
        } else {
            return {
                percentage: 0, // Don't show misleading percentage
                isIncrease: true,
                display: 'Low baseline',
                contextualMessage: 'Comparison unavailable',
                showContextual: true
            };
        }
    }

    // Normal percentage calculation for non-zero previous values
    const change = ((current - previous) / previous) * 100;
    const isIncrease = change >= 0;

    // Extreme swings are not useful in the UI.
    if (change > 999 || change < -99) {
        return {
            percentage: Math.abs(change),
            isIncrease,
            display: current === 0 ? 'No sales today' : 'Low baseline',
            contextualMessage: 'Comparison unavailable',
            showContextual: true
        };
    }

    const display = `${isIncrease ? '+' : ''}${change.toFixed(1)}%`;

    return {
        percentage: Math.abs(change),
        isIncrease,
        display,
        showContextual: false
    };
}
