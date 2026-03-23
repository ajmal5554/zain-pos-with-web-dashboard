import React, { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
    label,
    error,
    className = '',
    ...props
}, ref) => {
    return (
        <div className="w-full">
            {label && <label className="label">{label}</label>}
            <input
                ref={ref}
                className={`input ${error ? 'input-error' : ''} ${className}`}
                {...props}
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
        </div>
    );
});

Input.displayName = 'Input';
