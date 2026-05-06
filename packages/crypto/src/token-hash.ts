import * as crypto from 'crypto';

/**
 * HMAC-SHA256 token hashing with pepper.
 * In production, SESSION_TOKEN_PEPPER must be set; in dev/test
 * falls back to plain SHA-256 for convenience.
 */
export function hmacToken(plaintext: string): string {
  const pepper = process.env.SESSION_TOKEN_PEPPER;
  if (!pepper) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_TOKEN_PEPPER is required in production');
    }
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }
  return crypto.createHmac('sha256', pepper).update(plaintext).digest('hex');
}

export function hmacTokenSafe(plaintext: string): string | null {
  if (!process.env.SESSION_TOKEN_PEPPER) return null;
  return crypto.createHmac('sha256', process.env.SESSION_TOKEN_PEPPER).update(plaintext).digest('hex');
}
