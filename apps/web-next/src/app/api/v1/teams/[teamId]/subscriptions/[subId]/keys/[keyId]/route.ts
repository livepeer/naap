/**
 * Revoke a subscription-bound native `naap_` key (NAAP P3).
 *
 *   DELETE /api/v1/teams/{teamId}/subscriptions/{subId}/keys/{keyId}
 *
 * Revocation flips status → REVOKED, invalidating the key INSTANTLY (the P2
 * resolver rejects any non-ACTIVE key before a provider call). Tenant-scoped:
 * the key must belong to this team + subscription; a team member may revoke
 * their own key, an admin any key. Gated behind `multi_subscription`
 * (default OFF): 404 when OFF (no-op).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { validateCSRF } from '@/lib/api/csrf';
import { isFeatureEnabled, MULTI_SUBSCRIPTION_FLAG } from '@/lib/feature-flags';

interface RouteParams {
  params: Promise<{ teamId: string; subId: string; keyId: string }>;
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

    const { teamId, subId, keyId } = await params;
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

    // Tenant isolation: the key must belong to this team + subscription.
    const key = await prisma.devApiKey.findFirst({
      where: { id: keyId, teamId, subscriptionId: subId },
      select: { id: true, status: true, userId: true },
    });
    if (!key) return noStore(errors.notFound('Key'));

    // Members may revoke their own key; otherwise admin is required.
    if (key.userId !== user.id) {
      try {
        await validateTeamAccess(user.id, teamId, 'admin');
      } catch (err) {
        return mapAccessError(err);
      }
    }

    if (key.status !== 'REVOKED') {
      await prisma.devApiKey.update({
        where: { id: keyId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
    }

    log('info', 'subscription_key.revoke', { teamId, correlationId, keyId, subscriptionId: subId });
    return noStore(success({ revoked: true, keyId }));
  } catch (err) {
    log('error', 'subscription_key.revoke.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to revoke key'));
  }
}
