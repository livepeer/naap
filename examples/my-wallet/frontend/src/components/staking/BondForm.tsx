/**
 * BondForm - Stake LPT to an orchestrator with approve flow
 */

import React, { useState } from 'react';
import { useStakingOps } from '../../hooks/useStakingOps';
import { OrchestratorSelect } from './OrchestratorSelect';
import { TxConfirmationDialog } from './TxConfirmationDialog';
import { formatBalance } from '../../lib/utils';

export const BondForm: React.FC = () => {
  const { lptBalance, delegatedTo, stake, refreshStakingState } = useStakingOps();
  const [amount, setAmount] = useState('');
  const [orchestrator, setOrchestrator] = useState(delegatedTo || '');
  const [showConfirm, setShowConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const hash = await stake(amount, orchestrator);
      setTxHash(hash);
      setAmount('');
      setShowConfirm(false);
    } catch (err: any) {
      setError(err?.message || 'Transaction failed');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm text-text-secondary">Orchestrator</label>
        <OrchestratorSelect value={orchestrator} onChange={setOrchestrator} />
      </div>

      <div>
        <div className="flex justify-between">
          <label className="text-sm text-text-secondary">Amount (LPT)</label>
          <span className="text-xs text-text-secondary">
            Balance: {formatBalance(lptBalance)} LPT
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
          onClick={() => setAmount(formatBalance(lptBalance))}
          className="text-xs text-accent-purple mt-1 hover:underline"
        >
          Max
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {txHash && (
        <p className="text-sm text-accent-emerald">
          Transaction submitted: {txHash.slice(0, 10)}...
        </p>
      )}

      <button
        onClick={() => setShowConfirm(true)}
        disabled={!amount || !orchestrator || isProcessing}
        className="w-full py-2.5 wallet-gradient text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
      >
        Stake LPT
      </button>

      <TxConfirmationDialog
        isOpen={showConfirm}
        title="Confirm Staking"
        description="Stake LPT to the selected orchestrator. This may require an approval transaction first."
        details={[
          { label: 'Amount', value: `${amount} LPT` },
          { label: 'Orchestrator', value: orchestrator.slice(0, 10) + '...' },
        ]}
        confirmLabel="Stake"
        isProcessing={isProcessing}
        onConfirm={handleSubmit}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
