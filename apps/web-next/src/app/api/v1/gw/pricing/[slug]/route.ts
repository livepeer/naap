/**
 * Service Gateway — Single Connector Pricing
 * GET /api/v1/gw/pricing/:slug
 *
 * Returns pricing information for a single published connector.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/gateway/authorize';
import { buildErrorResponse } from '@/lib/gateway/respond';
import { formatPricingResponse } from '@/lib/gateway/pricing';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await authorize(request);
  if (!auth) {
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    return buildErrorResponse('UNAUTHORIZED', 'Authentication required', 401, requestId, traceId);
  }

  const { slug } = await params;
  const requestId = request.headers.get('x-request-id');
  const traceId = request.headers.get('x-trace-id');

  const connector = await prisma.serviceConnector.findFirst({
    where: { slug, status: 'published' },
    include: { pricing: true },
  });

  if (!connector) {
    return buildErrorResponse('NOT_FOUND', `Connector not found: ${slug}`, 404, requestId, traceId);
  }

  const pricing = formatPricingResponse(connector, connector.pricing);

  const headers: Record<string, string> = {};
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return Response.json(pricing, { headers });
}
