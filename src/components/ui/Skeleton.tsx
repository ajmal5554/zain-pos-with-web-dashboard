import React from 'react';

interface SkeletonProps {
    className?: string;
    style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', style }) => {
    return (
        <div style={style} className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className}`} />
    );
};
