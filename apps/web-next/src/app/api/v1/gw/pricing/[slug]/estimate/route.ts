/**
 * Service Gateway — Cost Estimate for Connector
 * GET /api/v1/gw/pricing/:slug/estimate?units=1000&feature=chat-completions
 *
 * Returns estimated cost for a given number of units, with optional feature override.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/gateway/authorize';
import { buildErrorResponse } from '@/lib/gateway/respond';
import { calculateCost } from '@/lib/gateway/pricing';

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
  const { searchParams } = request.nextUrl;
  const unitsParam = searchParams.get('units');
  const feature = searchParams.get('feature') || undefined;
  const requestId = request.headers.get('x-request-id');
  const traceId = request.headers.get('x-trace-id');

  if (!unitsParam) {
    return buildErrorResponse(
      'VALIDATION_ERROR',
      'Query parameter "units" is required',
      400,
      requestId,
      traceId
    );
  }

  const units = parseInt(unitsParam, 10);
  if (isNaN(units) || units < 0) {
    return buildErrorResponse(
      'VALIDATION_ERROR',
      'Query parameter "units" must be a non-negative integer',
      400,
      requestId,
      traceId
    );
  }

  const connector = await prisma.serviceConnector.findFirst({
    where: { slug, status: 'published' },
    include: { pricing: true },
  });

  if (!connector) {
    return buildErrorResponse('NOT_FOUND', `Connector not found: ${slug}`, 404, requestId, traceId);
  }

  const pricing = connector.pricing ?? {
    costPerUnit: 0,
    unit: 'request',
    currency: 'USD',
    billingModel: 'free',
    freeQuota: null,
    volumeTiers: [],
    featurePricing: [],
    upstreamCostPerUnit: null,
    upstreamUnit: null,
    upstreamNotes: null,
  };

  const estimate = calculateCost(pricing, units, feature);
  estimate.connector = slug;

  const headers: Record<string, string> = {};
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return Response.json(estimate, { headers });
}
