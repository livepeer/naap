/**
 * Watchlist hook — backend API-backed with localStorage fallback
 */

import { useState, useCallback, useEffect } from 'react';
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

const STORAGE_KEY = 'my-wallet-watchlist';

function loadLocal(): WatchlistEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const { address } = useWallet();
  const [items, setItems] = useState<WatchlistEntry[]>(loadLocal);
  const [isLoading, setIsLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/watchlist?address=${address}`);
      if (res.ok) {
        const json = await res.json();
        const data = json.data || [];
        setItems(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    } catch {
      // Use localStorage fallback
      setItems(loadLocal());
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const add = useCallback(async (orchestratorAddr: string, label?: string, notes?: string) => {
    if (!address) return;

    // Optimistic update
    const tempEntry: WatchlistEntry = {
      id: `temp_${Date.now()}`,
      orchestratorAddr,
      label: label || null,
      notes: notes || null,
      addedAt: new Date().toISOString(),
    };
    setItems((prev) => [...prev, tempEntry]);

    try {
      const res = await fetch(`${getApiUrl()}/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, orchestratorAddr, label, notes }),
      });
      if (res.ok) {
        await fetchItems();
      }
    } catch {
      // Keep optimistic update
    }
  }, [address, fetchItems]);

  const remove = useCallback(async (id: string) => {
    if (!address) return;

    setItems((prev) => prev.filter((i) => i.id !== id));

    try {
      await fetch(`${getApiUrl()}/watchlist/${id}?address=${address}`, { method: 'DELETE' });
    } catch { /* keep optimistic */ }
  }, [address]);

  const update = useCallback(async (id: string, updates: { label?: string; notes?: string }) => {
    if (!address) return;

    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...updates } : i)));

    try {
      await fetch(`${getApiUrl()}/watchlist/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, ...updates }),
      });
    } catch { /* keep optimistic */ }
  }, [address]);

  const isWatched = useCallback(
    (addr: string) => items.some((i) => i.orchestratorAddr.toLowerCase() === addr.toLowerCase()),
    [items],
  );

  const getItem = useCallback(
    (addr: string) => items.find((i) => i.orchestratorAddr.toLowerCase() === addr.toLowerCase()),
    [items],
  );

  return { items, isLoading, add, update, remove, isWatched, getItem, refresh: fetchItems };
}
