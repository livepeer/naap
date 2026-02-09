/**
 * StakeCard - Display staking position summary
 */

import React from 'react';
import { TrendingUp, Gift, ArrowUpRight, Info } from 'lucide-react';
import { formatBalance, formatAddress } from '../lib/utils';

interface StakeCardProps {
  stakedAmount: bigint;
  delegatedTo: string | null;
  pendingRewards: bigint;
  pendingFees: bigint;
  currentRound: bigint;
  onManage?: () => void;
  onClaim?: () => void;
  isLoading?: boolean;
}

export const StakeCard: React.FC<StakeCardProps> = ({
  stakedAmount,
  delegatedTo,
  pendingRewards,
  pendingFees,
  currentRound,
  onManage,
  onClaim,
  isLoading = false,
}) => {
  const hasStake = stakedAmount > 0n;
  const hasRewards = pendingRewards > 0n || pendingFees > 0n;

  if (!hasStake) {
    return (
      <div className="glass-card p-6">
        <div className="text-center py-4">
          <TrendingUp className="w-12 h-12 text-text-secondary mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">Start Staking</h3>
          <p className="text-text-secondary text-sm mb-4">
            Stake your LPT to an orchestrator to earn rewards
          </p>
          {onManage && (
            <button
              onClick={onManage}
              className="px-6 py-2 wallet-gradient text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Stake Now
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 border-accent-purple/30">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-accent-purple" />
          Staking Position
        </h3>
        <span className="text-xs bg-accent-purple/20 text-accent-purple px-2 py-1 rounded-full">
          Round {currentRound.toString()}
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Staked Amount */}
        <div className="p-3 bg-bg-tertiary rounded-lg">
          <p className="text-xs text-text-secondary mb-1">Staked</p>
          <p className="text-xl font-bold text-text-primary">
            {formatBalance(stakedAmount)}
          </p>
          <p className="text-xs text-text-secondary">LPT</p>
        </div>

        {/* Delegated To */}
        <div className="p-3 bg-bg-tertiary rounded-lg">
          <p className="text-xs text-text-secondary mb-1">Delegated To</p>
          {delegatedTo ? (
            <p className="font-mono text-sm text-text-primary truncate">
              {formatAddress(delegatedTo, 6)}
            </p>
          ) : (
            <p className="text-sm text-text-secondary">Not delegated</p>
          )}
        </div>

        {/* Pending Rewards */}
        <div className="p-3 bg-accent-emerald/10 rounded-lg">
          <p className="text-xs text-accent-emerald mb-1">Rewards</p>
          <p className="text-xl font-bold text-accent-emerald">
            {formatBalance(pendingRewards)}
          </p>
          <p className="text-xs text-accent-emerald">LPT</p>
        </div>

        {/* Pending Fees */}
        <div className="p-3 bg-accent-blue/10 rounded-lg">
          <p className="text-xs text-accent-blue mb-1">Fees</p>
          <p className="text-xl font-bold text-accent-blue">
            {formatBalance(pendingFees)}
          </p>
          <p className="text-xs text-accent-blue">ETH</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {onManage && (
          <button
            onClick={onManage}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-bg-tertiary text-text-primary rounded-lg font-medium hover:bg-bg-secondary transition-colors disabled:opacity-50"
          >
            <ArrowUpRight className="w-4 h-4" />
            Manage
          </button>
        )}
        {onClaim && hasRewards && (
          <button
            onClick={onClaim}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-accent-emerald text-white rounded-lg font-medium hover:bg-accent-emerald/90 transition-colors disabled:opacity-50"
          >
            <Gift className="w-4 h-4" />
            Claim
          </button>
        )}
      </div>

      {/* Info Tip */}
      <div className="mt-4 flex items-start gap-2 text-xs text-text-secondary">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>Rewards accrue each round. Claim them to add to your stake or withdraw.</p>
      </div>
    </div>
  );
};

export default StakeCard;
