/**
 * Symmetric encryption for sensitive OAuth session data at rest.
 *
 * Uses AES-256-GCM with a key derived from NEXTAUTH_SECRET.
 * Each encryption produces a unique IV, ensuring ciphertexts are
 * never repeated even for identical plaintexts.
 */

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_INFO = 'naap-oauth-token-encryption-v1';

function deriveEncryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required for token encryption');
  }
  return crypto.createHash('sha256').update(`${KEY_INFO}:${secret}`).digest();
}

/**
 * Encrypt a plaintext string. Returns a hex-encoded string of iv:authTag:ciphertext.
 */
export function encryptToken(plaintext: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a token previously encrypted with encryptToken().
 * Returns null if decryption fails (tampered, wrong key, etc.).
 */
export function decryptToken(ciphertext: string): string | null {
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return null;

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    const key = deriveEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}
