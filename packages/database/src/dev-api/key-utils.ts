/**
 * Shared API key utility functions for the developer API.
 *
 * Used by both the Next.js API route and the developer-api plugin backend
 * to ensure consistent key parsing, lookup ID derivation, and hashing.
 */

import * as crypto from 'crypto';

const KEY_HASH_SALT = 'naap-api-key-v1';

export function parseApiKey(key: string): { lookupId: string; secret: string } | null {
  const m = key.match(/^naap_([0-9a-f]{16})_([0-9a-f]{48})$/);
  return m ? { lookupId: m[1], secret: m[2] } : null;
}

export function deriveKeyLookupId(rawKey: string): string {
  const parsed = parseApiKey(rawKey);
  if (parsed) {
    return parsed.lookupId;
  }
  return crypto.randomBytes(8).toString('hex');
}

export function getKeyPrefix(lookupId: string): string {
  return `naap_${lookupId}...`;
}

/**
 * Short, non-secret prefix derived from the billing provider secret so users can
 * match list rows to keys they hold. NaaP-native `naap_…` keys keep the existing
 * `naap_<lookupId>…` shape; opaque provider tokens show only the provider slug prefix
 * and the first 4 chars after it (e.g. `pmth_AbCd…`) to avoid exposing secret material.
 */
export function formatBillingKeyPublicPrefix(rawKey: string): string {
  const t = rawKey.trim();
  if (!t) {
    return '—';
  }
  const parsed = parseApiKey(t);
  if (parsed) {
    return getKeyPrefix(parsed.lookupId);
  }
  // For opaque provider tokens (e.g. pmth_AbCdEfGhIj…), only reveal the slug prefix
  // and the first 4 chars of secret material so users can identify the key without
  // exposing meaningful secret bytes.
  const underscoreIdx = t.indexOf('_');
  if (underscoreIdx > 0 && underscoreIdx < t.length - 1) {
    const slug = t.slice(0, underscoreIdx);
    return `${slug}_${t.slice(underscoreIdx + 1, underscoreIdx + 5)}…`;
  }
  // Fallback for keys with no underscore delimiter: at most 4 chars.
  return t.length <= 4 ? t : `${t.slice(0, 4)}…`;
}

/**
 * Hash an API key for storage using scrypt KDF.
 * Works for both NaaP-native and provider-issued keys.
 */
export function hashApiKey(key: string): string {
  return crypto.scryptSync(key, KEY_HASH_SALT, 32).toString('hex');
}
