/**
 * SearchInput Component
 * 
 * A debounced search input with clear button and icon.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';

export interface SearchInputProps {
  /** Current value */
  value?: string;
  /** Called when value changes (debounced) */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Debounce delay in ms */
  debounceMs?: number;
  /** Additional className */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Auto focus on mount */
  autoFocus?: boolean;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value: controlledValue,
  onChange,
  placeholder = 'Search...',
  debounceMs = 300,
  className = '',
  disabled = false,
  autoFocus = false,
}) => {
  const [internalValue, setInternalValue] = useState(controlledValue || '');

  // Sync with controlled value
  useEffect(() => {
    if (controlledValue !== undefined) {
      setInternalValue(controlledValue);
    }
  }, [controlledValue]);

  // Debounced onChange
  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(internalValue);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [internalValue, debounceMs, onChange]);

  const handleClear = useCallback(() => {
    setInternalValue('');
    onChange('');
  }, [onChange]);

  return (
    <div className={`relative ${className}`}>
      <Search 
        className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" 
        size={18} 
      />
      <input
        type="text"
        value={internalValue}
        onChange={(e) => setInternalValue(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className={`
          w-full bg-bg-secondary border border-white/10 rounded-xl 
          py-3 pl-10 pr-10 text-sm text-text-primary
          placeholder:text-text-secondary
          focus:outline-none focus:border-accent-blue 
          transition-all
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      />
      {internalValue && !disabled && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
