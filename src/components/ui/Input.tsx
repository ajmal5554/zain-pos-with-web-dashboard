import React, { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
    label,
    error,
    className = '',
    onFocus,
    ...props
}, ref) => {
    return (
        <div className="w-full">
            {label && <label className="label">{label}</label>}
            <input
                ref={ref}
                className={`input ${error ? 'input-error' : ''} ${className}`}
                onFocus={(e) => {
                    if (props.type === 'number') {
                        e.target.select();
                    }
                    onFocus?.(e);
                }}
                {...props}
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
        </div>
    );
});

Input.displayName = 'Input';
