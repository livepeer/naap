/**
 * Native `naap_` keys for a seat (NAAP-B).
 *
 *   GET  /api/v1/teams/{teamId}/seats/{seatId}/keys   — list a seat's native keys (member/owner+admin)
 *   POST /api/v1/teams/{teamId}/seats/{seatId}/keys    — mint a native key for the seat
 *
 * The minted key is provider-OPAQUE (`naap_…`); it maps server-side to the
 * provider that backs the team's billing account (NAAP-1 billingAccountRef →
 * adapter, NAAP-A). Apps never receive provider tokens/URLs. The raw key is
 * returned exactly once at creation.
 *
 * Gated behind the `native_keys` flag (default OFF): 404 when OFF (no-op).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { encrypt } from '@/lib/gateway/encryption';
import { deriveKeyLookupId, formatBillingKeyPublicPrefix, hashApiKey } from '@naap/database';
import { teamBillingAccountRef } from '@/lib/teams/billing-account-ref';
import { getBillingProviderAdapter } from '@/lib/billing/registry';
import { seatCanMintKey } from '@/lib/teams/seats';
import { NATIVE_KEYS_FLAG, generateNativeApiKey } from '@/lib/dev-api/native-key';

interface RouteParams {
  params: Promise<{ teamId: string; seatId: string }>;
}

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

const SAFE_KEY_SELECT = {
  id: true,
  keyPrefix: true,
  label: true,
  status: true,
  seatId: true,
  teamId: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

/**
 * Authorize the caller for this seat: a team member acting on THEIR OWN seat,
 * or a team admin acting on any seat. Returns null on success or an error
 * response. Loads the seat (scoped to the team) as a side benefit.
 */
async function authorizeSeatAction(
  userId: string,
  teamId: string,
  seatId: string,
): Promise<{ error: NextResponse } | { seat: { id: string; userId: string | null; status: string; keyLimit: number } }> {
  try {
    await validateTeamAccess(userId, teamId, 'member');
  } catch (err) {
    return { error: mapAccessError(err) };
  }
  const seat = await prisma.seat.findFirst({
    where: { id: seatId, teamId },
    select: { id: true, userId: true, status: true, keyLimit: true },
  });
  if (!seat) return { error: noStore(errors.notFound('Seat')) };

  if (seat.userId !== userId) {
    // Acting on someone else's seat requires admin.
    try {
      await validateTeamAccess(userId, teamId, 'admin');
    } catch (err) {
      return { error: mapAccessError(err) };
    }
  }
  return { seat };
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(NATIVE_KEYS_FLAG))) return noStore(errors.notFound('Resource'));

    const { teamId, seatId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));
    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    const authz = await authorizeSeatAction(user.id, teamId, seatId);
    if ('error' in authz) return authz.error;

    const keys = await prisma.devApiKey.findMany({
      where: { seatId, teamId },
      orderBy: { createdAt: 'desc' },
      select: SAFE_KEY_SELECT,
    });
    return noStore(success({ keys }));
  } catch (err) {
    log('error', 'native_key.list.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to list keys'));
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(NATIVE_KEYS_FLAG))) return noStore(errors.notFound('Resource'));

    const { teamId, seatId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));

    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;

    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    const authz = await authorizeSeatAction(user.id, teamId, seatId);
    if ('error' in authz) return authz.error;
    const { seat } = authz;

    // Seat must be active and within its per-seat key limit (NAAP-1).
    const activeKeyCount = await prisma.devApiKey.count({
      where: { seatId, status: 'ACTIVE' },
    });
    if (!seatCanMintKey(seat, activeKeyCount)) {
      return noStore(errors.forbidden('Seat is not active or has reached its key limit'));
    }

    // Resolve the team's billing binding → provider (stays generic).
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, billingAccountProviderSlug: true, billingAccountId: true },
    });
    const ref = team ? teamBillingAccountRef(team) : null;
    if (!ref) {
      return noStore(errors.badRequest('Team is not bound to a billing account (set billingAccountRef first)'));
    }
    const adapter = getBillingProviderAdapter(ref.providerSlug);
    if (!adapter) {
      return noStore(errors.badRequest(`Unknown billing provider "${ref.providerSlug}"`));
    }
    // DevApiKey requires a BillingProvider row (FK). Native keys mint only for
    // providers present in the registry AND seeded as a BillingProvider.
    const provider = await prisma.billingProvider.findUnique({
      where: { slug: ref.providerSlug },
      select: { id: true, enabled: true },
    });
    if (!provider || !provider.enabled) {
      return noStore(errors.badRequest(`Billing provider "${ref.providerSlug}" is not enabled for key minting`));
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // Body is optional (label only); ignore parse errors → no label.
    }
    const label =
      typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : null;

    const { rawKey } = generateNativeApiKey();
    const keyLookupId = deriveKeyLookupId(rawKey);
    const keyPrefix = formatBillingKeyPublicPrefix(rawKey);
    const keyHash = hashApiKey(rawKey);
    // Store an encrypted, provider-opaque session ref (the account pointer this
    // key maps to). Never store/return the provider token itself.
    const sessionRef = encrypt(ref.accountId);

    const created = await prisma.devApiKey.create({
      data: {
        userId: user.id,
        billingProviderId: provider.id,
        seatId,
        teamId,
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
    log('info', 'native_key.mint', {
      teamId,
      seatId,
      correlationId,
      keyId: created.id,
      providerSlug: ref.providerSlug,
    });

    return noStore(
      success({
        key: created,
        rawKey,
        warning: 'Store this key securely. It is provider-opaque and will not be shown again.',
      }),
    );
  } catch (err) {
    log('error', 'native_key.mint.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to mint key'));
  }
}
