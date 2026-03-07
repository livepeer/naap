/**
 * UnbondingPanel - Collapsible panel listing unbonding locks with countdowns
 */

import React, { useState } from 'react';
import { formatBalance, formatAddress } from '../lib/utils';
import { UnbondingCountdown } from './UnbondingCountdown';

interface UnbondingLock {
  id: string;
  lockId: number;
  amount: string;
  withdrawRound: number;
  status: string;
  walletAddress: {
    address: string;
    label: string | null;
  };
}

interface UnbondingPanelProps {
  locks: UnbondingLock[];
  currentRound: number;
  roundLength?: number;
  isLoading?: boolean;
  onWithdraw?: (lockId: number) => void;
  onRebond?: (lockId: number) => void;
}

export const UnbondingPanel: React.FC<UnbondingPanelProps> = ({
  locks,
  currentRound,
  roundLength = 5760,
  isLoading,
  onWithdraw,
  onRebond,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (isLoading) {
    return (
      <div className="glass-card p-6 animate-pulse">
        <div className="h-6 bg-bg-tertiary rounded w-48" />
      </div>
    );
  }

  if (locks.length === 0) return null;

  const pendingCount = locks.filter(l => l.status === 'pending').length;
  const readyCount = locks.filter(l => l.status === 'withdrawable').length;

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-bg-tertiary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-text-primary">Unbonding Locks</h3>
          {pendingCount > 0 && (
            <span className="text-xs bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full">
              {pendingCount} pending
            </span>
          )}
          {readyCount > 0 && (
            <span className="text-xs bg-accent-emerald/20 text-accent-emerald px-2 py-0.5 rounded-full">
              {readyCount} ready
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-text-secondary transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-border-primary divide-y divide-border-primary/50">
          {locks.map(lock => (
            <div key={lock.id} className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-text-primary">
                    {formatBalance(lock.amount)} LPT
                  </span>
                  <span className="text-xs text-text-secondary">
                    from {lock.walletAddress.label || formatAddress(lock.walletAddress.address)}
                  </span>
                </div>
                <UnbondingCountdown
                  currentRound={currentRound}
                  withdrawRound={lock.withdrawRound}
                  roundLength={roundLength}
                  compact
                />
              </div>
              <div className="flex items-center gap-2">
                {lock.status === 'withdrawable' ? (
                  <button
                    onClick={() => onWithdraw?.(lock.lockId)}
                    className="px-3 py-1 text-sm bg-accent-emerald text-white rounded-lg hover:bg-accent-emerald/90 transition-colors"
                  >
                    Withdraw
                  </button>
                ) : lock.status === 'pending' ? (
                  <button
                    onClick={() => onRebond?.(lock.lockId)}
                    className="px-3 py-1 text-sm bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-secondary transition-colors"
                  >
                    Rebond
                  </button>
                ) : (
                  <span className="text-xs text-text-secondary capitalize">{lock.status}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
