/**
 * Service Gateway — OpenAPI Spec Generator
 *
 * Generates an OpenAPI 3.0.3 spec from connector + endpoint metadata.
 * No external dependencies — produces a plain JSON object that conforms
 * to the OpenAPI specification.
 */

interface ConnectorForSpec {
  slug: string;
  displayName: string;
  description: string | null;
  version: number;
  authType: string;
  upstreamBaseUrl: string;
  endpoints: EndpointForSpec[];
}

interface EndpointForSpec {
  name: string;
  description?: string | null;
  method: string;
  path: string;
  upstreamContentType: string;
  bodySchema?: unknown;
  requiredHeaders: string[];
  cacheTtl?: number | null;
  rateLimit?: number | null;
  timeout?: number | null;
  bodyBlacklist?: string[];
  bodyPattern?: string | null;
}

interface OpenApiParameter {
  name: string;
  in: 'path' | 'header' | 'query';
  required: boolean;
  schema: { type: string };
  description?: string;
}

interface OpenApiOperation {
  operationId: string;
  summary: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required: boolean;
    content: Record<string, { schema: unknown }>;
  };
  responses: Record<string, { description: string; content?: Record<string, { schema: unknown }> }>;
  'x-cache-ttl'?: number;
  'x-rate-limit'?: number;
  'x-timeout'?: number;
}

type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>;

interface OpenApiSpec {
  openapi: string;
  info: { title: string; description: string; version: string };
  servers: Array<{ url: string; description?: string }>;
  paths: OpenApiPaths;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  security: Array<Record<string, string[]>>;
}

/**
 * Convert Express-style `:param` to OpenAPI `{param}` notation.
 */
function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

/**
 * Extract path parameter names from an Express-style path.
 */
function extractPathParams(path: string): string[] {
  const matches = path.match(/:(\w+)/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1));
}

/**
 * Build a sanitized operationId from method + path.
 */
function buildOperationId(method: string, path: string): string {
  const segments = path
    .replace(/:/g, '')
    .split('/')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return method.toLowerCase() + segments.join('');
}

/**
 * Map connector authType to OpenAPI security scheme definitions.
 */
function buildSecuritySchemes(authType: string): Record<string, unknown> {
  const schemes: Record<string, unknown> = {
    gatewayApiKey: {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description: 'Gateway API Key: pass as "Bearer gk_..." in Authorization header',
    },
  };

  switch (authType) {
    case 'bearer':
      schemes.bearerAuth = { type: 'http', scheme: 'bearer', description: 'JWT or NaaP session token' };
      break;
    case 'basic':
      schemes.basicAuth = { type: 'http', scheme: 'basic' };
      break;
    default:
      schemes.bearerAuth = { type: 'http', scheme: 'bearer' };
  }

  return schemes;
}

/**
 * Build the standard error schema referenced by all error responses.
 */
function buildErrorSchema(): unknown {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
      meta: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  };
}

/**
 * Generate an OpenAPI 3.0.3 specification from a connector and its endpoints.
 *
 * @param connector - The connector with embedded endpoints
 * @param baseUrl   - The base URL of the NaaP instance (e.g. "https://app.naap.live")
 */
export function generateOpenApiSpec(connector: ConnectorForSpec, baseUrl: string): OpenApiSpec {
  const gatewayBase = `${baseUrl.replace(/\/$/, '')}/api/v1/gw/${connector.slug}`;

  const paths: OpenApiPaths = {};

  for (const ep of connector.endpoints) {
    const openApiPath = toOpenApiPath(ep.path);
    const methodKey = ep.method.toLowerCase();
    const pathParams = extractPathParams(ep.path);

    const parameters: OpenApiParameter[] = [];

    for (const param of pathParams) {
      parameters.push({
        name: param,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    }

    for (const header of ep.requiredHeaders || []) {
      parameters.push({
        name: header,
        in: 'header',
        required: true,
        schema: { type: 'string' },
        description: `Required header: ${header}`,
      });
    }

    const operation: OpenApiOperation = {
      operationId: buildOperationId(ep.method, ep.path),
      summary: ep.name,
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            [ep.upstreamContentType || 'application/json']: {
              schema: { type: 'object' },
            },
          },
        },
        '400': {
          description: 'Validation error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GatewayError' } } },
        },
        '401': {
          description: 'Unauthorized — missing or invalid authentication',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GatewayError' } } },
        },
        '429': {
          description: 'Rate limited or quota exceeded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GatewayError' } } },
        },
        '502': {
          description: 'Upstream service error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GatewayError' } } },
        },
      },
    };

    if (ep.description) {
      operation.description = ep.description;
    }

    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    // Request body for non-GET methods
    if (ep.method !== 'GET' && ep.method !== 'HEAD' && ep.method !== 'DELETE') {
      const bodySchema = ep.bodySchema || { type: 'object' };
      operation.requestBody = {
        required: true,
        content: {
          [ep.upstreamContentType || 'application/json']: {
            schema: bodySchema,
          },
        },
      };
    }

    if (ep.cacheTtl && ep.cacheTtl > 0) operation['x-cache-ttl'] = ep.cacheTtl;
    if (ep.rateLimit) operation['x-rate-limit'] = ep.rateLimit;
    if (ep.timeout) operation['x-timeout'] = ep.timeout;

    if (!paths[openApiPath]) paths[openApiPath] = {};
    paths[openApiPath][methodKey] = operation;
  }

  const securitySchemes = buildSecuritySchemes(connector.authType);
  const securityKeys = Object.keys(securitySchemes);

  return {
    openapi: '3.0.3',
    info: {
      title: connector.displayName,
      description: connector.description || `API spec for the ${connector.displayName} connector`,
      version: `v${connector.version}`,
    },
    servers: [{ url: gatewayBase, description: 'NaaP Service Gateway' }],
    paths,
    components: {
      securitySchemes,
      schemas: {
        GatewayError: buildErrorSchema(),
      },
    },
    security: securityKeys.map((k) => ({ [k]: [] })),
  };
}

/**
 * Minimal JSON-to-YAML serializer for OpenAPI output.
 * Handles the subset of structures used by OpenAPI specs.
 */
export function jsonToYaml(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);

  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean') return String(obj);
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'string') {
    if (obj.includes('\n') || obj.includes(':') || obj.includes('#') || obj.includes("'") || obj.startsWith('{') || obj.startsWith('[')) {
      return JSON.stringify(obj);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          const inner = jsonToYaml(item, indent + 1);
          const lines = inner.split('\n');
          return `${pad}- ${lines[0].trim()}\n${lines.slice(1).map((l) => `${pad}  ${l.trimStart()}`).join('\n')}`;
        }
        return `${pad}- ${jsonToYaml(item, indent + 1)}`;
      })
      .join('\n')
      .replace(/\n\n/g, '\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, val]) => {
        if (typeof val === 'object' && val !== null) {
          const inner = jsonToYaml(val, indent + 1);
          return `${pad}${key}:\n${inner}`;
        }
        return `${pad}${key}: ${jsonToYaml(val, indent + 1)}`;
      })
      .join('\n');
  }

  return String(obj);
}
