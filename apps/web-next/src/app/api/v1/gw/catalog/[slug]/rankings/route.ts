/**
 * Service Gateway — Connector Rankings by Slug
 * GET /api/v1/gw/catalog/:slug/rankings
 *
 * Returns capability rankings for a published connector.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/gateway/authorize';
import { buildErrorResponse } from '@/lib/gateway/respond';

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authorize(request);
  if (!auth) {
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    return buildErrorResponse('UNAUTHORIZED', 'Authentication required', 401, requestId, traceId);
  }

  const { slug } = await context.params;

  const connector = await prisma.serviceConnector.findFirst({
    where: { slug, status: 'published', OR: [{ visibility: 'public' }, { teamId: auth.teamId }] },
    select: { id: true, slug: true, displayName: true },
  });

  if (!connector) {
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    return buildErrorResponse('NOT_FOUND', `Connector not found: ${slug}`, 404, requestId, traceId);
  }

  const rankings = await prisma.connectorCapabilityRanking.findMany({
    where: { connectorId: connector.id },
    orderBy: { qualityRank: 'asc' },
  });

  const headers: Record<string, string> = {};
  const requestId = request.headers.get('x-request-id');
  const traceId = request.headers.get('x-trace-id');
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return Response.json(
    {
      connector: { id: connector.id, slug: connector.slug, displayName: connector.displayName },
      rankings,
    },
    { headers }
  );
}
