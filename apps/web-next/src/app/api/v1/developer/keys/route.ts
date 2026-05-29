/**
 * Developer API Keys Routes
 * GET /api/v1/developer/keys - List user's API keys
 * POST /api/v1/developer/keys - Create new API key (provider-issued key via OAuth)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken, parsePagination } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
import {
  DevApiProjectResolutionError,
  resolveDevApiProjectId,
  deriveKeyLookupId,
  formatBillingKeyPublicPrefix,
  hashApiKey,
} from '@naap/database';
import {
  computeSignerSessionExpiry,
  decodeJwtExp,
  isLikelyOidcJwt,
  SIGNER_SESSION_TTL_MS,
} from '@pymthouse/builder-sdk/tokens';

const PYMTHOUSE_PROVIDER_SLUG = 'pymthouse';

// Throttle window for opportunistic cleanup off the GET path. We must not
// run a database delete on every list request — GETs should be safe per
// HTTP semantics, and an unthrottled delete on every read produces
// unpredictable response times, non-atomic delete+findMany ordering
// surprises, and elevated connection use under load. A scheduled cron
// (`/api/cron/cleanup-expired-keys` behind `CRON_SECRET`) should own the
// authoritative cleanup; this fallback only fires at most once per
// process per window, and only if we haven't seen a cleanup recently.
const EXPIRED_KEY_CLEANUP_THROTTLE_MS = 15 * 60 * 1000;
let lastExpiredKeyCleanupAt = 0;

async function maybeCleanupExpiredPymthouseKeys(userId: string): Promise<void> {
  const now = Date.now();
  if (now - lastExpiredKeyCleanupAt < EXPIRED_KEY_CLEANUP_THROTTLE_MS) {
    return;
  }
  lastExpiredKeyCleanupAt = now;

  const expiryCutoff = new Date(now - SIGNER_SESSION_TTL_MS);
  try {
    await prisma.devApiKey.deleteMany({
      where: {
        userId,
        billingProvider: { slug: PYMTHOUSE_PROVIDER_SLUG },
        OR: [
          { status: 'ACTIVE', createdAt: { lte: expiryCutoff } },
          { status: 'EXPIRED' },
        ],
      },
    });
  } catch (err) {
    // Cleanup is best-effort. Never let a failure here break the read path.
    console.warn('[developer/keys] Background expired-key cleanup failed:', err);
  }
}

function isExpiredPymthouseKey(key: {
  status: string;
  createdAt: Date;
  billingProvider?: { slug?: string | null } | null;
}): boolean {
  if (key.billingProvider?.slug !== PYMTHOUSE_PROVIDER_SLUG) return false;
  if (key.status === 'EXPIRED') return true;
  if (key.status !== 'ACTIVE') return false;
  return computeSignerSessionExpiry(key.createdAt).getTime() <= Date.now();
}

/**
 * Strip credential-derived material before returning a DevApiKey to the
 * client. `keyHash` is a scrypt hash of the raw API key and `keyLookupId`
 * is its blind-index — both should remain server-side only. The other
 * gateway/admin routes in this codebase already strip these; these
 * routes were missed during the initial PymtHouse review.
 */
function toSafeDevApiKey<
  T extends {
    keyHash?: unknown;
    keyLookupId?: unknown;
    createdAt: Date;
    billingProvider?: { slug?: string | null } | null;
  },
>(key: T): Omit<T, 'keyHash' | 'keyLookupId'> & { expiresAt: string | null } {
  const { keyHash: _keyHash, keyLookupId: _keyLookupId, ...rest } = key;
  return {
    ...rest,
    expiresAt:
      key.billingProvider?.slug === PYMTHOUSE_PROVIDER_SLUG
        ? computeSignerSessionExpiry(key.createdAt).toISOString()
        : null,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Fire-and-forget throttled cleanup so the read path remains fast and
    // mostly side-effect free; expired keys are filtered out of the
    // response regardless of whether cleanup ran this request.
    void maybeCleanupExpiredPymthouseKeys(user.id);

    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);

    const [keys, total] = await Promise.all([
      prisma.devApiKey.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip,
        include: {
          project: { select: { id: true, name: true, isDefault: true } },
          billingProvider: {
            select: {
              id: true,
              slug: true,
              displayName: true,
            },
          },
        },
      }),
      prisma.devApiKey.count({
        where: { userId: user.id },
      }),
    ]);

    const visibleKeys = keys
      .filter((key) => !isExpiredPymthouseKey(key))
      .map((key) => toSafeDevApiKey(key));

    return success(
      { keys: visibleKeys },
      {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      }
    );
  } catch (err) {
    console.error('API keys list error:', err);
    return errors.internal('Failed to list API keys');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Invalid JSON in request body');
    }

    const billingProviderId = body.billingProviderId as string | undefined;
    const rawApiKey = body.rawApiKey as string | undefined;
    const projectId = body.projectId as string | undefined;
    const projectName = body.projectName as string | undefined;
    const label = body.label as string | undefined;

    if (
      typeof billingProviderId !== 'string' ||
      billingProviderId.trim() === ''
    ) {
      return errors.badRequest('billingProviderId is required');
    }

    if (typeof rawApiKey !== 'string' || rawApiKey.trim() === '') {
      return errors.badRequest('rawApiKey is required');
    }

    const provider = await prisma.billingProvider.findUnique({
      where: { id: billingProviderId },
      select: { id: true, enabled: true, slug: true },
    });
    if (!provider || !provider.enabled) {
      return errors.badRequest('Invalid or disabled billing provider');
    }

    let resolvedProjectId: string;
    try {
      resolvedProjectId = await resolveDevApiProjectId({
        prisma,
        userId: user.id,
        projectId,
        projectName,
      });
    } catch (error) {
      if (error instanceof DevApiProjectResolutionError) {
        return errors.badRequest(error.message);
      }
      throw error;
    }

    const keyLookupId = deriveKeyLookupId(rawApiKey);
    const keyPrefix = formatBillingKeyPublicPrefix(rawApiKey);
    const keyHash = hashApiKey(rawApiKey);
    const resolvedLabel = label && typeof label === 'string' && label.trim() ? label.trim() : null;
    const pymthouseTokenExpiry =
      provider.slug === PYMTHOUSE_PROVIDER_SLUG && isLikelyOidcJwt(rawApiKey)
        ? decodeJwtExp(rawApiKey)
        : null;

    if (
      provider.slug === PYMTHOUSE_PROVIDER_SLUG &&
      pymthouseTokenExpiry &&
      pymthouseTokenExpiry.getTime() <= Date.now()
    ) {
      return errors.badRequest('PymtHouse token is already expired. Please create a new key.');
    }

    const apiKey = await prisma.devApiKey.create({
      data: {
        userId: user.id,
        projectId: resolvedProjectId,
        billingProviderId,
        keyLookupId,
        keyPrefix,
        keyHash,
        label: resolvedLabel,
        status: 'ACTIVE',
      },
    });

    return success({
      key: toSafeDevApiKey({
        ...apiKey,
        billingProvider: { slug: provider.slug },
      }),
      rawApiKey,
      warning:
        provider.slug === PYMTHOUSE_PROVIDER_SLUG
          ? 'Store this key securely. It expires after about 90 days and will not be shown again.'
          : 'Store this key securely. It will not be shown again.',
    });
  } catch (err) {
    console.error('Create API key error:', err);
    return errors.internal('Failed to create API key');
  }
}
