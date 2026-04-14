'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Classes for the `<input>` (must leave room for the button — `pr-10` is applied automatically). */
  inputClassName?: string;
};

/**
 * Password field with show/hide toggle (eye icon).
 */
export function PasswordInput({ inputClassName, className, id, autoComplete, ...props }: PasswordInputProps) {
  const [show, setShow] = useState(false);
  const inputClasses = ['pr-10', inputClassName].filter(Boolean).join(' ');

  return (
    <div className={['relative', className].filter(Boolean).join(' ')}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        className={inputClasses}
        autoComplete={autoComplete ?? 'current-password'}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground/30"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
      >
        {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
