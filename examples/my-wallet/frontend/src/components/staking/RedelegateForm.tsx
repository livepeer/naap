/**
 * RedelegateForm - Move stake from current orchestrator to a new one
 */

import React, { useState } from 'react';
import { useStakingOps } from '../../hooks/useStakingOps';
import { OrchestratorSelect } from './OrchestratorSelect';
import { TxConfirmationDialog } from './TxConfirmationDialog';
import { formatBalance, formatAddress } from '../../lib/utils';

export const RedelegateForm: React.FC = () => {
  const { stakedAmount, delegatedTo, redelegate } = useStakingOps();
  const [amount, setAmount] = useState('');
  const [newOrchestrator, setNewOrchestrator] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await redelegate(amount, newOrchestrator);
      setAmount('');
      setNewOrchestrator('');
      setShowConfirm(false);
    } catch (err: any) {
      setError(err?.message || 'Transaction failed');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {delegatedTo && (
        <div className="p-3 bg-bg-tertiary rounded-lg">
          <p className="text-xs text-text-secondary mb-1">Currently Delegated To</p>
          <p className="font-mono text-sm text-text-primary">{formatAddress(delegatedTo)}</p>
        </div>
      )}

      <div>
        <label className="text-sm text-text-secondary">New Orchestrator</label>
        <OrchestratorSelect
          value={newOrchestrator}
          onChange={setNewOrchestrator}
          excludeAddress={delegatedTo || undefined}
        />
      </div>

      <div>
        <div className="flex justify-between">
          <label className="text-sm text-text-secondary">Amount to Move (LPT)</label>
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
        disabled={!amount || !newOrchestrator || isProcessing}
        className="w-full py-2.5 wallet-gradient text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
      >
        Redelegate
      </button>

      <TxConfirmationDialog
        isOpen={showConfirm}
        title="Confirm Redelegation"
        description="This will unbond from your current orchestrator and bond to the new one. This involves two transactions."
        details={[
          { label: 'Amount', value: `${amount} LPT` },
          { label: 'From', value: formatAddress(delegatedTo || '') },
          { label: 'To', value: formatAddress(newOrchestrator) },
        ]}
        confirmLabel="Redelegate"
        isProcessing={isProcessing}
        onConfirm={handleSubmit}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
