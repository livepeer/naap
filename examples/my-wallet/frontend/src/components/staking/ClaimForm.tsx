/**
 * ClaimForm - Claim pending earnings (rewards + fees)
 */

import React, { useState } from 'react';
import { useStakingOps } from '../../hooks/useStakingOps';
import { TxConfirmationDialog } from './TxConfirmationDialog';
import { formatBalance } from '../../lib/utils';

export const ClaimForm: React.FC = () => {
  const { pendingRewards, pendingFees, currentRound, claimRewards } = useStakingOps();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasEarnings = pendingRewards > 0n || pendingFees > 0n;

  const handleSubmit = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await claimRewards();
      setShowConfirm(false);
    } catch (err: any) {
      setError(err?.message || 'Transaction failed');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-accent-emerald/10 rounded-lg">
          <p className="text-xs text-text-secondary mb-1">Pending Rewards</p>
          <p className="font-mono text-lg text-accent-emerald">{formatBalance(pendingRewards)} LPT</p>
        </div>
        <div className="p-3 bg-accent-blue/10 rounded-lg">
          <p className="text-xs text-text-secondary mb-1">Pending Fees</p>
          <p className="font-mono text-lg text-accent-blue">{formatBalance(pendingFees)} ETH</p>
        </div>
      </div>

      <div className="p-3 bg-bg-tertiary rounded-lg">
        <p className="text-xs text-text-secondary">
          Claims all earnings through round {currentRound.toString()}.
          Rewards are automatically restaked.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={() => setShowConfirm(true)}
        disabled={!hasEarnings || isProcessing}
        className="w-full py-2.5 bg-accent-emerald text-white rounded-lg font-medium hover:bg-accent-emerald/90 disabled:opacity-50"
      >
        Claim Earnings
      </button>

      <TxConfirmationDialog
        isOpen={showConfirm}
        title="Confirm Claim"
        description="Claim all pending rewards and fees through the current round."
        details={[
          { label: 'Rewards', value: `${formatBalance(pendingRewards)} LPT` },
          { label: 'Fees', value: `${formatBalance(pendingFees)} ETH` },
          { label: 'Through Round', value: currentRound.toString() },
        ]}
        confirmLabel="Claim"
        isProcessing={isProcessing}
        onConfirm={handleSubmit}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
