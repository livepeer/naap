/**
 * Field-level encryption for sensitive database columns.
 * Handles both new (v1 envelope) and legacy (plaintext) values transparently.
 */

import { encryptV1, decryptV1, isV1Envelope } from './envelope';

/**
 * Encrypt a field value. Returns v1 envelope string.
 * @param plaintext The value to encrypt
 * @param context AAD context string (e.g. "OAuthAccount:<id>:accessToken")
 */
export function encryptField(plaintext: string, context?: string): string {
  return encryptV1(plaintext, context);
}

/**
 * Decrypt a field value. Handles both v1 envelopes and legacy plaintext.
 * @param stored The stored value (may be v1 envelope or legacy plaintext)
 * @param context AAD context string (must match what was used during encryption)
 * @returns The plaintext value
 */
export function decryptField(stored: string, context?: string): string {
  if (isV1Envelope(stored)) {
    return decryptV1(stored, context);
  }
  return stored;
}

/**
 * Check if a stored value needs re-encryption (is legacy/plaintext).
 */
export function needsReEncryption(stored: string): boolean {
  return !isV1Envelope(stored);
}
