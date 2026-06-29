/**
 * Cancel / deactivate a subscription (NAAP P3).
 *
 *   DELETE /api/v1/teams/{teamId}/subscriptions/{subId}
 *
 * Flips `Subscription.status → canceled`. Cancellation fails closed for the
 * per-key resolver (P2): a non-active subscription resolves to the legacy path,
 * never a hard error. Keys linked to the subscription keep working via the
 * legacy fallback (they are NOT auto-revoked here — revoke keys explicitly).
 *
 * Tenant-scoped: team admin only (mirrors create). Gated behind
 * `multi_subscription` (default OFF): 404 when OFF (no-op).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { validateCSRF } from '@/lib/api/csrf';
import { isFeatureEnabled, MULTI_SUBSCRIPTION_FLAG } from '@/lib/feature-flags';
import {
  SUBSCRIPTION_STATUS_CANCELED,
  isCancelableStatus,
} from '@/lib/billing/subscription-catalog';

interface RouteParams {
  params: Promise<{ teamId: string; subId: string }>;
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

export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
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
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      return mapAccessError(err);
    }

    // Tenant isolation: the subscription must belong to THIS team.
    const subscription = await prisma.subscription.findFirst({
      where: { id: subId, teamId },
      select: { id: true, status: true },
    });
    if (!subscription) return noStore(errors.notFound('Subscription'));

    if (!isCancelableStatus(subscription.status)) {
      // Already canceled → idempotent success (no state change).
      return noStore(success({ subscriptionId: subId, status: subscription.status, canceled: true }));
    }

    await prisma.subscription.update({
      where: { id: subId },
      data: { status: SUBSCRIPTION_STATUS_CANCELED },
    });

    log('info', 'subscriptions.cancel', { teamId, correlationId, subscriptionId: subId });
    return noStore(success({ subscriptionId: subId, status: SUBSCRIPTION_STATUS_CANCELED, canceled: true }));
  } catch (err) {
    log('error', 'subscriptions.cancel.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to cancel subscription'));
  }
}
