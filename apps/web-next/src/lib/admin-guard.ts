/**
 * Admin guard for AgentBook admin routes (e.g. /agentbook-core/admin/llm-configs).
 *
 * Two-tier admission check:
 *   1. AuthUser.roles includes 'admin' or 'system:admin' (canonical RBAC), OR
 *   2. user.email is in ADMIN_EMAILS env allowlist (comma-separated).
 *
 * Returns a discriminated union so callers can return `guard.response` immediately
 * on rejection, mirroring the `safeResolveAgentbookTenant` pattern from PR 1.
 *
 * Also exports `redactApiKey` for masking secrets on read paths.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { safeResolveAgentbookTenant } from './agentbook-tenant';
import { validateSession } from './api/auth';

function getAdminEmailAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export type AdminGuardResult =
  | { user: { id: string; email: string; roles?: string[] }; tenantId: string }
  | { response: Response };

export async function requireAdmin(request: NextRequest): Promise<AdminGuardResult> {
  const resolved = await safeResolveAgentbookTenant(request);
  if ('response' in resolved) return { response: resolved.response };

  const authToken = request.cookies.get('naap_auth_token')?.value;
  if (!authToken) {
    return { response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }

  const user = await validateSession(authToken).catch(() => null);
  if (!user?.id || !user?.email) {
    return { response: NextResponse.json({ error: 'invalid session' }, { status: 401 }) };
  }

  const roles = Array.isArray((user as { roles?: unknown }).roles)
    ? ((user as { roles: string[] }).roles)
    : [];
  const isAdminByRole = roles.includes('admin') || roles.includes('system:admin');

  const adminEmails = getAdminEmailAllowlist();
  const isAdminByEmail = adminEmails.includes(user.email.toLowerCase());

  if (!isAdminByRole && !isAdminByEmail) {
    return { response: NextResponse.json({ error: 'admin required' }, { status: 403 }) };
  }

  return {
    user: { id: user.id, email: user.email, roles },
    tenantId: resolved.tenantId,
  };
}

/**
 * Mask an API key for safe display. "sk-1234567890ABCDEF" -> "****CDEF".
 * Returns "****" if key is null/undefined/empty/very-short.
 */
export function redactApiKey(apiKey: string | null | undefined): string {
  if (!apiKey) return '****';
  if (apiKey.length <= 4) return '****';
  return '****' + apiKey.slice(-4);
}
