/**
 * Revoke a native `naap_` key (NAAP-B).
 *
 *   DELETE /api/v1/teams/{teamId}/seats/{seatId}/keys/{keyId}
 *
 * Revocation flips status → REVOKED, which invalidates the key INSTANTLY:
 * `resolveNativeKeyToProviderSession` rejects any non-ACTIVE key before making a
 * provider call. (Key rotation = revoke here + POST a new key.)
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
import { NATIVE_KEYS_FLAG } from '@/lib/dev-api/native-key';

interface RouteParams {
  params: Promise<{ teamId: string; seatId: string; keyId: string }>;
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
    if (!(await isFeatureEnabled(NATIVE_KEYS_FLAG, (await params).teamId))) return noStore(errors.notFound('Resource'));

    const { teamId, seatId, keyId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));

    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;

    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    // Authorize: member acting on their own seat, or a team admin.
    try {
      await validateTeamAccess(user.id, teamId, 'member');
    } catch (err) {
      return mapAccessError(err);
    }
    const seat = await prisma.seat.findFirst({
      where: { id: seatId, teamId },
      select: { id: true, userId: true },
    });
    if (!seat) return noStore(errors.notFound('Seat'));
    if (seat.userId !== user.id) {
      try {
        await validateTeamAccess(user.id, teamId, 'admin');
      } catch (err) {
        return mapAccessError(err);
      }
    }

    const key = await prisma.devApiKey.findFirst({
      where: { id: keyId, seatId, teamId },
      select: { id: true, status: true },
    });
    if (!key) return noStore(errors.notFound('Key'));

    if (key.status !== 'REVOKED') {
      await prisma.devApiKey.update({
        where: { id: keyId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
    }

    log('info', 'native_key.revoke', { teamId, seatId, correlationId, keyId });
    return noStore(success({ revoked: true, keyId }));
  } catch (err) {
    log('error', 'native_key.revoke.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to revoke key'));
  }
}
