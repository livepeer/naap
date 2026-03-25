/**
 * Service Gateway — List All Connector Pricing
 * GET /api/v1/gw/pricing
 *
 * Returns pricing information for all published connectors.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/gateway/authorize';
import { buildErrorResponse } from '@/lib/gateway/respond';
import { formatPricingResponse } from '@/lib/gateway/pricing';

export async function GET(request: NextRequest) {
  const requestId = request.headers.get('x-request-id');
  const traceId = request.headers.get('x-trace-id');

  const auth = await authorize(request);
  if (!auth) {
    return buildErrorResponse('UNAUTHORIZED', 'Authentication required', 401, requestId, traceId);
  }

  const connectors = await prisma.serviceConnector.findMany({
    where: {
      status: 'published',
      OR: [{ visibility: 'public' }, { teamId: auth.teamId }],
    },
    include: { pricing: true },
    orderBy: { displayName: 'asc' },
  });

  const pricing = connectors.map((c) =>
    formatPricingResponse(c, c.pricing)
  );

  const headers: Record<string, string> = {};
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return Response.json(pricing, { headers });
}
