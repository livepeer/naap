/**
 * Service Gateway — Rankings by Category
 * GET /api/v1/gw/rankings?category=text-to-image
 *
 * Returns capability rankings for a category across connectors.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/gateway/authorize';
import { buildErrorResponse } from '@/lib/gateway/respond';

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) {
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    return buildErrorResponse('UNAUTHORIZED', 'Authentication required', 401, requestId, traceId);
  }

  const category = request.nextUrl.searchParams.get('category');
  if (!category) {
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    return buildErrorResponse('BAD_REQUEST', 'Query parameter "category" is required', 400, requestId, traceId);
  }

  const rows = await prisma.connectorCapabilityRanking.findMany({
    where: {
      category,
      connector: {
        status: 'published',
        OR: [{ visibility: 'public' }, { teamId: auth.teamId }],
      },
    },
    orderBy: { qualityRank: 'asc' },
    take: 100,
    include: {
      connector: {
        select: { slug: true, displayName: true },
      },
    },
  });

  const rankings = rows.map(({ connector, ...r }) => ({
    ...r,
    connectorSlug: connector.slug,
    connectorDisplayName: connector.displayName,
  }));

  const headers: Record<string, string> = {};
  const requestId = request.headers.get('x-request-id');
  const traceId = request.headers.get('x-trace-id');
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return Response.json(
    { category, rankings },
    { headers }
  );
}
