/**
 * Resend cooldown — prevents repeated verification/reset email sends to the
 * same recipient within a TTL window.
 *
 * Backed by Redis (`@naap/cache`) for cross-instance consistency on Vercel
 * Fluid Compute. Falls back to a process-local Map when Redis is unavailable
 * (e.g. local dev without REDIS_URL) so the behavior is still correct within
 * a single instance.
 *
 * Key shape: `auth:resend-cooldown:<purpose>:<lowercased-email>`
 * Value: epoch-ms of the send that started the cooldown.
 */

import { createHash } from 'node:crypto';

export interface CooldownOptions {
  /** Logical bucket — e.g. 'verification', 'password-reset'. */
  purpose: string;
  /** Cooldown TTL in milliseconds (default 15 minutes). */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const PREFIX = 'auth:resend-cooldown';

/**
 * Hash the email so the cache key doesn't carry plaintext PII. Lowercased
 * before hashing for consistent lookup regardless of casing variation.
 */
function emailKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function buildKey(purpose: string, email: string): string {
  return `${purpose}:${emailKey(email)}`;
}

/**
 * In-memory fallback used when Redis is unavailable. Mirrors the historical
 * single-instance behavior; bounded by a soft cap to avoid unbounded growth.
 */
const memoryStore = new Map<string, number>();
const MEMORY_SOFT_CAP = 5_000;

function memoryGet(key: string, now: number, ttlMs: number): number | null {
  const ts = memoryStore.get(key);
  if (ts === undefined) return null;
  if (now - ts >= ttlMs) {
    memoryStore.delete(key);
    return null;
  }
  return ts;
}

function memorySet(key: string, now: number): void {
  if (memoryStore.size >= MEMORY_SOFT_CAP) {
    // Drop the oldest entry to keep the map bounded.
    const oldest = memoryStore.keys().next().value;
    if (oldest !== undefined) memoryStore.delete(oldest);
  }
  memoryStore.set(key, now);
}

/**
 * Lazy-load @naap/cache so the cooldown module remains usable on cold start
 * even if the cache package fails to load.
 */
async function getCache(): Promise<typeof import('@naap/cache') | null> {
  try {
    return await import('@naap/cache');
  } catch {
    return null;
  }
}

/**
 * Try to acquire a cooldown slot for (purpose, email).
 *
 * @returns `true` if the slot was acquired (caller should proceed with the
 *          send), `false` if the recipient is still within their cooldown.
 */
export async function tryAcquireCooldown(
  email: string,
  options: CooldownOptions
): Promise<boolean> {
  const { purpose, ttlMs = DEFAULT_TTL_MS } = options;
  if (!email) return false;
  if (ttlMs <= 0) return true;

  const key = buildKey(purpose, email);
  const now = Date.now();
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

  const cache = await getCache();
  if (cache) {
    try {
      const existing = await cache.cacheGet<number>(key, { prefix: PREFIX });
      if (typeof existing === 'number' && now - existing < ttlMs) {
        return false;
      }
      await cache.cacheSet<number>(key, now, { prefix: PREFIX, ttl: ttlSeconds });
      return true;
    } catch {
      // Fall through to in-memory if Redis errors out
    }
  }

  if (memoryGet(key, now, ttlMs) !== null) {
    return false;
  }
  memorySet(key, now);
  return true;
}

/** Internal hook for tests. */
export function __clearCooldownMemoryForTests(): void {
  memoryStore.clear();
}
