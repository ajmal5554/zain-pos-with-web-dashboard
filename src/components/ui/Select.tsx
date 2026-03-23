import React from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
    options: Array<{ value: string | number; label: string }>;
}

export const Select: React.FC<SelectProps> = ({
    label,
    error,
    options,
    className = '',
    ...props
}) => {
    return (
        <div className="w-full">
            {label && <label className="label">{label}</label>}
            <select
                className={`input ${error ? 'input-error' : ''} ${className}`}
                {...props}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
        </div>
    );
};
