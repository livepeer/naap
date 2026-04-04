/**
 * WithdrawForm - Withdraw completed unbonding locks + withdraw fees
 */

import React, { useState } from 'react';
import { useStakingOps } from '../../hooks/useStakingOps';
import { useUnbondingLocks } from '../../hooks/useUnbondingLocks';
import { TxConfirmationDialog } from './TxConfirmationDialog';
import { formatBalance, formatAddress } from '../../lib/utils';

export const WithdrawForm: React.FC = () => {
  const { withdrawStake, withdrawFees, pendingFees } = useStakingOps();
  const { withdrawableLocks, refresh: refreshLocks } = useUnbondingLocks();
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedLockId, setSelectedLockId] = useState<number | null>(null);
  const [withdrawType, setWithdrawType] = useState<'stake' | 'fees'>('stake');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleWithdrawStake = async (lockId: number) => {
    setSelectedLockId(lockId);
    setWithdrawType('stake');
    setShowConfirm(true);
  };

  const handleWithdrawFees = () => {
    setWithdrawType('fees');
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      if (withdrawType === 'stake' && selectedLockId !== null) {
        await withdrawStake(selectedLockId);
        await refreshLocks();
      } else if (withdrawType === 'fees') {
        await withdrawFees();
      }
      setShowConfirm(false);
    } catch (err: any) {
      setError(err?.message || 'Transaction failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const hasWithdrawable = withdrawableLocks.length > 0;
  const hasFees = pendingFees > 0n;

  return (
    <div className="space-y-4">
      {hasWithdrawable ? (
        <div className="space-y-2">
          <p className="text-sm text-text-secondary">Ready to Withdraw</p>
          {withdrawableLocks.map(lock => (
            <div key={lock.id} className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg">
              <div>
                <span className="font-mono text-sm text-text-primary">
                  {formatBalance(lock.amount)} LPT
                </span>
                <span className="text-xs text-text-secondary ml-2">
                  Lock #{lock.lockId}
                </span>
              </div>
              <button
                onClick={() => handleWithdrawStake(lock.lockId)}
                className="px-3 py-1 text-sm bg-accent-emerald text-white rounded-lg hover:bg-accent-emerald/90"
              >
                Withdraw
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 bg-bg-tertiary rounded-lg text-center">
          <p className="text-sm text-text-secondary">No unbonding locks ready to withdraw</p>
        </div>
      )}

      {hasFees && (
        <div className="pt-4 border-t border-border-primary">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">Withdrawable Fees</p>
              <p className="font-mono text-lg text-accent-blue">{formatBalance(pendingFees)} ETH</p>
            </div>
            <button
              onClick={handleWithdrawFees}
              className="px-4 py-2 bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90"
            >
              Withdraw Fees
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <TxConfirmationDialog
        isOpen={showConfirm}
        title={withdrawType === 'stake' ? 'Withdraw Stake' : 'Withdraw Fees'}
        description={
          withdrawType === 'stake'
            ? 'Withdraw your unstaked LPT back to your wallet.'
            : 'Withdraw your accumulated ETH fees.'
        }
        details={
          withdrawType === 'stake' && selectedLockId !== null
            ? [{ label: 'Lock ID', value: `#${selectedLockId}` }]
            : [{ label: 'Fees', value: `${formatBalance(pendingFees)} ETH` }]
        }
        confirmLabel="Withdraw"
        isProcessing={isProcessing}
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
