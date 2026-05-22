/**
 * Unified encryption envelope for SecretVault and sensitive column encryption.
 *
 * Format: v1:gcm:scrypt:<saltHex>:<ivHex>:<ctHex>:<tagHex>
 *
 * Uses AES-256-GCM with scrypt-derived key. Per-row random salt and IV.
 * AAD (additional authenticated data) binds ciphertext to its context (row key/scope)
 * to prevent copy-paste replay attacks across rows.
 */

import * as crypto from 'crypto';

const ENVELOPE_PREFIX = 'v1:gcm:scrypt:';

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  return key;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function encryptV1(plaintext: string, aad?: string): string {
  const masterKey = getEncryptionKey();
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const derivedKey = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  if (aad) {
    cipher.setAAD(Buffer.from(aad, 'utf8'));
  }

  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENVELOPE_PREFIX}${salt.toString('hex')}:${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptV1(envelope: string, aad?: string): string {
  if (!envelope.startsWith(ENVELOPE_PREFIX)) {
    throw new Error('Unknown envelope format');
  }

  const masterKey = getEncryptionKey();
  const parts = envelope.slice(ENVELOPE_PREFIX.length).split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed v1 envelope');
  }

  const [saltHex, ivHex, ctHex, tagHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const derivedKey = deriveKey(masterKey, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(tag);
  if (aad) {
    decipher.setAAD(Buffer.from(aad, 'utf8'));
  }

  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function isV1Envelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX);
}
