import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingProps {
    size?: 'sm' | 'md' | 'lg';
    text?: string;
}

export const Loading: React.FC<LoadingProps> = ({ size = 'md', text }) => {
    const sizeClasses = {
        sm: 'w-4 h-4',
        md: 'w-8 h-8',
        lg: 'w-12 h-12',
    };

    return (
        <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className={`${sizeClasses[size]} animate-spin text-primary-600`} />
            {text && <p className="text-gray-600 dark:text-gray-400">{text}</p>}
        </div>
    );
};
