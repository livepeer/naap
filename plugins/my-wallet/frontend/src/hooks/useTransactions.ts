/**
 * useTransactions - Hook for transaction history
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '../context/WalletContext';
import { useShell, getPluginBackendUrl } from '@naap/plugin-sdk';

export interface Transaction {
  id: string;
  txHash: string;
  type: 'stake' | 'unstake' | 'claim' | 'transfer' | 'other';
  status: 'pending' | 'confirmed' | 'failed';
  chainId: number;
  value: string | null;
  gasUsed: string | null;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface UseTransactionsReturn {
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logTransaction: (tx: Omit<Transaction, 'id' | 'timestamp'>) => Promise<void>;
  total: number;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

export function useTransactions(limit = 20): UseTransactionsReturn {
  const { address, isConnected } = useWallet();
  const shell = useShell();
  const apiUrl = useMemo(() => {
    const config = (shell as any)?.config;
    if (config?.apiBaseUrl) {
      return `${config.apiBaseUrl}/api/v1/wallet`;
    }
    return getPluginBackendUrl('my-wallet', { apiPath: '/api/v1/wallet' });
  }, [shell]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // Fetch transactions from backend
  const fetchTransactions = useCallback(async (reset = false) => {
    if (!isConnected || !address) {
      setTransactions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const currentOffset = reset ? 0 : offset;
      const response = await fetch(
        `${apiUrl}/transactions?address=${address}&limit=${limit}&offset=${currentOffset}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (reset) {
        setTransactions(data.transactions || []);
        setOffset(limit);
      } else {
        setTransactions(prev => [...prev, ...(data.transactions || [])]);
        setOffset(prev => prev + limit);
      }
      
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error('Failed to fetch transactions:', err);
      setError(err?.message || 'Failed to fetch transactions');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, offset, limit]);

  // Refresh transactions (reset pagination)
  const refresh = useCallback(async () => {
    setOffset(0);
    await fetchTransactions(true);
  }, [fetchTransactions]);

  // Load more transactions
  const loadMore = useCallback(async () => {
    if (!isLoading && transactions.length < total) {
      await fetchTransactions(false);
    }
  }, [isLoading, transactions.length, total, fetchTransactions]);

  // Log a new transaction
  const logTransaction = useCallback(async (tx: Omit<Transaction, 'id' | 'timestamp'>) => {
    try {
      await fetch(`${apiUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          ...tx,
        }),
      });

      // Add to local state optimistically
      const newTx: Transaction = {
        ...tx,
        id: `temp-${Date.now()}`,
        timestamp: new Date().toISOString(),
      };
      setTransactions(prev => [newTx, ...prev]);
    } catch (err) {
      console.error('Failed to log transaction:', err);
    }
  }, [address]);

  // Auto-fetch on connection
  useEffect(() => {
    if (isConnected && address) {
      refresh();
    } else {
      setTransactions([]);
      setTotal(0);
      setOffset(0);
    }
  }, [isConnected, address]);

  return {
    transactions,
    isLoading,
    error,
    refresh,
    logTransaction,
    total,
    hasMore: transactions.length < total,
    loadMore,
  };
}
