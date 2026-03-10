/**
 * Service Gateway — MCP & OpenAI Format Adapters
 *
 * Converts the native tool catalog into MCP tools/list format,
 * OpenAI function-calling format, and handles MCP JSON-RPC requests.
 */

import type { ToolDescriptor, EndpointDescriptor } from './catalog';

// ── Types ──

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface OpenAiFunction {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Convert catalog tools to MCP tools/list format.
 * Each endpoint becomes a separate MCP tool named {connector}__{endpoint}.
 */
export function catalogToMcpTools(catalog: ToolDescriptor[]): McpTool[] {
  const tools: McpTool[] = [];
  for (const tool of catalog) {
    for (const ep of tool.endpoints) {
      tools.push({
        name: buildMcpToolName(tool.name, ep.name),
        description: buildToolDescription(tool, ep),
        inputSchema: (ep.inputSchema as object) || { type: 'object', properties: {} },
      });
    }
  }
  return tools;
}

/**
 * Convert catalog tools to OpenAI function-calling format.
 */
export function catalogToOpenAiFunctions(catalog: ToolDescriptor[]): OpenAiFunction[] {
  const functions: OpenAiFunction[] = [];
  for (const tool of catalog) {
    for (const ep of tool.endpoints) {
      functions.push({
        type: 'function',
        function: {
          name: buildMcpToolName(tool.name, ep.name),
          description: `${buildToolDescription(tool, ep)}\n\nInvoke: ${ep.method} ${tool.baseUrl}${ep.path}`,
          parameters: (ep.inputSchema as object) || { type: 'object', properties: {} },
        },
      });
    }
  }
  return functions;
}

/**
 * Parse an MCP tool name back to connector slug + endpoint path.
 */
export function mcpToolNameToRoute(name: string): { connector: string; endpointPath: string } {
  const sepIndex = name.indexOf('__');
  if (sepIndex === -1) {
    return { connector: name, endpointPath: '/' };
  }
  const connector = name.slice(0, sepIndex);
  const endpointName = name.slice(sepIndex + 2).replace(/_/g, '-');
  return { connector, endpointPath: endpointName };
}

/**
 * Handle an incoming MCP JSON-RPC 2.0 request.
 */
export async function handleMcpRequest(
  body: JsonRpcRequest,
  catalog: ToolDescriptor[],
): Promise<JsonRpcResponse> {
  if (body.jsonrpc !== '2.0' || !body.method || body.id == null) {
    return {
      jsonrpc: '2.0',
      id: body.id ?? 0,
      error: { code: -32600, message: 'Invalid JSON-RPC request' },
    };
  }

  switch (body.method) {
    case 'tools/list': {
      const tools = catalogToMcpTools(catalog);
      return { jsonrpc: '2.0', id: body.id, result: { tools } };
    }

    case 'tools/call': {
      const params = body.params || {};
      const toolName = params.name as string;
      const args = (params.arguments || {}) as Record<string, unknown>;

      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: 'Missing required param: name' },
        };
      }

      const { connector, endpointPath } = mcpToolNameToRoute(toolName);

      // Find the tool and endpoint
      const tool = catalog.find((t) => t.name === connector);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: `Unknown tool: ${toolName}` },
        };
      }

      const endpoint = tool.endpoints.find(
        (ep) => ep.name === endpointPath || ep.name.replace(/-/g, '_') === endpointPath.replace(/-/g, '_')
      );
      if (!endpoint) {
        return {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: `Unknown endpoint: ${endpointPath} on ${connector}` },
        };
      }

      return {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          _proxyTo: {
            connector,
            method: endpoint.method,
            path: endpoint.path,
            body: args,
          },
        },
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: `Unknown method: ${body.method}` },
      };
  }
}

// ── Internal Helpers ──

function buildMcpToolName(connectorSlug: string, endpointName: string): string {
  return `${connectorSlug}__${endpointName.replace(/-/g, '_')}`;
}

function buildToolDescription(tool: ToolDescriptor, ep: EndpointDescriptor): string {
  const parts = [ep.description || ep.name];
  if (tool.agentDescription) parts[0] = `${ep.description || ep.name} via ${tool.displayName}`;
  return parts[0];
}
