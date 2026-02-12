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
        <label className="block text-sm font-medium text-gray-300">{label}</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 text-sm">
            ••••••••••••••••
          </div>
          <span className="text-xs text-green-400 font-medium">Saved</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Update
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-300">{label}</label>
      <input
        type="password"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
};
