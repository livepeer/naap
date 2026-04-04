/**
 * WalletBadge - Truncated address with label and chain icon
 */

import React from 'react';
import { formatAddress } from '../lib/utils';

interface WalletBadgeProps {
  address: string;
  label?: string | null;
  chainId?: number;
  isPrimary?: boolean;
  className?: string;
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'ETH',
  42161: 'ARB',
  5: 'GOR',
  421613: 'ARBG',
};

export const WalletBadge: React.FC<WalletBadgeProps> = ({
  address,
  label,
  chainId = 42161,
  isPrimary,
  className = '',
}) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-xs bg-bg-tertiary text-text-secondary px-1.5 py-0.5 rounded">
        {CHAIN_NAMES[chainId] || 'ETH'}
      </span>
      <span className="font-mono text-sm text-text-primary">
        {formatAddress(address)}
      </span>
      {label && (
        <span className="text-xs text-text-secondary">{label}</span>
      )}
      {isPrimary && (
        <span className="text-xs bg-accent-purple/20 text-accent-purple px-2 py-0.5 rounded-full">
          Primary
        </span>
      )}
    </div>
  );
};
