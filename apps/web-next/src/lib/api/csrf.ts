/**
 * CSRF Token Utilities
 * Double-submit cookie pattern with HMAC binding to session.
 */

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { errors } from './response';

const CSRF_PEPPER = process.env.CSRF_PEPPER || process.env.NEXTAUTH_SECRET || '';
const CSRF_TOKEN_LIFETIME = 60 * 60 * 1000; // 1 hour

/**
 * Server-side CSRF validation using double-submit cookie pattern.
 * Compares the X-CSRF-Token header against the naap_csrf_token cookie.
 * 
 * Options:
 *  - shadowMode: if true, log violations but don't block (for rollout)
 *  - exempt: if true, skip validation entirely (for bootstrap routes)
 */
export function validateCSRF(
  request: NextRequest,
  options?: { shadowMode?: boolean; exempt?: boolean }
): NextResponse | null {
  if (options?.exempt) return null;

  // In development, be lenient
  if (process.env.NODE_ENV === 'development') {
    return null;
  }

  const headerToken = request.headers.get('X-CSRF-Token');
  const cookieToken = request.cookies.get('naap_csrf_token')?.value;

  if (!headerToken || !cookieToken) {
    if (options?.shadowMode) {
      console.warn('[CSRF] Shadow-mode rejection: missing token', {
        hasHeader: !!headerToken,
        hasCookie: !!cookieToken,
        path: request.nextUrl.pathname,
      });
      return null;
    }
    return errors.forbidden('CSRF token required');
  }

  // Timing-safe comparison of header value vs cookie value
  try {
    const headerBuf = Buffer.from(headerToken, 'utf8');
    const cookieBuf = Buffer.from(cookieToken, 'utf8');
    
    if (headerBuf.length !== cookieBuf.length) {
      if (options?.shadowMode) {
        console.warn('[CSRF] Shadow-mode rejection: token length mismatch', {
          path: request.nextUrl.pathname,
        });
        return null;
      }
      return errors.forbidden('Invalid CSRF token');
    }

    if (!crypto.timingSafeEqual(headerBuf, cookieBuf)) {
      if (options?.shadowMode) {
        console.warn('[CSRF] Shadow-mode rejection: token mismatch', {
          path: request.nextUrl.pathname,
        });
        return null;
      }
      return errors.forbidden('Invalid CSRF token');
    }
  } catch {
    if (options?.shadowMode) return null;
    return errors.forbidden('Invalid CSRF token');
  }

  return null;
}

/**
 * Generate a cryptographically random CSRF token.
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a CSRF token bound to a session via HMAC.
 */
export function createSessionCSRFToken(sessionId: string): string {
  if (!CSRF_PEPPER) {
    return generateCsrfToken();
  }
  const payload = `${sessionId}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', CSRF_PEPPER).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

// Client-side utilities below — kept for backwards compatibility with existing imports

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

export async function getCsrfToken(): Promise<string> {
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

  cachedToken = generateCsrfToken();
  tokenExpiry = Date.now() + CSRF_TOKEN_LIFETIME;
  return cachedToken;
}

export function clearCsrfToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

export async function withCsrf(
  headers: HeadersInit = {}
): Promise<HeadersInit> {
  const token = await getCsrfToken();
  return {
    ...headers,
    'X-CSRF-Token': token,
  };
}

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
