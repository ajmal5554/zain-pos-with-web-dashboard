import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const roundCurrency = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

interface CartItem {
    variantId: string;
    productName: string;
    variantInfo: string;
    barcode: string;
    quantity: number;
    mrp: number;
    sellingPrice: number;
    discount: number;
    taxRate: number;
}

interface CartState {
    items: CartItem[];
    customerId: string | null;
    customerName: string | null;
    discount: number;
    discountPercent: number;
    paymentMethod: 'CASH' | 'CARD' | 'UPI' | 'SPLIT';

    addItem: (item: CartItem) => void;
    removeItem: (variantId: string) => void;
    updateQuantity: (variantId: string, quantity: number) => void;
    updateDiscount: (variantId: string, discount: number) => void;
    setCustomer: (customerId: string | null, customerName: string | null) => void;
    setGlobalDiscount: (discount: number, isPercent: boolean) => void;
    setPaymentMethod: (method: 'CASH' | 'CARD' | 'UPI' | 'SPLIT') => void;
    clearCart: () => void;

    getSubtotal: () => number;
    getTaxAmount: () => number;
    getGrandTotal: () => number;
}

export const useCartStore = create<CartState>()(
    persist(
        (set, get) => ({
            items: [],
            customerId: null,
            customerName: null,
            discount: 0,
            discountPercent: 0,
            paymentMethod: 'CASH',

            addItem: (item) => set((state) => {
                const existingIndex = state.items.findIndex(i => i.variantId === item.variantId);
                if (existingIndex >= 0) {
                    const newItems = [...state.items];
                    newItems[existingIndex].quantity += item.quantity;
                    return { items: newItems };
                }
                return { items: [...state.items, item] };
            }),

            removeItem: (variantId) => set((state) => ({
                items: state.items.filter(i => i.variantId !== variantId)
            })),

            updateQuantity: (variantId, quantity) => set((state) => {
                // Validate quantity: must be positive integer, max 9999
                const validQty = Math.max(1, Math.min(9999, Math.floor(Math.abs(quantity))));
                
                return {
                    items: state.items.map(i =>
                        i.variantId === variantId ? { ...i, quantity: validQty } : i
                    )
                };
            }),

            updateDiscount: (variantId, discount) => set((state) => ({
                items: state.items.map(i =>
                    i.variantId === variantId ? { ...i, discount } : i
                )
            })),

            setCustomer: (customerId, customerName) => set({ customerId, customerName }),

            setGlobalDiscount: (discount, isPercent) => set(
                isPercent
                    ? { discountPercent: discount, discount: 0 }
                    : { discount, discountPercent: 0 }
            ),

            setPaymentMethod: (method) => set({ paymentMethod: method }),

            clearCart: () => set({
                items: [],
                customerId: null,
                customerName: null,
                discount: 0,
                discountPercent: 0,
                paymentMethod: 'CASH',
            }),

            getSubtotal: () => {
                const items = get().items;
                const subtotal = items.reduce((sum, item) => {
                    const itemTotal = (item.sellingPrice * item.quantity) - item.discount;
                    return sum + itemTotal;
                }, 0);
                return roundCurrency(subtotal);
            },

            getTaxAmount: () => {
                const items = get().items;
                const taxAmount = items.reduce((sum, item) => {
                    const itemTotal = (item.sellingPrice * item.quantity) - item.discount;
                    const taxAmount = (itemTotal * item.taxRate) / (100 + item.taxRate);
                    return sum + taxAmount;
                }, 0);
                return roundCurrency(taxAmount);
            },

            getGrandTotal: () => {
                const subtotal = get().getSubtotal();
                const { discount, discountPercent } = get();
                const globalDiscount = discountPercent > 0
                    ? (subtotal * discountPercent) / 100
                    : discount;
                return roundCurrency(subtotal - globalDiscount);
            },
        }),
        {
            name: 'pos-cart-storage',
            partialize: (state) => ({
                items: state.items,
                customerId: state.customerId,
                customerName: state.customerName,
                discount: state.discount,
                discountPercent: state.discountPercent,
                paymentMethod: state.paymentMethod,
            }),
        }
    )
);
