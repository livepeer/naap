'use client';

/**
 * Generic feature-flags hook.
 *
 * Fetches GET /api/v1/features once and caches the result at module level
 * so every component that calls useFeatureFlags() shares a single request.
 *
 * Usage:
 *   const { flags, loading } = useFeatureFlags();
 *   if (flags.enableTeams) { ... }
 *
 * To add a new flag check, just read flags.<key> — no hook changes needed.
 */

import { useState, useEffect, useCallback } from 'react';

type FlagMap = Record<string, boolean>;

interface FeatureFlagsState {
  flags: FlagMap;
  loading: boolean;
  refresh: () => void;
}

let cachedFlags: FlagMap | null = null;
let fetchPromise: Promise<FlagMap> | null = null;

async function fetchFlags(): Promise<FlagMap> {
  try {
    const res = await fetch('/api/v1/features', { credentials: 'include' });
    const data = await res.json();
    if (data.success && data.data?.flags) {
      return data.data.flags;
    }
  } catch {
    // Silently fall back to empty map
  }
  return {};
}

function loadFlags(): Promise<FlagMap> {
  if (cachedFlags) return Promise.resolve(cachedFlags);
  if (!fetchPromise) {
    fetchPromise = fetchFlags().then(result => {
      cachedFlags = result;
      fetchPromise = null;
      return result;
    });
  }
  return fetchPromise;
}

export function invalidateFeatureFlags(): void {
  cachedFlags = null;
  fetchPromise = null;
}

export function useFeatureFlags(): FeatureFlagsState {
  const [flags, setFlags] = useState<FlagMap>(cachedFlags || {});
  const [loading, setLoading] = useState(!cachedFlags);

  useEffect(() => {
    let cancelled = false;
    loadFlags().then(result => {
      if (!cancelled) {
        setFlags(result);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(() => {
    invalidateFeatureFlags();
    setLoading(true);
    loadFlags().then(result => {
      setFlags(result);
      setLoading(false);
    });
  }, []);

  return { flags, loading, refresh };
}
