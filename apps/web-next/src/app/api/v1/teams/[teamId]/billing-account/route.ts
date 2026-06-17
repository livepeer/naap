/**
 * Team billing-account binding (NAAP-1).
 *
 *   GET /api/v1/teams/{teamId}/billing-account   — read the team's billingAccountRef (viewer+)
 *   PUT /api/v1/teams/{teamId}/billing-account    — bind { providerSlug, accountId } (admin+)
 *
 * Binds a team to ONE provider-agnostic `billingAccountRef` resolved through the
 * BillingProviderAdapter registry (NAAP-A) — never a provider-specific FK
 * (Decision D2: no separate NaaP billing-account entity). `accountId` is the
 * provider's opaque customer/subscription id (e.g. an OpenMeter customer id).
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
import {
  TEAM_SEATS_FLAG,
  isProviderResolvable,
  normalizeBillingAccountRef,
  teamBillingAccountRef,
} from '@/lib/teams/billing-account-ref';

interface RouteParams {
  params: Promise<{ teamId: string }>;
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

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(TEAM_SEATS_FLAG))) return noStore(errors.notFound('Resource'));

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

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, billingAccountProviderSlug: true, billingAccountId: true },
    });
    if (!team) return noStore(errors.notFound('Team'));

    return noStore(success({ billingAccountRef: teamBillingAccountRef(team) }));
  } catch (err) {
    log('error', 'team.billing_account.get.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to read billing account'));
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(TEAM_SEATS_FLAG))) return noStore(errors.notFound('Resource'));

    const { teamId } = await params;
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStore(errors.badRequest('Invalid JSON in request body'));
    }

    const ref = normalizeBillingAccountRef(body);
    if (!ref) {
      return noStore(errors.badRequest('billingAccountRef requires { providerSlug, accountId }'));
    }
    // Stay generic: only providers with a registered adapter are bindable.
    if (!isProviderResolvable(ref)) {
      log('warn', 'team.billing_account.unknown_provider', {
        teamId,
        correlationId,
        providerSlug: ref.providerSlug,
      });
      return noStore(errors.badRequest(`Unknown billing provider "${ref.providerSlug}"`));
    }

    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) return noStore(errors.notFound('Team'));

    await prisma.team.update({
      where: { id: teamId },
      data: { billingAccountProviderSlug: ref.providerSlug, billingAccountId: ref.accountId },
    });

    // Never log accountId (provider-opaque, may be sensitive) — slug only.
    log('info', 'team.billing_account.bind', {
      teamId,
      correlationId,
      providerSlug: ref.providerSlug,
    });
    return noStore(success({ billingAccountRef: ref }));
  } catch (err) {
    log('error', 'team.billing_account.bind.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to bind billing account'));
  }
}
