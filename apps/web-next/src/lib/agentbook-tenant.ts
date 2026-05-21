/**
 * Resolve the AgentBook tenant ID for an inbound request.
 *
 * Authentication priority:
 *  1. Cron / service-to-service: CRON_SECRET bearer token OR x-vercel-cron header.
 *     Caller MUST also send x-tenant-id (the target tenant for this cron invocation).
 *  2. User session: naap_auth_token cookie → validateSession → user.id.
 *
 * Throws `Response` on no-auth (401) or no-tenant (400). Callers may try/catch
 * to return the Response cleanly; otherwise Next.js returns 500 (which is still
 * safer than the previous behavior of falling back to the 'default' tenant).
 *
 * Note: tenantId is currently equal to user.id (single-tenant model).
 */

import 'server-only';
import type { NextRequest } from 'next/server';

function isCronAuthenticated(request: NextRequest): boolean {
  // Vercel-issued cron requests
  if (request.headers.get('x-vercel-cron') === '1') return true;

  // Explicit shared-secret bearer or ?secret= query param
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${cronSecret}`) return true;

  // Some cron entries use ?secret=... (existing pattern)
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('secret') === cronSecret) return true;
  } catch {
    /* ignore */
  }

  return false;
}

export async function resolveAgentbookTenant(request: NextRequest): Promise<string> {
  // 1. Cron / service path
  if (isCronAuthenticated(request)) {
    const tenantId = request.headers.get('x-tenant-id');
    if (!tenantId) {
      throw new Response(JSON.stringify({ error: 'cron request must specify x-tenant-id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return tenantId;
  }

  // 2. User session
  const authToken = request.cookies.get('naap_auth_token')?.value;
  if (!authToken) {
    throw new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { validateSession } = await import('@/lib/api/auth');
    const user = await validateSession(authToken);
    if (!user?.id) {
      throw new Response(JSON.stringify({ error: 'invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return user.id;
  } catch (err) {
    if (err instanceof Response) throw err;
    throw new Response(JSON.stringify({ error: 'session validation failed' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Convenience wrapper for route handlers that want graceful 401/400 responses
 * instead of unhandled throws. Returns either { tenantId } or { response } that
 * the handler should immediately return.
 */
export async function safeResolveAgentbookTenant(
  request: NextRequest
): Promise<{ tenantId: string } | { response: Response }> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    return { tenantId };
  } catch (err) {
    if (err instanceof Response) return { response: err };
    return {
      response: new Response(JSON.stringify({ error: 'internal error during auth' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
}
