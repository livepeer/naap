/**
 * useTransactionMonitor Hook
 *
 * Monitors an Ethereum transaction and tracks its confirmation state.
 */

import { useState, useEffect, useRef } from 'react';
import type { BrowserProvider, TransactionReceipt } from 'ethers';

export interface TransactionState {
  /** Transaction hash being monitored */
  hash: string | null;
  /** Whether the transaction is pending */
  pending: boolean;
  /** Number of confirmations */
  confirmations: number;
  /** Transaction receipt when confirmed */
  receipt: TransactionReceipt | null;
  /** Whether the transaction succeeded */
  success: boolean | null;
  /** Error if monitoring failed */
  error: Error | null;
}

/**
 * Hook for monitoring an Ethereum transaction.
 *
 * @param provider - The ethers provider to use for monitoring
 * @param txHash - The transaction hash to monitor
 * @param requiredConfirmations - Number of confirmations to wait for (default: 1)
 */
export function useTransactionMonitor(
  provider: BrowserProvider | null,
  txHash: string | null,
  requiredConfirmations = 1
): TransactionState {
  const [state, setState] = useState<TransactionState>({
    hash: txHash,
    pending: !!txHash,
    confirmations: 0,
    receipt: null,
    success: null,
    error: null,
  });

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (!provider || !txHash) {
      setState(prev => ({ ...prev, hash: txHash, pending: false }));
      return;
    }

    setState({
      hash: txHash,
      pending: true,
      confirmations: 0,
      receipt: null,
      success: null,
      error: null,
    });

    let cancelled = false;

    const monitor = async () => {
      try {
        const receipt = await provider.waitForTransaction(txHash, requiredConfirmations);

        if (cancelled || !mountedRef.current) return;

        if (receipt) {
          setState({
            hash: txHash,
            pending: false,
            confirmations: requiredConfirmations,
            receipt,
            success: receipt.status === 1,
            error: receipt.status === 0 ? new Error('Transaction reverted') : null,
          });
        }
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        setState(prev => ({
          ...prev,
          pending: false,
          error: err instanceof Error ? err : new Error('Transaction monitoring failed'),
        }));
      }
    };

    monitor();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [provider, txHash, requiredConfirmations]);

  return state;
}
