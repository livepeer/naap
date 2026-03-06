/**
 * Shared encryption key and AES-256-GCM utilities for gateway secrets.
 *
 * ENCRYPTION_KEY env var is REQUIRED in production (Vercel).
 * In development, falls back to a stable default key so secrets persist
 * across Next.js hot reloads and server restarts.
 *
 * Key derivation uses scrypt with a fixed application-specific salt to
 * produce a proper 256-bit key from an arbitrary-length passphrase.
 */

import * as crypto from 'crypto';

const DEV_FALLBACK_KEY = 'naap-local-dev-gateway-encryption-key-32ch';

const KDF_SALT = Buffer.from('naap-gateway-kdf-v1', 'utf8');

let _key: string | null = null;
let _derivedKey: Buffer | null = null;
let _warned = false;

function getEncryptionKey(): string {
  if (_key) return _key;

  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    _key = envKey;
  } else if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required in production. ' +
      'Set it in Vercel project settings to a stable 32+ character string.'
    );
  } else {
    if (!_warned) {
      console.warn('[gateway] ENCRYPTION_KEY not set — using dev fallback. Set it in .env.local for production-like behavior.');
      _warned = true;
    }
    _key = DEV_FALLBACK_KEY;
  }

  return _key;
}

function deriveKey(): Buffer {
  if (_derivedKey) return _derivedKey;
  _derivedKey = crypto.scryptSync(getEncryptionKey(), KDF_SALT, 32);
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
