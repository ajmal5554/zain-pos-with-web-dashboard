const SHOP_OFFSET_MS = 330 * 60 * 1000;

/** datetime-local represents the shop's India time, independently of the computer timezone. */
export function toShopDateTimeLocal(timestamp?: string | null): string {
    if (!timestamp) return '';
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time)) return '';
    return new Date(time + SHOP_OFFSET_MS).toISOString().slice(0, 16);
}

export function fromShopDateTimeLocal(value: string, originalTimestamp?: string | null): string | null {
    if (!value) return null;
    // A minute-resolution control must not discard an existing observation's seconds/milliseconds.
    if (originalTimestamp && toShopDateTimeLocal(originalTimestamp) === value) return originalTimestamp;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid observed date and time.');
    const wallTime = new Date(`${value}:00.000Z`);
    if (!Number.isFinite(wallTime.getTime()) || wallTime.toISOString().slice(0, 16) !== value) {
        throw new Error('Enter a valid observed date and time.');
    }
    return new Date(wallTime.getTime() - SHOP_OFFSET_MS).toISOString();
}
