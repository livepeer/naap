/**
 * FilterBar Component
 * 
 * A horizontal bar of filter pills/buttons.
 */

// FilterBar component uses JSX without explicit React import (React 17+ automatic runtime)

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

export interface FilterBarProps<T extends string = string> {
  /** Available filter options */
  options: FilterOption<T>[];
  /** Currently selected value */
  value: T;
  /** Called when selection changes */
  onChange: (value: T) => void;
  /** Additional className */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

export function FilterBar<T extends string = string>({
  options,
  value,
  onChange,
  className = '',
  size = 'md',
}: FilterBarProps<T>) {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };

  return (
    <div className={`flex items-center gap-1 bg-bg-secondary border border-white/10 rounded-xl p-1 ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`
            ${sizeClasses[size]}
            rounded-lg font-medium transition-all
            ${value === option.value
              ? 'bg-accent-blue text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
            }
          `}
        >
          {option.label}
          {option.count !== undefined && (
            <span className={`ml-1.5 ${value === option.value ? 'text-white/70' : 'text-text-secondary'}`}>
              ({option.count})
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
