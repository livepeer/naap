/**
 * Service Gateway — Request Transform
 *
 * Builds the upstream request from consumer request + connector config.
 * Handles: URL construction, auth injection, body transforms, header mapping.
 */

import type {
  ResolvedConfig,
  ResolvedSecrets,
  UpstreamRequest,
} from './types';

/**
 * Build the upstream request from the consumer request and resolved config.
 */
export function buildUpstreamRequest(
  request: Request,
  config: ResolvedConfig,
  secrets: ResolvedSecrets,
  consumerBody: string | null,
  consumerPath: string
): UpstreamRequest {
  const { connector, endpoint } = config;

  // ── URL ──
  const upstreamUrl = buildUpstreamUrl(connector.upstreamBaseUrl, endpoint, consumerPath);

  // ── Method ──
  const method = endpoint.upstreamMethod || endpoint.method;

  // ── Headers ──
  const headers = buildUpstreamHeaders(connector, endpoint, secrets, request);

  // ── Body ──
  const body = transformBody(endpoint, consumerBody);

  return { url: upstreamUrl, method, headers, body };
}

/**
 * Build the upstream URL, handling path params and query params.
 */
function buildUpstreamUrl(
  baseUrl: string,
  endpoint: ResolvedConfig['endpoint'],
  consumerPath: string
): string {
  // Map path params from consumer to upstream
  const consumerParts = consumerPath.split('/').filter(Boolean);
  const patternParts = endpoint.path.split('/').filter(Boolean);

  let upstreamPath = endpoint.upstreamPath;

  // Replace :param placeholders with actual values from consumer path
  patternParts.forEach((part, i) => {
    if (part.startsWith(':') && consumerParts[i]) {
      upstreamPath = upstreamPath.replace(part, consumerParts[i]);
    }
  });

  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  const url = new URL(`${base}${path}`);

  // Add configured query params
  const queryParams = endpoint.upstreamQueryParams;
  if (queryParams && typeof queryParams === 'object') {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/**
 * Build upstream headers: content type, auth injection, custom mappings.
 */
function buildUpstreamHeaders(
  connector: ResolvedConfig['connector'],
  endpoint: ResolvedConfig['endpoint'],
  secrets: ResolvedSecrets,
  request: Request
): Headers {
  const headers = new Headers();

  // Content type
  headers.set('Content-Type', endpoint.upstreamContentType);

  // Auth injection
  injectAuth(headers, connector, secrets);

  // Custom header mapping
  const mapping = endpoint.headerMapping;
  if (mapping && typeof mapping === 'object') {
    for (const [key, value] of Object.entries(mapping)) {
      headers.set(key, interpolateSecrets(String(value), secrets));
    }
  }

  // Forward observability headers
  const requestId = request.headers.get('x-request-id');
  if (requestId) headers.set('x-request-id', requestId);

  const traceId = request.headers.get('x-trace-id');
  if (traceId) headers.set('x-trace-id', traceId);

  return headers;
}

/**
 * Inject authentication into upstream request headers based on auth type.
 */
function injectAuth(
  headers: Headers,
  connector: ResolvedConfig['connector'],
  secrets: ResolvedSecrets
): void {
  const config = connector.authConfig;

  switch (connector.authType) {
    case 'bearer': {
      const tokenRef = (config.tokenRef as string) || 'token';
      const token = secrets[tokenRef] || '';
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      break;
    }

    case 'header': {
      const headerEntries = (config.headers as Record<string, string>) || {};
      for (const [key, valueRef] of Object.entries(headerEntries)) {
        headers.set(key, interpolateSecrets(valueRef, secrets));
      }
      break;
    }

    case 'basic': {
      const userRef = (config.usernameRef as string) || 'username';
      const passRef = (config.passwordRef as string) || 'password';
      const username = secrets[userRef] || '';
      const password = secrets[passRef] || '';
      const encoded = Buffer.from(`${username}:${password}`).toString('base64');
      headers.set('Authorization', `Basic ${encoded}`);
      break;
    }

    case 'query':
      // Query params are handled in URL construction, not headers
      break;

    case 'none':
    default:
      break;
  }
}

/**
 * Transform the request body based on the endpoint's bodyTransform setting.
 */
function transformBody(
  endpoint: ResolvedConfig['endpoint'],
  consumerBody: string | null
): BodyInit | undefined {
  if (!consumerBody && !endpoint.upstreamStaticBody) {
    return undefined;
  }

  switch (endpoint.bodyTransform) {
    case 'passthrough':
      return consumerBody || undefined;

    case 'static':
      return endpoint.upstreamStaticBody || undefined;

    case 'template': {
      if (!endpoint.upstreamStaticBody || !consumerBody) {
        return consumerBody || undefined;
      }
      try {
        const body = JSON.parse(consumerBody);
        return interpolateTemplate(endpoint.upstreamStaticBody, body);
      } catch {
        return consumerBody;
      }
    }

    default: {
      // extract:fieldPath
      if (endpoint.bodyTransform.startsWith('extract:') && consumerBody) {
        const fieldPath = endpoint.bodyTransform.slice('extract:'.length);
        try {
          const body = JSON.parse(consumerBody);
          const extracted = getNestedValue(body, fieldPath);
          return extracted !== undefined ? JSON.stringify(extracted) : consumerBody;
        } catch {
          return consumerBody;
        }
      }
      return consumerBody || undefined;
    }
  }
}

/**
 * Replace {{secrets.name}} placeholders with actual secret values.
 */
function interpolateSecrets(template: string, secrets: ResolvedSecrets): string {
  return template.replace(/\{\{secrets\.(\w+)\}\}/g, (_, name) => secrets[name] || '');
}

/**
 * Replace {{body.field}} placeholders with values from the request body.
 */
function interpolateTemplate(template: string, body: Record<string, unknown>): string {
  return template.replace(/\{\{body\.([.\w]+)\}\}/g, (_, path) => {
    const value = getNestedValue(body, path);
    return value !== undefined ? String(value) : '';
  });
}

/**
 * Safely get a nested value from an object by dot-separated path.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
