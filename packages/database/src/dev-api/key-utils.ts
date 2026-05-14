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

const BILLING_KEY_PUBLIC_PREFIX_MAX = 14;

/**
 * Short, non-secret prefix derived from the billing provider secret so users can
 * match list rows to keys they hold. NaaP-native `naap_…` keys keep the existing
 * `naap_<lookupId>…` shape; opaque provider tokens use the first characters of the token.
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
  if (t.length <= BILLING_KEY_PUBLIC_PREFIX_MAX) {
    return t;
  }
  return `${t.slice(0, BILLING_KEY_PUBLIC_PREFIX_MAX)}…`;
}

/**
 * Hash an API key for storage using scrypt KDF.
 * Works for both NaaP-native and provider-issued keys.
 */
export function hashApiKey(key: string): string {
  return crypto.scryptSync(key, KEY_HASH_SALT, 32).toString('hex');
}
