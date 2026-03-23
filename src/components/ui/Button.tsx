import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'outline' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
    variant = 'primary',
    size = 'md',
    children,
    className = '',
    ...props
}) => {
    const variantClasses = {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
        success: 'btn-success',
        danger: 'btn-danger',
        outline: 'btn-outline',
        ghost: 'btn-ghost',
    };

    const sizeClasses = {
        sm: 'btn-sm',
        md: '',
        lg: 'btn-lg',
    };

    return (
        <button
            className={`${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
            {...props}
        >
            {children}
        </button>
    );
};
