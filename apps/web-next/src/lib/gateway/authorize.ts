/**
 * Service Gateway — Authorization
 *
 * Dual-path auth:
 * 1. JWT (NaaP plugins) — Bearer token + x-team-id header
 * 2. API Key (external consumers) — gw_xxx key in Authorization header
 *
 * Team isolation: a key from Team A cannot access Team B's connectors.
 */

import { createHash, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken, getClientIP } from '@/lib/api/response';
import { isFeatureEnabled, SDK_CONNECTOR_FLAG } from '@/lib/feature-flags';
import { parseApiKey, hashApiKey } from '@naap/database';
import { personalScopeId, isPersonalScope } from './scope';
import { getOrCreateDefaultPlan } from './default-plan';
import { matchIPAllowlist } from './types';
import type { AuthResult, TeamContext } from './types';

/**
 * Feature flag (default OFF) gating NAAP-5 behaviour: the public `sdk` connector
 * seed AND acceptance of native `naap_` keys at this gateway authorize step.
 * With the flag OFF, a `Bearer naap_…` key is rejected here exactly as today
 * (it would otherwise fall through to the JWT path and fail session validation).
 *
 * Re-exported from the flag registry ({@link SDK_CONNECTOR_FLAG}) so the key has
 * a single source of truth.
 */
export { SDK_CONNECTOR_FLAG };

/** Native `naap_` key prefix (matches @naap/database parseApiKey). */
const NATIVE_KEY_BEARER_PREFIX = 'Bearer naap_';

/**
 * Constant-time fallback hash used when no DevApiKey row matches the presented
 * lookup ID. Verifying against this dummy keeps the scrypt work identical for
 * "unknown lookup ID" and "wrong secret", so response timing cannot be used to
 * enumerate which `keyLookupId`s exist.
 */
const FALLBACK_NATIVE_KEY_HASH = hashApiKey(
  'naap_0000000000000000_000000000000000000000000000000000000000000000000',
);

function logAuth(level: 'info' | 'warn', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, component: 'gateway.authorize', ...fields });
  if (level === 'warn') console.warn(line);
  else console.info(line);
}

/**
 * Constant-time comparison of a presented native key against a stored scrypt
 * hash (mirrors `@/lib/dev-api/native-key#verifyNativeKeyHash`, inlined here to
 * avoid pulling the server-only billing registry into the gateway bundle).
 */
