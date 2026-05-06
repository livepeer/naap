import * as crypto from 'crypto';

/**
 * HMAC-SHA256 token hashing with pepper.
 * Falls back to plain SHA-256 when SESSION_TOKEN_PEPPER is unset,
 * matching the behaviour of the auth service implementations.
 */
export function hmacToken(plaintext: string): string {
  const pepper = process.env.SESSION_TOKEN_PEPPER;
  if (pepper) {
    return crypto.createHmac('sha256', pepper).update(plaintext).digest('hex');
  }
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

export function hmacTokenSafe(plaintext: string): string | null {
  if (!process.env.SESSION_TOKEN_PEPPER) return null;
  return crypto.createHmac('sha256', process.env.SESSION_TOKEN_PEPPER).update(plaintext).digest('hex');
}
