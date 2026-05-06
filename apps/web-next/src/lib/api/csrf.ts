/**
 * CSRF Token Utilities — server-only module
 * Double-submit cookie pattern with HMAC binding to session.
 *
 * Client helpers (getCsrfToken, csrfFetch, withCsrf, clearCsrfToken)
 * live in ./csrf-client.ts to avoid pulling Node-only modules into
 * the client bundle.
 */

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { errors } from './response';

const CSRF_PEPPER = process.env.CSRF_PEPPER || process.env.NEXTAUTH_SECRET || '';

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
