/**
 * Shared orchestrator cache — fetched once, cached for configurable duration (default 1hr)
 * Used by ExploreTab and OptimizeTab to avoid redundant fetches.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiUrl } from '../App';

export interface CachedOrchestrator {
  address: string;
  name: string | null;
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  isActive: boolean;
  lastRewardRound?: string;
  rewardCallRatio?: number;
}

interface CacheEntry {
  orchestrators: CachedOrchestrator[];
  fetchedAt: number;
}

// Module-level singleton cache
let globalCache: CacheEntry | null = null;
let fetchPromise: Promise<CachedOrchestrator[]> | null = null;

function getCacheTTL(): number {
  try {
    const stored = localStorage.getItem('my-wallet-settings');
    if (stored) {
      const settings = JSON.parse(stored);
      if (settings.orchestratorCacheMins) {
        return settings.orchestratorCacheMins * 60 * 1000;
      }
    }
  } catch {}
  return 60 * 60 * 1000; // default 1 hour
}

async function fetchOrchestrators(): Promise<CachedOrchestrator[]> {
  const res = await fetch(`${getApiUrl()}/staking/orchestrators?activeOnly=true`);
  const json = await res.json();
  const data = json.data ?? json;
  const list: CachedOrchestrator[] = (data.orchestrators || []).map((o: any) => ({
    address: o.address,
    name: o.name || null,
    rewardCut: o.rewardCut ?? 0,
    feeShare: o.feeShare ?? 0,
    totalStake: o.totalStake || '0',
    isActive: o.isActive ?? o.active ?? true,
    lastRewardRound: o.lastRewardRound,
    rewardCallRatio: o.rewardCallRatio ?? 0,
  }));
  globalCache = { orchestrators: list, fetchedAt: Date.now() };
  return list;
}

export function useOrchestratorCache() {
  const [orchestrators, setOrchestrators] = useState<CachedOrchestrator[]>(globalCache?.orchestrators || []);
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(
    globalCache ? new Date(globalCache.fetchedAt) : null
  );

  const load = useCallback(async (force = false) => {
    const ttl = getCacheTTL();
    if (!force && globalCache && Date.now() - globalCache.fetchedAt < ttl) {
      setOrchestrators(globalCache.orchestrators);
      setLastFetched(new Date(globalCache.fetchedAt));
      return;
    }

    // Deduplicate concurrent fetches
    if (!fetchPromise) {
      setIsLoading(true);
      fetchPromise = fetchOrchestrators().finally(() => { fetchPromise = null; });
    }

    try {
      const list = await fetchPromise;
      setOrchestrators(list);
      setLastFetched(new Date());
    } catch (err) {
      console.error('Failed to fetch orchestrators:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return {
    orchestrators,
    isLoading,
    lastFetched,
    refresh: () => load(true),
    total: orchestrators.length,
  };
}
