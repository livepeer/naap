/**
 * Service Gateway — Connector Metrics by Slug
 * GET /api/v1/gw/catalog/:slug/metrics?window=24h
 *
 * Returns metrics and hourly history for a published connector.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/gateway/authorize';
import { buildErrorResponse } from '@/lib/gateway/respond';
import { getLatestMetrics } from '@/lib/gateway/metrics';

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authorize(request);
  if (!auth) {
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    return buildErrorResponse('UNAUTHORIZED', 'Authentication required', 401, requestId, traceId);
  }

  const { slug } = await context.params;
  const window = (request.nextUrl.searchParams.get('window') || '24h') as '1h' | '24h' | '7d';
  const validWindow = ['1h', '24h', '7d'].includes(window) ? window : '24h';

  const connector = await prisma.serviceConnector.findFirst({
    where: { slug, status: 'published' },
    select: { id: true, slug: true, displayName: true },
  });

  if (!connector) {
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    return buildErrorResponse('NOT_FOUND', `Connector not found: ${slug}`, 404, requestId, traceId);
  }

  const metrics = await getLatestMetrics(connector.id, validWindow);

  const historyPeriod = validWindow === '7d' ? 'daily' : 'hourly';
  const historyLimit = validWindow === '7d' ? 7 : validWindow === '24h' ? 24 : 1;
  const history = await prisma.connectorMetrics.findMany({
    where: { connectorId: connector.id, period: historyPeriod },
    orderBy: { periodStart: 'desc' },
    take: historyLimit,
  });

  const historyMapped = history.map((h) => ({
    periodStart: h.periodStart.toISOString(),
    totalRequests: h.totalRequests,
    errorRate: h.errorRate,
    latencyP50Ms: h.latencyP50Ms,
    latencyP95Ms: h.latencyP95Ms,
    availabilityPercent: h.availabilityPercent,
    throughputRpm: h.throughputRpm,
  }));

  const requestId = request.headers.get('x-request-id');
  const traceId = request.headers.get('x-trace-id');
  const headers: Record<string, string> = {};
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return Response.json(
    {
      connector: { id: connector.id, slug: connector.slug, displayName: connector.displayName },
      window: validWindow,
      metrics,
      history: historyMapped,
    },
    { headers }
  );
}
