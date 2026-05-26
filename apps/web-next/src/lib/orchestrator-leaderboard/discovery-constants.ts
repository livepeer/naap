import { createHash } from 'node:crypto';

/**
 * Cache-Control for orchestrator-leaderboard discovery endpoints.
 *
 * PR #337 (Daydream-only) must not depend on PymtHouse manifest code, but the
 * frontend/API contract still expects this constant.
 */
export const DISCOVERY_RESPONSE_CACHE_CONTROL = 'private, no-store, must-revalidate';

/**
 * Stable fingerprint used to compose plan cache keys.
 * Order-independent so the same set of capabilities yields the same key.
 */
export function fingerprintCapabilityList(capabilities: string[]): string {
  return createHash('sha256')
    .update([...capabilities].sort((a, b) => a.localeCompare(b)).join('|'))
    .digest('hex')
    .slice(0, 16);
}

