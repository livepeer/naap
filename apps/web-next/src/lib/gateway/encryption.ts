/**
 * Shared encryption key and AES-256-GCM utilities for gateway secrets.
 *
 * ENCRYPTION_KEY must be set in production. In development only, a
 * deterministic fallback key is used (so secrets survive process restarts).
 */

import * as crypto from 'crypto';

const DEV_FALLBACK_KEY = 'naap-dev-encryption-key-do-not-use-in-production!!';

let _derivedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (_derivedKey) return _derivedKey;

  const rawKey = process.env.ENCRYPTION_KEY;
  if (!rawKey && process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY environment variable is required in production');
  }

  const source = rawKey || DEV_FALLBACK_KEY;
  _derivedKey = crypto.createHash('sha256').update(source).digest();
  return _derivedKey;
}

export function encrypt(text: string): { encryptedValue: string; iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted + ':' + authTag.toString('hex'),
    iv: iv.toString('hex'),
  };
}

export function decrypt(encryptedValue: string, ivHex: string): string {
  const iv = Buffer.from(ivHex, 'hex');
  const parts = encryptedValue.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted value format');

  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), iv);
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));

  let decrypted = decipher.update(parts[0], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
