import * as crypto from 'crypto';

const SESSION_TOKEN_PEPPER = process.env.SESSION_TOKEN_PEPPER || '';

export function hmacToken(plaintext: string): string {
  if (!SESSION_TOKEN_PEPPER) {
    throw new Error('SESSION_TOKEN_PEPPER env var is required for token hashing');
  }
  return crypto.createHmac('sha256', SESSION_TOKEN_PEPPER).update(plaintext).digest('hex');
}

export function hmacTokenSafe(plaintext: string): string | null {
  if (!SESSION_TOKEN_PEPPER) return null;
  return crypto.createHmac('sha256', SESSION_TOKEN_PEPPER).update(plaintext).digest('hex');
}
