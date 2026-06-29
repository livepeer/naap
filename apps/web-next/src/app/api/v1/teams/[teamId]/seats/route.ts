/**
 * Team Seats API (NAAP-1).
 *
 *   GET  /api/v1/teams/{teamId}/seats   — list seats (viewer+)
 *   POST /api/v1/teams/{teamId}/seats   — invite / create a seat (admin+)
 *
 * Gated behind the `team_seats` flag (default OFF): when OFF this route is a
 * no-op (404), so no existing team behavior changes. Zero regression.
 *
 * Never logs secrets/PII — only ids + correlation id.
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
import {
  DEFAULT_SEAT_KEY_LIMIT,
  isSeatRole,
  normalizeKeyLimit,
  type SeatRole,
} from '@/lib/teams/seats';

interface RouteParams {
  params: Promise<{ teamId: string }>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** Map a thrown access error from validateTeamAccess to an HTTP response. */
function mapAccessError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : 'Access error';
  if (message.includes('not found')) return noStore(errors.notFound('Team'));
  if (
    message.includes('Not a member') ||
    message.includes('Requires') ||
    message.includes('role')
  ) {
    return noStore(errors.forbidden(message));
  }
  return noStore(errors.internal(message));
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(TEAM_SEATS_FLAG, (await params).teamId))) {
      return noStore(errors.notFound('Resource'));
    }

    const { teamId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));
    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    try {
      await validateTeamAccess(user.id, teamId, 'viewer');
    } catch (err) {
      return mapAccessError(err);
    }

    const seats = await prisma.seat.findMany({
      where: { teamId },
      orderBy: { createdAt: 'asc' },
      select: {
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
        user: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
      },
    });

    log('info', 'team.seats.list', { teamId, correlationId, count: seats.length });
    return noStore(success({ seats }));
  } catch (err) {
    log('error', 'team.seats.list.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to list seats'));
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(TEAM_SEATS_FLAG, (await params).teamId))) {
      return noStore(errors.notFound('Resource'));
    }

    const { teamId } = await params;
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

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return noStore(errors.badRequest('Invalid JSON in request body'));
    }

    const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined;
    const userIdRaw = typeof body.userId === 'string' ? body.userId.trim() : undefined;
    const roleRaw = typeof body.role === 'string' ? body.role : 'member';

    if (!emailRaw && !userIdRaw) {
      return noStore(errors.badRequest('Either email or userId is required'));
    }
    if (emailRaw && !EMAIL_RE.test(emailRaw)) {
      return noStore(errors.badRequest('Invalid email'));
    }
    if (!isSeatRole(roleRaw)) {
      return noStore(errors.badRequest('Invalid role. Must be admin, member, or viewer.'));
    }
    const role: SeatRole = roleRaw;

    let keyLimit = DEFAULT_SEAT_KEY_LIMIT;
    if (body.keyLimit !== undefined) {
      const normalized = normalizeKeyLimit(body.keyLimit);
      if (normalized === null) {
        return noStore(errors.badRequest('Invalid keyLimit'));
      }
      keyLimit = normalized;
    }

    // Resolve the target NaaP user (by id or email). When unknown, create a
    // PENDING invite seat with an opaque single-use token.
    let targetUserId: string | null = null;
    let targetEmail: string | null = emailRaw ?? null;
    if (userIdRaw) {
      const found = await prisma.user.findUnique({ where: { id: userIdRaw }, select: { id: true, email: true } });
      if (!found) return noStore(errors.badRequest('User not found'));
      targetUserId = found.id;
      targetEmail = found.email ?? targetEmail;
    } else if (emailRaw) {
      const found = await prisma.user.findUnique({ where: { email: emailRaw }, select: { id: true } });
      targetUserId = found?.id ?? null;
    }

    if (targetUserId) {
      const existing = await prisma.seat.findUnique({
        where: { teamId_userId: { teamId, userId: targetUserId } },
        select: { id: true },
      });
      if (existing) {
        return noStore(errors.conflict('User already has a seat in this team'));
      }
    } else if (targetEmail) {
      // Pending invite: guard against duplicate seats for the same email so a
      // person is not invited twice into the same team.
      const existingByEmail = await prisma.seat.findFirst({
        where: { teamId, email: targetEmail },
        select: { id: true },
      });
      if (existingByEmail) {
        return noStore(errors.conflict('A seat for this email already exists in this team'));
      }
    }

    const isPending = targetUserId === null;
    const seat = await prisma.seat.create({
      data: {
        teamId,
        userId: targetUserId,
        email: targetEmail,
        role,
        status: isPending ? 'pending' : 'active',
        keyLimit,
        invitedBy: user.id,
        inviteToken: isPending ? randomUUID() : null,
      },
      select: {
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
      },
    });

    log('info', 'team.seats.create', {
      teamId,
      correlationId,
      seatId: seat.id,
      role,
      status: seat.status,
    });
    return noStore(success({ seat }));
  } catch (err) {
    log('error', 'team.seats.create.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to create seat'));
  }
}
