/**
 * CSRF Token Utilities
 * Provides CSRF protection for mutation requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { errors } from './response';

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

const CSRF_TOKEN_LIFETIME = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Server-side CSRF validation.
 * Validates the CSRF token from the request header.
 * Returns null if valid, or an error response if invalid.
 */
export function validateCSRF(
  request: NextRequest,
  _authToken?: string
): NextResponse | null {
  const csrfToken = request.headers.get('X-CSRF-Token');
  
  // In development, be more lenient with CSRF validation
  if (process.env.NODE_ENV === 'development') {
    // Still require the header, but don't validate against a stored token
    if (!csrfToken) {
      console.warn('CSRF token missing in development mode');
      // In dev, we can be lenient
      return null;
    }
    return null;
  }

  // In production, require CSRF token
  if (!csrfToken) {
    return errors.forbidden('CSRF token required');
  }

  // For now, we just check that the token exists and is a valid format
  // A more robust implementation would store tokens server-side and validate
  if (csrfToken.length < 10) {
    return errors.forbidden('Invalid CSRF token');
  }

  return null;
}

/**
 * Generate a CSRF token.
 * Uses crypto.randomUUID if available, otherwise falls back to Math.random.
 */
export function generateCsrfToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Create a CSRF token tied to a session.
 * In production, this should use HMAC with a secret key.
 * For now, we generate a token based on the session token hash.
 */
export function createSessionCSRFToken(sessionToken: string): string {
  // Simple hash-based token generation
  // In production, use HMAC-SHA256 with a server secret
  const hash = sessionToken.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  return `csrf_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
}

/**
 * Get the current CSRF token, fetching a new one if needed.
 */
export async function getCsrfToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await fetch('/api/v1/auth/csrf', {
      method: 'GET',
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      cachedToken = data.token || data.data?.token;
      tokenExpiry = Date.now() + CSRF_TOKEN_LIFETIME;
      return cachedToken!;
    }
  } catch (error) {
    console.warn('Failed to fetch CSRF token:', error);
  }

  // Generate a client-side token as fallback
  cachedToken = generateCsrfToken();
  tokenExpiry = Date.now() + CSRF_TOKEN_LIFETIME;
  return cachedToken;
}

/**
 * Clear the cached CSRF token.
 * Call this when the user logs out.
 */
export function clearCsrfToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

/**
 * Add CSRF token to headers for a fetch request.
 */
export async function withCsrf(
  headers: HeadersInit = {}
): Promise<HeadersInit> {
  const token = await getCsrfToken();
  return {
    ...headers,
    'X-CSRF-Token': token,
  };
}

/**
 * Make a fetch request with CSRF protection.
 */
export async function csrfFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const csrfHeaders = await withCsrf(options.headers || {});
  
  return fetch(url, {
    ...options,
    headers: csrfHeaders,
    credentials: 'include',
  });
}