function verifyNativeKeyHash(rawKey: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const actual = Buffer.from(hashApiKey(rawKey), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

type RateLimiter = { consume: (key: string, points?: number) => Promise<{ allowed: boolean }> };
let _authFailLimiter: RateLimiter | null = null;

async function getAuthFailLimiter(): Promise<RateLimiter> {
  if (!_authFailLimiter) {
    try {
      const { createRateLimiter } = await import('@naap/cache');
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

  // Path 0: Master Key auth (gwm_ prefix)
  if (authHeader.startsWith('Bearer gwm_')) {
    const clientIP = getClientIP(request) || 'unknown';
    const limiter = await getAuthFailLimiter();
    const rl = await limiter.consume(clientIP, 0);
    if (!rl.allowed) return null;

    const result = await authorizeMasterKey(authHeader.slice(7), clientIP); // strip "Bearer "
    if (!result) {
      await limiter.consume(clientIP);
    }
    return result;
  }

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

  // Path 1.5: Native NaaP key auth (naap_ prefix) — NAAP-5, flag-gated.
  // OFF (default): reject here so behaviour is identical to today (a naap_ key
  // would otherwise fall through to the JWT path and fail session validation →
  // 401). ON: resolve the native key via the DevApiKey path so an app holding a
  // naap_ key can authorize against PUBLIC connectors (e.g. the `sdk` connector).
  if (authHeader.startsWith(NATIVE_KEY_BEARER_PREFIX)) {
    if (!(await isFeatureEnabled(SDK_CONNECTOR_FLAG))) {
      logAuth('warn', 'native_key.rejected_flag_off', {});
      return null;
    }
    const clientIP = getClientIP(request) || 'unknown';
    const limiter = await getAuthFailLimiter();
    const rl = await limiter.consume(clientIP, 0);
    if (!rl.allowed) return null;

    const result = await authorizeNativeKey(authHeader.slice(7)); // strip "Bearer "
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
      } else {
        const membership = await prisma.teamMember.findFirst({
          where: { teamId: headerTeamId, userId: user.id },
          select: { id: true },
        });
        if (!membership) return null;
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

// ── Master Key Auth ──

async function authorizeMasterKey(rawKey: string, clientIP: string): Promise<AuthResult | null> {
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const masterKey = await prisma.gatewayMasterKey.findUnique({
    where: { keyHash },
  });

  if (!masterKey) return null;
  if (masterKey.status !== 'active') return null;

  if (masterKey.expiresAt && masterKey.expiresAt < new Date()) {
    return null;
  }

  const scopes = (masterKey.scopes as string[]) || [];
  const allowedIPs = (masterKey.allowedIPs as string[]) || [];

  if (allowedIPs.length > 0 && !matchIPAllowlist(clientIP, allowedIPs)) {
    return null;
  }

  // Update last used (fire-and-forget)
  prisma.gatewayMasterKey
    .update({
      where: { id: masterKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  const resolvedTeamId = masterKey.teamId
    ?? (masterKey.ownerUserId ? personalScopeId(masterKey.ownerUserId) : null);

  if (!resolvedTeamId) return null;

  return {
    authenticated: true,
    callerType: 'masterKey',
    callerId: masterKey.createdBy,
    teamId: resolvedTeamId,
    isMasterKey: true,
    masterKeyScopes: scopes,
    ...(allowedIPs.length > 0 ? { allowedIPs } : {}),
  };
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

  let rateLimit = apiKey.plan?.rateLimit;
  let dailyQuota = apiKey.plan?.dailyQuota;
  let monthlyQuota = apiKey.plan?.monthlyQuota;
  let maxRequestSize = apiKey.plan?.maxRequestSize;

  if (!apiKey.planId) {
    try {
      const defaults = await getOrCreateDefaultPlan(resolvedTeamId);
      rateLimit = defaults.rateLimit;
      dailyQuota = defaults.dailyQuota;
      monthlyQuota = defaults.monthlyQuota;
      maxRequestSize = defaults.maxRequestSize;
    } catch {
      // Fall through — policy.ts hardcoded fallback still applies
    }
  }

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
    rateLimit,
    dailyQuota,
    monthlyQuota,
    maxRequestSize,
  };
}

// ── Native NaaP Key Auth (naap_) — NAAP-5 ──

/**
 * Authorize a native `naap_` key at the gateway (flag-gated by the caller).
 *
 * Resolves the key through the existing DevApiKey path (blind-index lookup by
 * `keyLookupId` + constant-time hash verify), then maps it to the caller's
 * scope: a seat/team-bound key uses its `teamId`; otherwise the personal scope
 * of the key's `userId`. The returned `nativeKey` caller can then authorize
 * against PUBLIC connectors via {@link verifyConnectorAccess}.
 *
 * Capability/quota enforcement remains at the `/api/v1/keys/validate` front door
 * (NAAP-C/E); at the gateway the key is only authenticated and scoped, and
 * public-connector access is governed by visibility (any authenticated caller).
 */
async function authorizeNativeKey(rawKey: string): Promise<AuthResult | null> {
  const parsed = parseApiKey(rawKey);
  if (!parsed) {
    logAuth('warn', 'native_key.malformed', {});
    return null;
  }

  const key = await prisma.devApiKey.findUnique({
    where: { keyLookupId: parsed.lookupId },
    select: { id: true, userId: true, keyHash: true, status: true, seatId: true, teamId: true },
  });

  // Constant-time hash check. Always run the scrypt verify — against the real
  // stored hash when the row exists, otherwise a fixed fallback — so the work
  // (and thus response timing) is identical whether the lookup ID is unknown or
  // the secret simply mismatches. This prevents keyLookupId enumeration.
  const hashMatches = verifyNativeKeyHash(rawKey, key?.keyHash ?? FALLBACK_NATIVE_KEY_HASH);
  if (!key || !hashMatches) {
    logAuth('warn', 'native_key.not_found_or_mismatch', {});
    return null;
  }
  if (key.status !== 'ACTIVE') {
    logAuth('warn', 'native_key.inactive', { keyId: key.id, status: key.status });
    return null;
  }

  const teamId = key.teamId ?? personalScopeId(key.userId);

  // Fire-and-forget last-used update; never block authorization on it.
  prisma.devApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  logAuth('info', 'native_key.authorized', {
    keyId: key.id,
    scope: key.teamId ? 'team' : 'personal',
  });

  return {
    authenticated: true,
    callerType: 'nativeKey',
    callerId: key.userId,
    teamId,
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
