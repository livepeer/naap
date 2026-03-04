import React from 'react';

// ============================================
// Input
// ============================================

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ error, icon, className = '', ...props }, ref) => {
    return (
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          className={`flex h-9 w-full rounded-lg border bg-background px-3 py-1 text-sm transition-colors duration-fast file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
            icon ? 'pl-9' : ''
          } ${
            error
              ? 'border-destructive focus-visible:ring-destructive'
              : 'border-input hover:border-muted-foreground/30'
          } ${className}`}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = 'Input';

// ============================================
// Textarea
// ============================================

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className = '', ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`flex min-h-[80px] w-full rounded-lg border bg-background px-3 py-2 text-sm transition-colors duration-fast placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
          error
            ? 'border-destructive focus-visible:ring-destructive'
            : 'border-input hover:border-muted-foreground/30'
        } ${className}`}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';

// ============================================
// Select
// ============================================

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, className = '', children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`flex h-9 w-full appearance-none rounded-lg border bg-background px-3 py-1 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
          error
            ? 'border-destructive focus-visible:ring-destructive'
            : 'border-input hover:border-muted-foreground/30'
        } ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';

// ============================================
// Label
// ============================================

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ required, className = '', children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${className}`}
        {...props}
      >
        {children}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
    );
  }
);

Label.displayName = 'Label';
