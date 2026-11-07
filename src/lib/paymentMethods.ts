export interface PaymentMethodsConfig {
    [key: string]: boolean;
    CASH: boolean;
    UPI: boolean;
    CARD: boolean;
    SPLIT: boolean;
}

const STORAGE_KEY = 'zain_payment_methods';

export const DEFAULT_PAYMENT_METHODS: PaymentMethodsConfig = {
    CASH: true,
    UPI: true,
    CARD: true,
    SPLIT: true,
};

export const getStoredPaymentMethods = (): PaymentMethodsConfig => {
    try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (raw) {
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'object' && parsed !== null) {
                return {
                    CASH: parsed.CASH !== false,
                    UPI: parsed.UPI !== false,
                    CARD: parsed.CARD !== false,
                    SPLIT: parsed.SPLIT !== false,
                };
            }
        }
    } catch {
        // ignore parsing errors
    }
    return { ...DEFAULT_PAYMENT_METHODS };
};

export const saveStoredPaymentMethods = (methods: Partial<PaymentMethodsConfig>): PaymentMethodsConfig => {
    const current = getStoredPaymentMethods();
    const updated: PaymentMethodsConfig = {
        CASH: methods.CASH !== undefined ? methods.CASH : current.CASH,
        UPI: methods.UPI !== undefined ? methods.UPI : current.UPI,
        CARD: methods.CARD !== undefined ? methods.CARD : current.CARD,
        SPLIT: methods.SPLIT !== undefined ? methods.SPLIT : current.SPLIT,
    };
    try {
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        }
    } catch {
        // ignore storage errors
    }
    return updated;
};
