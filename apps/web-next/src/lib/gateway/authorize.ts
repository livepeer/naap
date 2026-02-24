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
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import type { AuthResult, TeamContext } from './types';

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
    // Validate session directly against the database using the shell's
    // shared auth utility — no HTTP round-trip to base-svc required.
    const user = await validateSession(token);
    if (!user) return null;

    // Team context from x-team-id header, or personal scope fallback
    const teamId = request.headers.get('x-team-id') || `personal:${user.id}`;

    return {
      authenticated: true,
      callerType: 'jwt',
      callerId: user.id,
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

  return {
    authenticated: true,
    callerType: 'apiKey',
    callerId: apiKey.createdBy,
    teamId: apiKey.teamId,
    apiKeyId: apiKey.id,
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
 * If the API key is scoped to a specific connector, verify it matches.
 *
 * When the caller is in personal context (no x-team-id header), the
 * resolveConfig fallback may have found a connector via team membership.
 * In this case, the auth.teamId is `personal:<userId>` but the connector
 * belongs to a team the user is a member of. We verify membership here
 * rather than blindly rejecting the mismatch.
 */
export async function verifyConnectorAccess(
  auth: AuthResult,
  connectorId: string,
  connectorTeamId: string
): Promise<boolean> {
  // Exact match — caller explicitly specified the correct team
  if (auth.teamId === connectorTeamId) return true;

  // Personal context fallback: verify team membership
  if (auth.callerType === 'jwt' && auth.teamId.startsWith('personal:')) {
    const userId = auth.teamId.slice('personal:'.length);
    const membership = await prisma.teamMember.findFirst({
      where: { userId, teamId: connectorTeamId },
      select: { id: true },
    });
    if (membership) {
      // Promote auth to the connector's team for this request
      auth.teamId = connectorTeamId;
      return true;
    }
  }

  return false;
}
