/**
 * SecretField — Masked input for sensitive values.
 * Shows "Saved" indicator if secret exists, never displays actual value.
 */

import React, { useState } from 'react';

interface SecretFieldProps {
  label: string;
  name: string;
  saved?: boolean;
  onChange: (name: string, value: string) => void;
  placeholder?: string;
}

export const SecretField: React.FC<SecretFieldProps> = ({
  label,
  name,
  saved = false,
  onChange,
  placeholder = '••••••••',
}) => {
  const [editing, setEditing] = useState(!saved);
  const [value, setValue] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    onChange(name, e.target.value);
  };

  if (saved && !editing) {
    return (
      <div className="space-y-1">
        <label className="block text-sm font-medium text-text-secondary">{label}</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-2 bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-tertiary text-sm">
            ••••••••••••••••
          </div>
          <span className="text-xs text-green-400 font-medium">Saved</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-accent-emerald hover:text-accent-emerald/80"
          >
            Update
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-text-secondary">{label}</label>
      <input
        type="password"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary text-sm focus:ring-2 focus:ring-accent-emerald focus:border-accent-emerald"
      />
    </div>
  );
};
