/**
 * Team subscriptions (NAAP P3) — multi-app subscribe surface.
 *
 *   GET  /api/v1/teams/{teamId}/subscriptions     — list the team's subscriptions
 *   POST /api/v1/teams/{teamId}/subscriptions      — subscribe to a provider instance
 *
 * A team may hold MANY concurrent subscriptions (one per app/plan). Each row
 * binds {providerInstanceId, providerPlanId?, accountId, appId?}. The legacy
 * `Team.billingAccountRef` stays as the default subscription's account pointer,
 * so subscribing is purely additive.
 *
 * Tenant-scoped: the caller must be a member of the team (admin to create), via
 * the same `validateTeamAccess` authz the seat/key routes use. Gated behind
 * `multi_subscription` (default OFF): 404 when OFF (no-op). Never emits secrets.
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
  SUBSCRIPTION_STATUS_ACTIVE,
  parseCreateSubscriptionBody,
  toSubscriptionView,
} from '@/lib/billing/subscription-catalog';

interface RouteParams {
  params: Promise<{ teamId: string }>;
}

const SUBSCRIPTION_SELECT = {
  id: true,
  teamId: true,
  providerInstanceId: true,
  providerPlanId: true,
  accountId: true,
  status: true,
  appId: true,
  createdAt: true,
  updatedAt: true,
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

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(MULTI_SUBSCRIPTION_FLAG))) return noStore(errors.notFound('Resource'));

    const { teamId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));
    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    try {
      await validateTeamAccess(user.id, teamId, 'member');
    } catch (err) {
      return mapAccessError(err);
    }

    const subscriptions = await prisma.subscription.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
      select: SUBSCRIPTION_SELECT,
    });

    return noStore(success({ subscriptions: subscriptions.map(toSubscriptionView) }));
  } catch (err) {
    log('error', 'subscriptions.list.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to list subscriptions'));
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    if (!(await isFeatureEnabled(MULTI_SUBSCRIPTION_FLAG))) return noStore(errors.notFound('Resource'));

    const { teamId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));

    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;

    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    // Creating a subscription is a team-admin action (billing-affecting).
    try {
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      return mapAccessError(err);
    }

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsed = parseCreateSubscriptionBody(rawBody);
    if (!parsed.ok) return noStore(errors.badRequest(parsed.error));
    const input = parsed.value;

    // The instance must exist + be enabled (tenant-neutral catalog row).
    const instance = await prisma.providerInstance.findUnique({
      where: { id: input.providerInstanceId },
      select: { id: true, enabled: true },
    });
    if (!instance || !instance.enabled) {
      return noStore(errors.badRequest('Unknown or disabled provider instance'));
    }

    // accountId: caller-supplied wins; else fall back to the team's existing
    // billing-account binding (the default subscription's pointer). Provider
    // account provisioning via the adapter is deferred (P4 / provider coord).
    let accountId = input.accountId;
    if (!accountId) {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { billingAccountId: true },
      });
      accountId = team?.billingAccountId ?? null;
    }
    if (!accountId) {
      return noStore(
        errors.badRequest('No accountId provided and the team has no billing-account binding'),
      );
    }

    const created = await prisma.subscription.create({
      data: {
        teamId,
        providerInstanceId: input.providerInstanceId,
        providerPlanId: input.providerPlanId,
        accountId,
        status: SUBSCRIPTION_STATUS_ACTIVE,
        appId: input.appId,
      },
      select: SUBSCRIPTION_SELECT,
    });

    // Never log accountId — ids/slugs only.
    log('info', 'subscriptions.create', {
      teamId,
      correlationId,
      subscriptionId: created.id,
      providerInstanceId: created.providerInstanceId,
    });

    return noStore(success({ subscription: toSubscriptionView(created) }));
  } catch (err) {
    log('error', 'subscriptions.create.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to create subscription'));
  }
}
