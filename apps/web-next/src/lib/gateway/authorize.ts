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
import { getAuthToken, getClientIP } from '@/lib/api/response';
import { personalScopeId, isPersonalScope } from './scope';
import type { AuthResult, TeamContext } from './types';

type RateLimiter = { consume: (key: string, points?: number) => Promise<{ allowed: boolean }> };
let _authFailLimiter: RateLimiter | null = null;

async function getAuthFailLimiter(): Promise<RateLimiter> {
  if (!_authFailLimiter) {
    try {
      const { createRateLimiter } = await import('@naap/cache/rateLimiter');
      _authFailLimiter = createRateLimiter({
        points: 10,
        duration: 60,
        blockDuration: 300,
        keyPrefix: 'gw:auth:fail',
      });
    } catch {
      _authFailLimiter = { consume: async () => ({ allowed: true }) };
    }
  }
  return _authFailLimiter;
}

/**
 * Extract team context from the request.
 * Returns null if no valid auth is found.
 */
export async function authorize(request: Request): Promise<AuthResult | null> {
  const authHeader = request.headers.get('authorization') || '';

  // Path 1: API Key auth (gw_ prefix)
  if (authHeader.startsWith('Bearer gw_')) {
    const clientIP = getClientIP(request) || 'unknown';
    const limiter = await getAuthFailLimiter();
    const rl = await limiter.consume(clientIP, 0);
    if (!rl.allowed) return null;

    const result = await authorizeApiKey(authHeader.slice(7)); // strip "Bearer "
    if (!result) {
      await limiter.consume(clientIP);
    }
    return result;
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

    const headerTeamId = request.headers.get('x-team-id');
    let teamId: string;

    if (headerTeamId) {
      if (isPersonalScope(headerTeamId)) {
        const scopeUserId = headerTeamId.slice('personal:'.length);
        if (scopeUserId !== user.id) {
          return null;
        }
      }
      teamId = headerTeamId;
    } else {
      teamId = personalScopeId(user.id);
    }

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

  const resolvedTeamId = apiKey.teamId
    ?? (apiKey.ownerUserId ? personalScopeId(apiKey.ownerUserId) : null);

  if (!resolvedTeamId) return null;

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
