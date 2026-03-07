/**
 * UnbondForm - Unstake LPT with unbonding period warning
 */

import React, { useState } from 'react';
import { useStakingOps } from '../../hooks/useStakingOps';
import { useProtocolParams } from '../../hooks/useProtocolParams';
import { TxConfirmationDialog } from './TxConfirmationDialog';
import { formatBalance } from '../../lib/utils';

export const UnbondForm: React.FC = () => {
  const { stakedAmount, unstake } = useStakingOps();
  const { params } = useProtocolParams();
  const [amount, setAmount] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await unstake(amount);
      setAmount('');
      setShowConfirm(false);
    } catch (err: any) {
      setError(err?.message || 'Transaction failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const unbondingDays = params ? Math.round(params.unbondingPeriod * params.roundLength * 0.25 / 86400) : 7;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <p className="text-sm text-amber-500">
          Unbonding takes ~{unbondingDays} days ({params?.unbondingPeriod || 7} rounds).
          You cannot access your LPT during this period.
        </p>
      </div>

      <div>
        <div className="flex justify-between">
          <label className="text-sm text-text-secondary">Amount to Unstake (LPT)</label>
          <span className="text-xs text-text-secondary">
            Staked: {formatBalance(stakedAmount)} LPT
          </span>
        </div>
        <input
          type="text"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.0"
          className="w-full mt-1 px-3 py-2 bg-bg-tertiary text-text-primary font-mono rounded-lg border border-border-primary focus:border-accent-purple outline-none"
        />
        <button
          onClick={() => setAmount(formatBalance(stakedAmount))}
          className="text-xs text-accent-purple mt-1 hover:underline"
        >
          Max
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={() => setShowConfirm(true)}
        disabled={!amount || isProcessing}
        className="w-full py-2.5 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50"
      >
        Unstake LPT
      </button>

      <TxConfirmationDialog
        isOpen={showConfirm}
        title="Confirm Unstaking"
        description={`Your LPT will be locked for ~${unbondingDays} days before you can withdraw.`}
        details={[
          { label: 'Amount', value: `${amount} LPT` },
          { label: 'Unbonding Period', value: `~${unbondingDays} days` },
        ]}
        confirmLabel="Unstake"
        isProcessing={isProcessing}
        onConfirm={handleSubmit}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
