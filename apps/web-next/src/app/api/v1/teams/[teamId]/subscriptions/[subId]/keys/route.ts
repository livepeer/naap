/**
 * Native `naap_` keys for a SUBSCRIPTION (NAAP P3).
 *
 *   GET  /api/v1/teams/{teamId}/subscriptions/{subId}/keys   — list a subscription's keys
 *   POST /api/v1/teams/{teamId}/subscriptions/{subId}/keys    — mint a key bound to the subscription
 *
 * This is the developer-facing "mint a native key" path the env-build worker
 * found missing a UI for. It extends the seat-keys mint flow: the minted key is
 * provider-opaque (`naap_…`) and additionally carries `subscriptionId`, so the
 * P2 per-key resolver hops key → subscription → provider instance + account.
 * The raw key is returned exactly once.
 *
 * Tenant-scoped: caller must be a team member acting through THEIR OWN active
 * seat (mints require a TeamMember/seat row); per-seat key limits still apply.
 * Gated behind `multi_subscription` (default OFF): 404 when OFF (no-op). Never
 * logs/returns the raw key, hash, accountId, or session ref.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { validateCSRF } from '@/lib/api/csrf';
import { isFeatureEnabled, MULTI_SUBSCRIPTION_FLAG } from '@/lib/feature-flags';
import { encrypt } from '@/lib/gateway/encryption';
import { deriveKeyLookupId, formatBillingKeyPublicPrefix, hashApiKey } from '@naap/database';
import { seatCanMintKey } from '@/lib/teams/seats';
import { generateNativeApiKey } from '@/lib/dev-api/native-key';
import { SUBSCRIPTION_STATUS_ACTIVE } from '@/lib/billing/subscription-catalog';

interface RouteParams {
  params: Promise<{ teamId: string; subId: string }>;
}

const SAFE_KEY_SELECT = {
  id: true,
  keyPrefix: true,
  label: true,
  status: true,
  seatId: true,
  teamId: true,
  subscriptionId: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function correlationIdOf(request: NextRequest): string {
  return request.headers.get('x-request-id')?.trim() || randomUUID();
}

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

function mapAccessError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : 'Access error';
  if (message.includes('not found')) return noStore(errors.notFound('Team'));
  if (message.includes('Not a member') || message.includes('Requires') || message.includes('role')) {
    return noStore(errors.forbidden(message));
  }
  return noStore(errors.internal(message));
}

/** Load a subscription scoped to the team (tenant isolation), or null. */
async function loadTeamSubscription(teamId: string, subId: string) {
  return prisma.subscription.findFirst({
    where: { id: subId, teamId },
    select: { id: true, providerInstanceId: true, accountId: true, status: true },
  });
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(MULTI_SUBSCRIPTION_FLAG, (await params).teamId))) return noStore(errors.notFound('Resource'));

    const { teamId, subId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));
    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    try {
      await validateTeamAccess(user.id, teamId, 'member');
    } catch (err) {
      return mapAccessError(err);
    }

    const subscription = await loadTeamSubscription(teamId, subId);
    if (!subscription) return noStore(errors.notFound('Subscription'));

    const keys = await prisma.devApiKey.findMany({
      where: { subscriptionId: subId, teamId },
      orderBy: { createdAt: 'desc' },
      select: SAFE_KEY_SELECT,
    });
    return noStore(success({ keys }));
  } catch (err) {
    log('error', 'subscription_key.list.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to list keys'));
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(MULTI_SUBSCRIPTION_FLAG, (await params).teamId))) return noStore(errors.notFound('Resource'));

    const { teamId, subId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));

    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;

    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    try {
      await validateTeamAccess(user.id, teamId, 'member');
    } catch (err) {
      return mapAccessError(err);
    }

    const subscription = await loadTeamSubscription(teamId, subId);
    if (!subscription) return noStore(errors.notFound('Subscription'));
    if (subscription.status !== SUBSCRIPTION_STATUS_ACTIVE) {
      return noStore(errors.badRequest('Subscription is not active'));
    }

    // The caller mints through THEIR OWN active seat in this team.
    const seat = await prisma.seat.findFirst({
      where: { teamId, userId: user.id, status: 'active' },
      select: { id: true, userId: true, status: true, keyLimit: true },
    });
    if (!seat) return noStore(errors.forbidden('No active seat in this team'));

    const activeKeyCount = await prisma.devApiKey.count({
      where: { seatId: seat.id, status: 'ACTIVE' },
    });
    if (!seatCanMintKey(seat, activeKeyCount)) {
      return noStore(errors.forbidden('Seat is not active or has reached its key limit'));
    }

    // The subscription's provider instance → adapterType → BillingProvider FK.
    const instance = await prisma.providerInstance.findUnique({
      where: { id: subscription.providerInstanceId },
      select: { id: true, adapterType: true, enabled: true },
    });
    if (!instance || !instance.enabled) {
      return noStore(errors.badRequest('Subscription provider instance is unavailable'));
    }
    const provider = await prisma.billingProvider.findUnique({
      where: { slug: instance.adapterType },
      select: { id: true, enabled: true },
    });
    if (!provider || !provider.enabled) {
      return noStore(errors.badRequest(`Billing provider "${instance.adapterType}" is not enabled for key minting`));
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // Body is optional (label only).
    }
    const label =
      typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : null;

    const { rawKey } = generateNativeApiKey();
    const keyLookupId = deriveKeyLookupId(rawKey);
    const keyPrefix = formatBillingKeyPublicPrefix(rawKey);
    const keyHash = hashApiKey(rawKey);
    // Store the encrypted, provider-opaque account pointer (the subscription's
    // accountId). Never store/return the provider token itself.
    const sessionRef = encrypt(subscription.accountId);

    const created = await prisma.devApiKey.create({
      data: {
        userId: user.id,
        billingProviderId: provider.id,
        seatId: seat.id,
        teamId,
        subscriptionId: subscription.id,
        keyLookupId,
        keyPrefix,
        keyHash,
        label,
        status: 'ACTIVE',
        providerSessionRefEnc: sessionRef.encryptedValue,
        providerSessionRefIv: sessionRef.iv,
      },
      select: SAFE_KEY_SELECT,
    });

    // Never log the raw key, hash, accountId, or session ref — slug + ids only.
    log('info', 'subscription_key.mint', {
      teamId,
      correlationId,
      keyId: created.id,
      subscriptionId: subscription.id,
      providerInstanceId: subscription.providerInstanceId,
      adapterType: instance.adapterType,
    });

    return noStore(
      success({
        key: created,
        rawKey,
        warning: 'Store this key securely. It is provider-opaque and will not be shown again.',
      }),
    );
  } catch (err) {
    log('error', 'subscription_key.mint.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to mint key'));
  }
}
