/**
 * Service Gateway — Discovery Document
 * GET /api/v1/gw/discovery
 *
 * Returns a JSON discovery document with gateway metadata.
 * No authentication required.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';

const DISCOVERY = {
  name: 'NaaP Service Gateway',
  version: '1.0.0',
  endpoints: {
    catalog: '/api/v1/gw/catalog',
    pricing: '/api/v1/gw/pricing',
    rankings: '/api/v1/gw/rankings',
    mcp: '/api/v1/gw/mcp',
    discovery: '/api/v1/gw/discovery',
    proxy: '/api/v1/gw/{connector}/{path}',
  },
  formats: ['native', 'openai', 'mcp'],
  auth: {
    masterKey: { prefix: 'gwm_', header: 'Authorization', scheme: 'Bearer' },
    connectorKey: { prefix: 'gw_', header: 'Authorization', scheme: 'Bearer' },
    jwt: { header: 'Authorization', scheme: 'Bearer' },
  },
} as const;

export async function GET(request: NextRequest) {
  const requestId = request.headers.get('x-request-id');
  const traceId = request.headers.get('x-trace-id');

  const headers: Record<string, string> = {};
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return Response.json(DISCOVERY, { headers });
}
