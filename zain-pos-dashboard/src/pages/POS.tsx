import { Store } from 'lucide-react';
import { FeatureMirrorPage } from '@/components/shared/FeatureMirrorPage';

export default function POSPage() {
    return (
        <FeatureMirrorPage
            title="POS Terminal"
            description="Live checkout, cart flow, bill creation, discounts, and cashier operations mirrored from the desktop POS."
            icon={Store}
            modules={['Cart and checkout', 'Bill generation', 'Discounts and tax', 'Cashier controls', 'Shift workflow', 'Sale completion and voids']}
        />
    );
}
