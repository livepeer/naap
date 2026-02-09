/**
 * CSRF Protection Service
 * 
 * Provides CSRF token generation and validation.
 * Tokens are bound to session tokens for security.
 */

import * as crypto from 'crypto';

// CSRF token store: sessionToken -> csrfToken
const csrfTokenStore = new Map<string, { token: string; createdAt: number }>();

// Token TTL: 24 hours (same as session)
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Clean up expired tokens every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of csrfTokenStore.entries()) {
    if (now - value.createdAt > TOKEN_TTL_MS) {
      csrfTokenStore.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Generate a CSRF token for a session
 */
export function generateCsrfToken(sessionToken: string): string {
  // Check if we already have a token for this session
  const existing = csrfTokenStore.get(sessionToken);
  if (existing && Date.now() - existing.createdAt < TOKEN_TTL_MS) {
    return existing.token;
  }

  // Generate new token
  const csrfToken = crypto.randomBytes(32).toString('hex');
  csrfTokenStore.set(sessionToken, {
    token: csrfToken,
    createdAt: Date.now(),
  });

  return csrfToken;
}

/**
 * Validate a CSRF token against a session
 */
export function validateCsrfToken(sessionToken: string, csrfToken: string): boolean {
  if (!sessionToken || !csrfToken) {
    return false;
  }

  const stored = csrfTokenStore.get(sessionToken);
  if (!stored) {
    return false;
  }

  // Check if expired
  if (Date.now() - stored.createdAt > TOKEN_TTL_MS) {
    csrfTokenStore.delete(sessionToken);
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(stored.token, 'hex'),
      Buffer.from(csrfToken, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Invalidate CSRF token for a session (on logout)
 */
export function invalidateCsrfToken(sessionToken: string): void {
  csrfTokenStore.delete(sessionToken);
}
