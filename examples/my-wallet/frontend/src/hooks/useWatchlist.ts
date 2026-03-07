/**
 * Watchlist hook (S15)
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';
import { useWallet } from '../context/WalletContext';

interface WatchlistEntry {
  id: string;
  orchestratorAddr: string;
  label: string | null;
  notes: string | null;
  addedAt: string;
  orchestrator?: {
    name: string | null;
    rewardCut: number;
    feeShare: number;
    totalStake: string;
    isActive: boolean;
  };
}

export function useWatchlist() {
  const { isConnected } = useWallet();
  const [items, setItems] = useState<WatchlistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    if (!isConnected) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/watchlist`);
      if (res.ok) {
        const json = await res.json();
        setItems(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch watchlist:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const add = useCallback(async (orchestratorAddr: string, label?: string, notes?: string) => {
    const res = await fetch(`${getApiUrl()}/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orchestratorAddr, label, notes }),
    });
    if (res.ok) fetch_();
  }, [fetch_]);

  const update = useCallback(async (id: string, updates: { label?: string; notes?: string }) => {
    const res = await fetch(`${getApiUrl()}/watchlist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) fetch_();
  }, [fetch_]);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`${getApiUrl()}/watchlist/${id}`, { method: 'DELETE' });
    if (res.ok) fetch_();
  }, [fetch_]);

  return { items, isLoading, add, update, remove, refresh: fetch_ };
}
