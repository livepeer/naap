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
import type { AuthResult, AuthenticatedAuthResult, TeamContext } from './types';

const BASE_SVC_URL = process.env.BASE_SVC_URL || process.env.NEXT_PUBLIC_BASE_SVC_URL || 'http://localhost:4000';

/**
 * Extract team context from the request.
 * Returns null if no valid auth is found.
 */
export async function authorize(request: Request): Promise<AuthenticatedAuthResult | null> {
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

async function authorizeJwt(token: string, request: Request): Promise<AuthenticatedAuthResult | null> {
  try {
    // Validate JWT via base-svc /api/v1/auth/me
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const meResponse = await fetch(`${BASE_SVC_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!meResponse.ok) return null;

    const me = await meResponse.json();
    const userId = me.data?.id || me.id;
    if (!userId) return null;

    // Team context from x-team-id header (set by NaaP shell)
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

async function authorizeApiKey(rawKey: string): Promise<AuthenticatedAuthResult | null> {
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

  return {
    authenticated: true,
    callerType: 'apiKey',
    callerId: apiKey.createdBy,
    teamId: apiKey.teamId,
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
 * Verify connector belongs to the caller's team.
 *
 * When the caller is in personal context (personal:<userId>), the resolver
 * may have found the connector via team membership. We verify membership
 * here and return the connector's owning teamId for downstream use.
 */
export async function verifyConnectorAccess(
  auth: AuthResult,
  connectorId: string,
  connectorTeamId: string
): Promise<{ allowed: boolean; resolvedTeamId: string }> {
  if (!auth.authenticated) return { allowed: false, resolvedTeamId: '' };

  if (auth.callerType === 'apiKey' && auth.connectorId && auth.connectorId !== connectorId) {
    return { allowed: false, resolvedTeamId: auth.teamId };
  }

  if (auth.teamId === connectorTeamId) {
    return { allowed: true, resolvedTeamId: connectorTeamId };
  }

  if (auth.callerType === 'jwt' && auth.teamId.startsWith('personal:')) {
    const userId = auth.callerId;
    const membership = await prisma.teamMember.findFirst({
      where: { userId, teamId: connectorTeamId },
      select: { id: true },
    });
    if (membership) {
      return { allowed: true, resolvedTeamId: connectorTeamId };
    }
  }

  return { allowed: false, resolvedTeamId: auth.teamId };
}
