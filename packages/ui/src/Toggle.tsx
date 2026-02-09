/**
 * Toggle Component
 * 
 * A switch/toggle component for boolean states.
 */

import React from 'react';

export interface ToggleProps {
  /** Whether the toggle is on */
  checked: boolean;
  /** Called when toggle state changes */
  onChange: (checked: boolean) => void;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Disabled state */
  disabled?: boolean;
  /** Label text */
  label?: string;
  /** Description text */
  description?: string;
  /** Additional className */
  className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  size = 'md',
  disabled = false,
  label,
  description,
  className = '',
}) => {
  const sizes = {
    sm: { track: 'w-8 h-4', thumb: 'w-3 h-3', translate: 'translate-x-4' },
    md: { track: 'w-12 h-6', thumb: 'w-5 h-5', translate: 'translate-x-6' },
    lg: { track: 'w-14 h-7', thumb: 'w-6 h-6', translate: 'translate-x-7' },
  };

  const { track, thumb, translate } = sizes[size];

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`
        ${track} rounded-full transition-colors relative
        ${checked ? 'bg-accent-emerald' : 'bg-bg-tertiary'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span
        className={`
          ${thumb} bg-white rounded-full absolute top-0.5 left-0.5
          transition-transform
          ${checked ? translate : 'translate-x-0'}
        `}
      />
    </button>
  );

  if (!label && !description) {
    return toggle;
  }

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="flex-1 mr-4">
        {label && (
          <p className="font-medium text-text-primary">{label}</p>
        )}
        {description && (
          <p className="text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {toggle}
    </div>
  );
};
