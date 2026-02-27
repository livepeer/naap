/**
 * Service Gateway — Authorization
 *
 * Dual-path auth:
 * 1. JWT (NaaP plugins) — Bearer token + x-team-id header
 * 2. API Key (external consumers) — gw_xxx key in Authorization header
 *
 * Team isolation: a key from Team A cannot access Team B's connectors.
 */

import { createHash } from 'crypto';
import { prisma } from '@/lib/db';
import { getAuthToken } from '@/lib/api/response';
import type { AuthResult, TeamContext } from './types';

const BASE_SVC_URL = process.env.BASE_SVC_URL || process.env.NEXT_PUBLIC_BASE_SVC_URL || 'http://localhost:4000';

/**
 * Extract team context from the request.
 * Returns null if no valid auth is found.
 */
export async function authorize(request: Request): Promise<AuthResult | null> {
  const authHeader = request.headers.get('authorization') || '';

  // Path 1: API Key auth (gw_ prefix)
  if (authHeader.startsWith('Bearer gw_')) {
    return authorizeApiKey(authHeader.slice(7)); // strip "Bearer "
  }

  // Path 2: JWT auth
  const token = getAuthToken(request);
  if (token) {
    return authorizeJwt(token, request);
  }

  return null;
}

/**
 * Resolve team context without full authorization.
 * Used when we need teamId before full auth (e.g., connector resolution).
 */
export function extractTeamContext(request: Request): TeamContext | null {
  const teamId = request.headers.get('x-team-id');
  if (teamId) {
    return { teamId };
  }
  return null;
}

// ── JWT Auth ──

async function authorizeJwt(token: string, request: Request): Promise<AuthResult | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    const meResponse = await fetch(`${BASE_SVC_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!meResponse.ok) return null;

    const me = await meResponse.json();
    const userId = me.data?.id || me.id;
    if (!userId) return null;

    const teamId = request.headers.get('x-team-id');
    if (!teamId) return null;

    return {
      authenticated: true,
      callerType: 'jwt',
      callerId: userId,
      teamId,
    };
  } catch {
    return null;
  }
}

// ── API Key Auth ──

async function authorizeApiKey(rawKey: string): Promise<AuthResult | null> {
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const apiKey = await prisma.gatewayApiKey.findUnique({
    where: { keyHash },
    include: {
      plan: true,
    },
  });

  if (!apiKey) return null;
  if (apiKey.status !== 'active') return null;

  // Check expiry
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null;
  }

  // Update last used (fire-and-forget)
  prisma.gatewayApiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  const resolvedTeamId = apiKey.teamId
    ?? (apiKey.ownerUserId ? `personal:${apiKey.ownerUserId}` : '');

  return {
    authenticated: true,
    callerType: 'apiKey',
    callerId: apiKey.createdBy,
    teamId: resolvedTeamId,
    apiKeyId: apiKey.id,
    connectorId: apiKey.connectorId || undefined,
    planId: apiKey.planId || undefined,
    allowedEndpoints: apiKey.allowedEndpoints.length > 0 ? apiKey.allowedEndpoints : undefined,
    allowedIPs: apiKey.allowedIPs.length > 0 ? apiKey.allowedIPs : undefined,
    rateLimit: apiKey.plan?.rateLimit,
    dailyQuota: apiKey.plan?.dailyQuota,
    monthlyQuota: apiKey.plan?.monthlyQuota,
    maxRequestSize: apiKey.plan?.maxRequestSize,
  };
}

/**
 * Verify the caller has access to the resolved connector.
 *
 * Three visibility modes:
 *   - **public**: any authenticated caller can access.
 *   - **private / team** with ownerUserId: only the owning user may access.
 *   - **private / team** with teamId: caller's auth.teamId must match.
 */
export function verifyConnectorAccess(
  auth: AuthResult,
  connectorId: string,
  connectorTeamId: string | null,
  connectorOwnerUserId: string | null,
  visibility: string
): boolean {
  if (visibility === 'public') return true;
  if (connectorOwnerUserId) {
    return auth.callerId === connectorOwnerUserId;
  }
  if (connectorTeamId) {
    return auth.teamId === connectorTeamId;
  }
  return false;
}
