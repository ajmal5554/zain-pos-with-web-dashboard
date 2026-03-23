import { UserRoundSearch } from 'lucide-react';
import { FeatureMirrorPage } from '@/components/shared/FeatureMirrorPage';

export default function CustomersPage() {
    return (
        <FeatureMirrorPage
            title="Customers"
            description="Customer profiles, history, contact records, and segmentation from the desktop POS."
            icon={UserRoundSearch}
            modules={['Customer list', 'Profile details', 'Purchase history', 'Phone lookup', 'Customer notes', 'Retention actions']}
        />
    );
}
