/**
 * Service Gateway — Single Tool Descriptor by Connector Slug
 * GET /api/v1/gw/catalog/:slug
 *
 * Returns the tool descriptor for a single published connector.
 * Supports format negotiation: native, openai, mcp.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/gateway/authorize';
import { buildErrorResponse } from '@/lib/gateway/respond';
import { buildToolDescriptor } from '@/lib/gateway/catalog';
import { catalogToMcpTools, catalogToOpenAiFunctions } from '@/lib/gateway/mcp-adapter';

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
  const format = searchParams.get('format') || 'native';
  const requestId = request.headers.get('x-request-id');
  const traceId = request.headers.get('x-trace-id');

  const connector = await prisma.serviceConnector.findFirst({
    where: { slug, status: 'published' },
    include: {
      endpoints: { where: { enabled: true }, orderBy: { createdAt: 'asc' } },
      pricing: true,
      healthChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
      metrics: { where: { period: 'daily' }, orderBy: { periodStart: 'desc' }, take: 1 },
      rankings: { orderBy: { qualityRank: 'asc' } },
    },
  });

  if (!connector) {
    return buildErrorResponse('NOT_FOUND', `Connector not found: ${slug}`, 404, requestId, traceId);
  }

  const baseUrl = '/api/v1/gw';
  const descriptor = buildToolDescriptor(connector, baseUrl);

  const headers: Record<string, string> = {};
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  if (format === 'openai') {
    const functions = catalogToOpenAiFunctions([descriptor]);
    return Response.json(functions, { headers });
  }

  if (format === 'mcp') {
    const mcpTools = catalogToMcpTools([descriptor]);
    return Response.json({ tools: mcpTools }, { headers });
  }

  return Response.json(descriptor, { headers });
}
