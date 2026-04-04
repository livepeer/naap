/**
 * WalletSelector - Dropdown to select active wallet + "Add Wallet" button
 */

import React, { useState } from 'react';
import { formatAddress } from '../lib/utils';

interface WalletAddress {
  id: string;
  address: string;
  label: string | null;
  chainId: number;
  isPrimary: boolean;
}

interface WalletSelectorProps {
  addresses: WalletAddress[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onAddWallet: () => void;
}

export const WalletSelector: React.FC<WalletSelectorProps> = ({
  addresses,
  selectedId,
  onSelect,
  onAddWallet,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selected = addresses.find(a => a.id === selectedId) || addresses[0];

  if (addresses.length <= 1) {
    return (
      <div className="flex items-center gap-3">
        {selected && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-text-primary">
              {selected.label || formatAddress(selected.address)}
            </span>
          </div>
        )}
        <button
          onClick={onAddWallet}
          className="text-xs text-accent-purple hover:text-accent-purple/80 font-medium"
        >
          + Add Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary rounded-lg hover:bg-bg-secondary transition-colors"
      >
        <span className="font-mono text-sm text-text-primary">
          {selected?.label || formatAddress(selected?.address || '')}
        </span>
        <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-bg-secondary border border-border-primary rounded-lg shadow-lg z-50">
          {addresses.map(addr => (
            <button
              key={addr.id}
              onClick={() => { onSelect(addr.id); setIsOpen(false); }}
              className={`w-full px-3 py-2 text-left hover:bg-bg-tertiary transition-colors first:rounded-t-lg ${
                addr.id === selected?.id ? 'bg-bg-tertiary' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-text-primary">
                  {formatAddress(addr.address)}
                </span>
                {addr.isPrimary && (
                  <span className="text-xs bg-accent-purple/20 text-accent-purple px-1.5 py-0.5 rounded-full">
                    Primary
                  </span>
                )}
              </div>
              {addr.label && (
                <span className="text-xs text-text-secondary">{addr.label}</span>
              )}
            </button>
          ))}
          <button
            onClick={() => { onAddWallet(); setIsOpen(false); }}
            className="w-full px-3 py-2 text-left text-accent-purple hover:bg-bg-tertiary transition-colors border-t border-border-primary rounded-b-lg text-sm font-medium"
          >
            + Add Wallet
          </button>
        </div>
      )}
    </div>
  );
};
