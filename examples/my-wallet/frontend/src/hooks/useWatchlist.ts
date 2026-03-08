/**
 * Watchlist hook — localStorage-based (no DB dependency)
 */

import { useState, useCallback, useEffect } from 'react';

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

function loadWatchlist(): WatchlistEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveWatchlist(items: WatchlistEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function useWatchlist() {
  const [items, setItems] = useState<WatchlistEntry[]>(loadWatchlist);

  // Sync to localStorage on change
  useEffect(() => { saveWatchlist(items); }, [items]);

  const add = useCallback((orchestratorAddr: string, label?: string, notes?: string) => {
    setItems(prev => {
      if (prev.some(i => i.orchestratorAddr.toLowerCase() === orchestratorAddr.toLowerCase())) {
        return prev; // already exists
      }
      return [...prev, {
        id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        orchestratorAddr,
        label: label || null,
        notes: notes || null,
        addedAt: new Date().toISOString(),
      }];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const update = useCallback((id: string, updates: { label?: string; notes?: string }) => {
    setItems(prev => prev.map(i =>
      i.id === id ? { ...i, ...updates } : i
    ));
  }, []);

  const isWatched = useCallback((addr: string) => {
    return items.some(i => i.orchestratorAddr.toLowerCase() === addr.toLowerCase());
  }, [items]);

  const getItem = useCallback((addr: string) => {
    return items.find(i => i.orchestratorAddr.toLowerCase() === addr.toLowerCase());
  }, [items]);

  return { items, isLoading: false, add, update, remove, isWatched, getItem, refresh: () => {} };
}
