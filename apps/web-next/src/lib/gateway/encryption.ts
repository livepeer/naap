/**
 * Shared encryption key and AES-256-GCM utilities for gateway secrets.
 *
 * Single module ensures the same key is used across admin routes and
 * the proxy engine, even when ENCRYPTION_KEY is not set in the environment
 * (development fallback).
 */

import * as crypto from 'crypto';

let _key: string | null = null;

function getEncryptionKey(): string {
  if (_key) return _key;
  _key = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
  return _key;
}

function deriveKey(): Buffer {
  return Buffer.from(getEncryptionKey().slice(0, 32).padEnd(32, '0'));
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
