/**
 * Single Team Seat API (NAAP-1).
 *
 *   GET    /api/v1/teams/{teamId}/seats/{seatId}   — read a seat (viewer+)
 *   PATCH  /api/v1/teams/{teamId}/seats/{seatId}   — update role/keyLimit/status (admin+)
 *   DELETE /api/v1/teams/{teamId}/seats/{seatId}   — revoke/remove a seat (admin+)
 *
 * Gated behind the `team_seats` flag (default OFF): 404 when OFF (no-op).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { TEAM_SEATS_FLAG } from '@/lib/teams/billing-account-ref';
import { isSeatRole, isSeatStatus, normalizeKeyLimit } from '@/lib/teams/seats';

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

const SEAT_SELECT = {
  id: true,
  teamId: true,
  userId: true,
  email: true,
  role: true,
  status: true,
  keyLimit: true,
  invitedBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(TEAM_SEATS_FLAG))) return noStore(errors.notFound('Resource'));

    const { teamId, seatId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));
    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    try {
      await validateTeamAccess(user.id, teamId, 'viewer');
    } catch (err) {
      return mapAccessError(err);
    }

    const seat = await prisma.seat.findFirst({ where: { id: seatId, teamId }, select: SEAT_SELECT });
    if (!seat) return noStore(errors.notFound('Seat'));

    return noStore(success({ seat }));
  } catch (err) {
    log('error', 'team.seat.get.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to read seat'));
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(TEAM_SEATS_FLAG))) return noStore(errors.notFound('Resource'));

    const { teamId, seatId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));

    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return noStore(csrfError);

    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    try {
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      return mapAccessError(err);
    }

    const existing = await prisma.seat.findFirst({ where: { id: seatId, teamId }, select: { id: true } });
    if (!existing) return noStore(errors.notFound('Seat'));

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return noStore(errors.badRequest('Invalid JSON in request body'));
    }

    const data: { role?: string; status?: string; keyLimit?: number } = {};
    if (body.role !== undefined) {
      if (!isSeatRole(body.role)) return noStore(errors.badRequest('Invalid role'));
      data.role = body.role;
    }
    if (body.status !== undefined) {
      if (!isSeatStatus(body.status)) return noStore(errors.badRequest('Invalid status'));
      data.status = body.status;
    }
    if (body.keyLimit !== undefined) {
      const normalized = normalizeKeyLimit(body.keyLimit);
      if (normalized === null) return noStore(errors.badRequest('Invalid keyLimit'));
      data.keyLimit = normalized;
    }
    if (Object.keys(data).length === 0) {
      return noStore(errors.badRequest('No updatable fields provided'));
    }

    const seat = await prisma.seat.update({ where: { id: seatId }, data, select: SEAT_SELECT });
    log('info', 'team.seat.update', { teamId, correlationId, seatId, fields: Object.keys(data) });
    return noStore(success({ seat }));
  } catch (err) {
    log('error', 'team.seat.update.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to update seat'));
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(TEAM_SEATS_FLAG))) return noStore(errors.notFound('Resource'));

    const { teamId, seatId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));

    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return noStore(csrfError);

    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    try {
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      return mapAccessError(err);
    }

    const existing = await prisma.seat.findFirst({ where: { id: seatId, teamId }, select: { id: true } });
    if (!existing) return noStore(errors.notFound('Seat'));

    // Revoke (soft) so any keys remain auditable; status flips to revoked.
    const seat = await prisma.seat.update({
      where: { id: seatId },
      data: { status: 'revoked' },
      select: SEAT_SELECT,
    });
    log('info', 'team.seat.revoke', { teamId, correlationId, seatId });
    return noStore(success({ seat }));
  } catch (err) {
    log('error', 'team.seat.revoke.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to revoke seat'));
  }
}
