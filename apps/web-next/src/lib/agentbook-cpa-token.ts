/**
 * PR 11 — CPA collaboration token helpers.
 *
 * The CPA portal (`/cpa/<token>`) is gated entirely by a long-lived
 * cryptographic random token stored on AbTenantAccess.accessToken. A
 * compromised token gives read access to the tenant's books for up
 * to its 90-day TTL, so we treat it like a bearer credential:
 *
 *   • generated with `crypto.randomBytes(32)` — never Math.random,
 *     never UUIDv4 (only 122 bits of entropy);
 *   • compared with `crypto.timingSafeEqual` so a network attacker
 *     can't fingerprint the token byte-by-byte from response timings;
 *   • cached in a tiny LRU keyed by token-hash so the read path
 *     doesn't hammer Postgres on every dashboard / request POST.
 *
 * Cache invalidation: the LRU stores the AbTenantAccess row for ~30s
 * which is short enough that a `revoke` call surfaces within a digest
 * tick, and long enough to absorb the typical CPA portal session
 * (load page → scroll → maybe ask one question).
 */

import 'server-only';
import { randomBytes, timingSafeEqual } from 'crypto';
import { prisma as db } from '@naap/database';

/**
 * Generate a 32-byte (256-bit) random token, hex-encoded.
 *
 * Output is exactly 64 lowercase-hex chars. Hex (not base64url) so the
 * token is URL-safe in every framework's path-segment parser without
 * percent-encoding shenanigans.
 */
export function generateAccessToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Constant-time equality for two tokens. Both inputs must be hex-encoded
 * strings of the same length; mismatched length returns false WITHOUT
 * calling timingSafeEqual (Node throws on length mismatch). We hex-decode
 * before comparing because timingSafeEqual works on raw bytes — comparing
 * hex strings directly leaks the length-equality bit but that's already
 * not secret (token format is fixed).
 */
export function tokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  // Reject anything that isn't lowercase hex — prevents weird bytes
  // from sneaking through and crashing Buffer.from / timingSafeEqual.
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ─── Tiny in-memory LRU for token → AbTenantAccess lookup ───────────────

export interface TenantAccessRecord {
  id: string;
  tenantId: string;
  role: string;
  email: string;
  expiresAt: Date | null;
  accessToken: string | null;
}

interface CacheEntry {
  expiresAtMs: number;
  record: TenantAccessRecord | null; // null caches "not found" briefly
}

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 256;
// Module-level Map. Insertion order = LRU order (Map iterates oldest→newest).
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAtMs < Date.now()) {
    cache.delete(key);
    return null;
  }
  // Refresh recency.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, record: TenantAccessRecord | null): void {
  if (cache.size >= CACHE_MAX) {
    // Evict oldest (Maps preserve insertion order).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { record, expiresAtMs: Date.now() + CACHE_TTL_MS });
}

/**
 * Resolve the AbTenantAccess row for a portal token. Returns null when:
 *   • token doesn't exist
 *   • token has expired
 *   • token is malformed (not 64 hex chars)
 *
 * Used by /cpa-portal/[token]/* routes; never call from a mutating
 * code path — those should require cookie auth.
 */
export async function resolveAccessByToken(token: string): Promise<TenantAccessRecord | null> {
  if (!token || typeof token !== 'string') return null;
  if (token.length !== 64 || !/^[0-9a-f]+$/i.test(token)) return null;

  const cached = cacheGet(token);
  if (cached) return cached.record;

  const row = await db.abTenantAccess.findFirst({
    where: { accessToken: token },
    select: {
      id: true,
      tenantId: true,
      role: true,
      email: true,
      expiresAt: true,
      accessToken: true,
    },
  });

  // Defense-in-depth: even though Prisma already matched on accessToken,
  // re-verify with timingSafeEqual against the row we got back. This
  // guards against the (admittedly remote) case where Prisma's index
  // lookup leaks a side channel and ensures the path is consistent.
  if (!row || !tokensMatch(row.accessToken, token)) {
    cacheSet(token, null);
    return null;
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    cacheSet(token, null);
    return null;
  }

  const record: TenantAccessRecord = {
    id: row.id,
    tenantId: row.tenantId,
    role: row.role,
    email: row.email,
    expiresAt: row.expiresAt,
    accessToken: row.accessToken,
  };
  cacheSet(token, record);
  return record;
}

/**
 * Invalidate any cached entry for a token. Call from /accountant/revoke
 * so the next dashboard/request hit goes back to the DB and sees the
 * cleared accessToken / expired row.
 */
export function invalidateTokenCache(token: string | null | undefined): void {
  if (!token) return;
  cache.delete(token);
}

/** Test helper: nuke the entire cache between vitest runs. */
export function __resetTokenCacheForTests(): void {
  cache.clear();
}
