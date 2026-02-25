/**
 * Service Gateway — Admin: OpenAPI Spec
 * GET /api/v1/gw/admin/connectors/:id/openapi
 *
 * Returns an auto-generated OpenAPI 3.0.3 spec for the connector.
 * Supports JSON (default) or YAML (?format=yaml).
 */

import { NextRequest } from 'next/server';
import { getAdminContext, isErrorResponse, loadConnectorWithEndpoints } from '@/lib/gateway/admin/team-guard';
import { generateOpenApiSpec, jsonToYaml } from '@/lib/gateway/openapi';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadConnectorWithEndpoints(id, ctx.teamId);
  if (!connector) {
    return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Connector not found' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const baseUrl = request.headers.get('x-forwarded-proto')
    ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}`
    : new URL(request.url).origin;

  const spec = generateOpenApiSpec(
    {
      slug: connector.slug,
      displayName: connector.displayName,
      description: connector.description,
      version: connector.version,
      authType: connector.authType,
      upstreamBaseUrl: connector.upstreamBaseUrl,
      endpoints: connector.endpoints.map((ep) => ({
        name: ep.name,
        description: ep.description,
        method: ep.method,
        path: ep.path,
        upstreamContentType: ep.upstreamContentType,
        bodySchema: ep.bodySchema,
        requiredHeaders: ep.requiredHeaders,
        cacheTtl: ep.cacheTtl,
        rateLimit: ep.rateLimit,
        timeout: ep.timeout,
        bodyBlacklist: ep.bodyBlacklist,
        bodyPattern: ep.bodyPattern,
      })),
    },
    baseUrl
  );

  const format = request.nextUrl.searchParams.get('format');

  if (format === 'yaml') {
    return new Response(jsonToYaml(spec), {
      status: 200,
      headers: {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Content-Disposition': `inline; filename="${connector.slug}-openapi.yaml"`,
      },
    });
  }

  return new Response(JSON.stringify(spec, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `inline; filename="${connector.slug}-openapi.json"`,
    },
  });
}
