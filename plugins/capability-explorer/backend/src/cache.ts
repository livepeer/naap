import type { CacheEntry } from './types.js';

const MAX_ENTRIES = 100;

const store = new Map<string, CacheEntry<unknown>>();
let stats = { hits: 0, misses: 0 };

export function getCached<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    stats.misses++;
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    stats.misses++;
    return null;
  }
  stats.hits++;
  return entry.data;
}

export function setCached<T>(key: string, data: T, ttlMs: number): void {
  const replacing = store.has(key);
  if (!replacing && store.size >= MAX_ENTRIES) {
    evictExpired();
  }
  if (!replacing && store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  const now = Date.now();
  store.set(key, { data, cachedAt: now, expiresAt: now + ttlMs });
}

function evictExpired(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}

export function clearCache(): void {
  store.clear();
  stats = { hits: 0, misses: 0 };
}

export function getCacheStats(): { size: number; hits: number; misses: number } {
  return { size: store.size, ...stats };
}
