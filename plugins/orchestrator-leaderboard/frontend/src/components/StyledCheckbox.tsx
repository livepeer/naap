import React from 'react';
import { Check } from 'lucide-react';

interface StyledCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  'aria-label'?: string;
}

/**
 * Custom checkbox — native input is visually hidden so browser white/blue
 * focus paint never appears; checked state uses theme emerald.
 */
export const StyledCheckbox: React.FC<StyledCheckboxProps> = ({
  checked,
  disabled = false,
  onChange,
  'aria-label': ariaLabel,
}) => (
  <span className="relative inline-flex items-center justify-center shrink-0 w-3.5 h-3.5">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded border border-zinc-600 bg-zinc-800 transition-colors peer-checked:bg-[var(--accent-emerald)] peer-checked:border-[var(--accent-emerald)] peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent-emerald)] peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--bg-secondary)]"
    />
    <Check
      size={9}
      aria-hidden
      className="relative z-[1] text-white opacity-0 transition-opacity peer-checked:opacity-100 pointer-events-none"
    />
  </span>
);
