/**
 * useUnbondingLocks - Hook for tracking unbonding locks
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';

interface UnbondingLock {
  id: string;
  walletAddressId: string;
  lockId: number;
  amount: string;
  withdrawRound: number;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  txHash: string | null;
  walletAddress: {
    address: string;
    label: string | null;
    chainId: number;
  };
}

interface UseUnbondingLocksReturn {
  locks: UnbondingLock[];
  pendingLocks: UnbondingLock[];
  withdrawableLocks: UnbondingLock[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useUnbondingLocks(): UseUnbondingLocksReturn {
  const shell = useShell();
  const [locks, setLocks] = useState<UnbondingLock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/unbonding-locks`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json();
      const data = json.data ?? json;
      setLocks(data.locks || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch unbonding locks');
    } finally {
      setIsLoading(false);
    }
  }, [shell]);

  const pendingLocks = useMemo(
    () => locks.filter(l => l.status === 'pending'),
    [locks]
  );

  const withdrawableLocks = useMemo(
    () => locks.filter(l => l.status === 'withdrawable'),
    [locks]
  );

  useEffect(() => {
    const user = shell.auth.getUser();
    if (user) refresh();
  }, [shell, refresh]);

  return { locks, pendingLocks, withdrawableLocks, isLoading, error, refresh };
}
