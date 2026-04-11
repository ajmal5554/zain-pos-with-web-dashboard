export function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(value);
}

/**
 * Formats percentage change for display
 * @param value - The percentage value (positive or negative)
 * @param options - Formatting options
 * @returns Formatted string like "↓99%" or "↑12.5%"
 */
export function formatPercentageChange(
    value: number,
    options: {
        useSymbol?: boolean;  // Use ↑/↓ instead of +/-
        showSign?: boolean;   // Show + for positive values
        maxValue?: number;    // Cap display at this value (e.g., 99)
    } = {}
): string {
    const { useSymbol = true, showSign = false, maxValue = 99 } = options;
    
    const isPositive = value >= 0;
    const absValue = Math.abs(value);
    const isCapped = absValue > maxValue;
    const displayValue = isCapped ? maxValue : absValue;
    
    if (useSymbol) {
        const symbol = isPositive ? '↑' : '↓';
        return `${symbol}${displayValue.toFixed(1)}%${isCapped ? '+' : ''}`;
    }
    
    const sign = isPositive && showSign ? '+' : isPositive ? '' : '-';
    return `${sign}${displayValue.toFixed(1)}%${isCapped ? '+' : ''}`;
}
