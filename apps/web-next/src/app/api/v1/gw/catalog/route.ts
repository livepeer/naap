/**
 * Service Gateway — Tool Catalog API
 * GET /api/v1/gw/catalog
 *
 * Returns a structured catalog of all published tools/connectors
 * with pricing, health, performance, and ranking data.
 * Supports format negotiation: native, openai, mcp.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { buildErrorResponse } from '@/lib/gateway/respond';
import { buildToolCatalog } from '@/lib/gateway/catalog';
import { catalogToMcpTools, catalogToOpenAiFunctions } from '@/lib/gateway/mcp-adapter';

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) {
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    return buildErrorResponse('UNAUTHORIZED', 'Authentication required', 401, requestId, traceId);
  }

  const { searchParams } = request.nextUrl;
  const format = searchParams.get('format') || 'native';
  const category = searchParams.get('category') || undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);

  const { tools, total } = await buildToolCatalog(auth.teamId, { category, page, pageSize });

  if (format === 'openai') {
    const functions = catalogToOpenAiFunctions(tools);
    return Response.json(functions);
  }

  if (format === 'mcp') {
    const mcpTools = catalogToMcpTools(tools);
    return Response.json({ tools: mcpTools });
  }

  const host = request.headers.get('host') || '';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}/api/v1/gw`;

  return Response.json({
    tools,
    gateway: {
      version: '1.0.0',
      authMethods: ['masterKey', 'connectorKey', 'jwt'],
      baseUrl,
      mcpEndpoint: '/api/v1/gw/mcp',
      discoveryUrl: '/api/v1/gw/discovery',
    },
    pagination: { page, pageSize, total },
  });
}
