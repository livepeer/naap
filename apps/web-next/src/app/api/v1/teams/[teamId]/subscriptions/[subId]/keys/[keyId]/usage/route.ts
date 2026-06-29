/**
 * Per-key usage for a subscription-bound key (NAAP P3).
 *
 *   GET /api/v1/teams/{teamId}/subscriptions/{subId}/keys/{keyId}/usage
 *   → { keyId, subscriptionId, totals: { requestCount, tokensUsed, costIncurred }, entries[] }
 *
 * Reads `DevApiUsageLog` (already keyed per `apiKeyId`) scoped to the requested
 * key, which must belong to this team + subscription (tenant isolation, INV-
 * scoping: a key for subscription A can never read subscription B's usage). The
 * P2 resolver scopes live metering to {instance, account}; this view rolls the
 * recorded per-key log up for the developer surface.
 *
 * Gated behind `multi_subscription` (default OFF): 404 when OFF (no-op).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { isFeatureEnabled, MULTI_SUBSCRIPTION_FLAG } from '@/lib/feature-flags';

interface RouteParams {
  params: Promise<{ teamId: string; subId: string; keyId: string }>;
}

/** Cap on recent usage rows returned (latest-first); totals span all rows. */
const MAX_USAGE_ENTRIES = 100;

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function correlationIdOf(request: NextRequest): string {
  return request.headers.get('x-request-id')?.trim() || randomUUID();
}

function log(level: 'info' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
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
    if (!(await isFeatureEnabled(MULTI_SUBSCRIPTION_FLAG, (await params).teamId))) return noStore(errors.notFound('Resource'));

    const { teamId, subId, keyId } = await params;
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));
    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    try {
      await validateTeamAccess(user.id, teamId, 'member');
    } catch (err) {
      return mapAccessError(err);
    }

    // Tenant + subscription isolation: the key must belong to BOTH.
    const key = await prisma.devApiKey.findFirst({
      where: { id: keyId, teamId, subscriptionId: subId },
      select: { id: true },
    });
    if (!key) return noStore(errors.notFound('Key'));

    const [totals, entries] = await Promise.all([
      prisma.devApiUsageLog.aggregate({
        where: { apiKeyId: keyId },
        _sum: { requestCount: true, tokensUsed: true, costIncurred: true },
      }),
      prisma.devApiUsageLog.findMany({
        where: { apiKeyId: keyId },
        orderBy: { timestamp: 'desc' },
        take: MAX_USAGE_ENTRIES,
        select: { id: true, requestCount: true, tokensUsed: true, costIncurred: true, timestamp: true },
      }),
    ]);

    log('info', 'subscription_key.usage', {
      teamId,
      correlationId,
      keyId,
      subscriptionId: subId,
      entryCount: entries.length,
    });

    return noStore(
      success({
        keyId,
        subscriptionId: subId,
        totals: {
          requestCount: totals._sum.requestCount ?? 0,
          tokensUsed: totals._sum.tokensUsed ?? 0,
          costIncurred: totals._sum.costIncurred ?? 0,
        },
        entries: entries.map((e) => ({
          id: e.id,
          requestCount: e.requestCount,
          tokensUsed: e.tokensUsed,
          costIncurred: e.costIncurred,
          timestamp: e.timestamp.toISOString(),
        })),
      }),
    );
  } catch (err) {
    log('error', 'subscription_key.usage.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to load usage'));
  }
}
