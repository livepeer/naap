/**
 * PortfolioSummary - 4x glass-card stat tiles
 */

import React from 'react';
import { formatBalance } from '../lib/utils';

interface PortfolioSummaryProps {
  totalStaked: string;
  totalPendingRewards: string;
  totalPendingFees: string;
  addressCount: number;
  isLoading?: boolean;
}

export const PortfolioSummary: React.FC<PortfolioSummaryProps> = ({
  totalStaked,
  totalPendingRewards,
  totalPendingFees,
  addressCount,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="glass-card p-6 animate-pulse">
            <div className="h-4 bg-bg-tertiary rounded w-24 mb-3" />
            <div className="h-8 bg-bg-tertiary rounded w-32" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="glass-card p-6">
        <p className="text-sm text-text-secondary mb-1">Total Staked</p>
        <p className="text-2xl font-bold font-mono text-accent-purple">
          {formatBalance(totalStaked)} <span className="text-sm font-normal text-text-secondary">LPT</span>
        </p>
      </div>

      <div className="glass-card p-6">
        <p className="text-sm text-text-secondary mb-1">Pending Rewards</p>
        <p className="text-2xl font-bold font-mono text-accent-emerald">
          {formatBalance(totalPendingRewards)} <span className="text-sm font-normal text-text-secondary">LPT</span>
        </p>
      </div>

      <div className="glass-card p-6">
        <p className="text-sm text-text-secondary mb-1">Pending Fees</p>
        <p className="text-2xl font-bold font-mono text-accent-blue">
          {formatBalance(totalPendingFees)} <span className="text-sm font-normal text-text-secondary">ETH</span>
        </p>
      </div>

      <div className="glass-card p-6">
        <p className="text-sm text-text-secondary mb-1">Wallets</p>
        <p className="text-2xl font-bold font-mono text-text-primary">
          {addressCount}
        </p>
      </div>
    </div>
  );
};
