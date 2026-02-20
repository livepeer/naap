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
 * Hash an API key for storage using scrypt KDF.
 * Works for both NaaP-native and provider-issued keys.
 */
export function hashApiKey(key: string): string {
  return crypto.scryptSync(key, KEY_HASH_SALT, 32).toString('hex');
}
