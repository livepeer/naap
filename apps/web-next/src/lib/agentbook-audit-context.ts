/**
 * PR 10 — request → audit context resolvers.
 *
 * The audit() helper requires `source` and `actor` strings. This file
 * computes them from the inbound NextRequest so route handlers don't
 * have to think about it. The Telegram webhook handler does NOT call
 * inferSource — it passes `source: 'telegram', actor: 'bot'` directly.
 *
 * Source rules:
 *   • No request                              → 'api'
 *   • Bearer token + path includes '/cron/'   → 'cron'
 *   • `x-tenant-id` header present (legacy)   → 'api'
 *   • Otherwise (cookie auth resolved)        → 'web'
 *
 * Actor rules:
 *   • naap_auth_token cookie + valid session  → 'user:<userId>'
 *   • Bearer token + cron path                → 'cron'
 *   • Otherwise                               → 'api'
 */

import 'server-only';
import type { NextRequest } from 'next/server';
import type { AuditSource } from './agentbook-audit';

export function inferSource(request?: NextRequest): AuditSource {
  if (!request) return 'api';

  const auth = request.headers.get('authorization') || '';
  const pathname = request.nextUrl?.pathname || '';
  if (auth.toLowerCase().startsWith('bearer ') && pathname.includes('/cron/')) {
    return 'cron';
  }

  // Legacy plugin call style — Express backends set this when calling
  // each other. Treat as `api` (programmatic) rather than `web`.
  if (request.headers.get('x-tenant-id')) {
    return 'api';
  }

  // Default: cookie-auth user from the browser.
  return 'web';
}

/**
 * Resolve the actor string for an inbound request. Mirrors
 * resolveAgentbookTenant's session lookup but returns a 'user:<id>'
 * string for the audit log. Falls back to 'api'.
 *
 * Best-effort: any error in the session lookup is swallowed and we
 * return 'api'. The audit row should always be writable.
 */
export async function inferActor(request?: NextRequest): Promise<string> {
  if (!request) return 'api';

  const auth = request.headers.get('authorization') || '';
  const pathname = request.nextUrl?.pathname || '';
  if (auth.toLowerCase().startsWith('bearer ') && pathname.includes('/cron/')) {
    return 'cron';
  }

  const authToken = request.cookies.get('naap_auth_token')?.value;
  if (authToken) {
    try {
      const { validateSession } = await import('@/lib/api/auth');
      const user = await validateSession(authToken);
      if (user?.id) return `user:${user.id}`;
    } catch {
      /* fall through */
    }
  }

  return 'api';
}
