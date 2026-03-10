/**
 * Service Gateway — MCP JSON-RPC 2.0 Endpoint
 * POST /api/v1/gw/mcp
 *
 * Handles MCP tools/list and tools/call. Auth: master key or JWT.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { buildErrorResponse } from '@/lib/gateway/respond';
import { buildToolCatalog } from '@/lib/gateway/catalog';
import { catalogToMcpTools, mcpToolNameToRoute } from '@/lib/gateway/mcp-adapter';
import type { ToolDescriptor } from '@/lib/gateway/catalog';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) {
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    return buildErrorResponse('UNAUTHORIZED', 'Authentication required', 401, requestId, traceId);
  }

  let body: JsonRpcRequest;
  try {
    body = await request.json() as JsonRpcRequest;
  } catch {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 }
    );
  }

  if (body.jsonrpc !== '2.0' || body.id == null) {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: body?.id ?? null,
        error: { code: -32600, message: 'Invalid JSON-RPC request' },
      },
      { status: 400 }
    );
  }

  const { tools } = await buildToolCatalog(auth.teamId);

  switch (body.method) {
    case 'tools/list': {
      const mcpTools = catalogToMcpTools(tools);
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools: mcpTools },
      });
    }

    case 'tools/call': {
      const params = (body.params || {}) as Record<string, unknown>;
      const toolName = params.name as string;
      const args = (params.arguments || {}) as Record<string, unknown>;

      if (!toolName) {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: 'Missing required param: name' },
        });
      }

      const { connector, endpointPath } = mcpToolNameToRoute(toolName);
      const resolved = resolveEndpointFromCatalog(tools, connector, endpointPath);

      if (!resolved) {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: `Unknown tool or endpoint: ${toolName}` },
        });
      }

      const { method, path } = resolved;
      const selfOrigin = process.env.NEXTAUTH_URL
        || process.env.NEXT_PUBLIC_APP_URL
        || `http://localhost:${process.env.PORT || 3000}`;
      let url = `${selfOrigin}/api/v1/gw/${connector}${path}`;

      const authHeader = request.headers.get('authorization');

      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
      };

      if (method === 'GET' || method === 'HEAD') {
        if (Object.keys(args).length > 0) {
          const qs = new URLSearchParams();
          for (const [k, v] of Object.entries(args)) {
            qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
          }
          url += `?${qs.toString()}`;
        }
      } else if (Object.keys(args).length > 0) {
        fetchOptions.body = JSON.stringify(args);
      }

      const response = await fetch(url, fetchOptions);
      const responseBody = await response.text();
      const isError = response.status >= 400;

      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text' as const, text: responseBody }],
          isError,
        },
      });
    }

    default:
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: `Unknown method: ${body.method}` },
      });
  }
}

function resolveEndpointFromCatalog(
  catalog: ToolDescriptor[],
  connector: string,
  endpointPath: string
): { method: string; path: string } | null {
  const tool = catalog.find((t) => t.name === connector);
  if (!tool) return null;

  const endpoint = tool.endpoints.find(
    (ep) =>
      ep.name === endpointPath ||
      ep.name.replace(/-/g, '_') === endpointPath.replace(/-/g, '_')
  );
  if (!endpoint) return null;

  return { method: endpoint.method, path: endpoint.path };
}
