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
import { signAwsV4 } from './aws-sig-v4';

/**
 * Build the upstream request from the consumer request and resolved config.
 */
export function buildUpstreamRequest(
  request: Request,
  config: ResolvedConfig,
  secrets: ResolvedSecrets,
  consumerBody: string | null,
  consumerPath: string,
  consumerBodyRaw?: ArrayBuffer | null,
): UpstreamRequest {
  const { connector, endpoint } = config;

  // ── URL ──
  const consumerUrl = new URL(request.url);
  const upstreamUrl = buildUpstreamUrl(connector.upstreamBaseUrl, endpoint, consumerPath, consumerUrl.searchParams);
  const url = new URL(upstreamUrl);

  // ── Method ──
  const method = endpoint.upstreamMethod || endpoint.method;

  // ── Headers ──
  const headers = buildUpstreamHeaders(connector, endpoint, secrets, request);

  // ── Body ──
  const body = transformBody(endpoint, consumerBody, consumerBodyRaw);

  // ── Auth injection (after URL + body are finalized) ──
  injectAuth(headers, connector, secrets, method, url, body);

  return { url: url.toString(), method, headers, body };
}

/**
 * Build the upstream URL, handling path params and query params.
 */
function buildUpstreamUrl(
  baseUrl: string,
  endpoint: ResolvedConfig['endpoint'],
  consumerPath: string,
  consumerSearchParams?: URLSearchParams
): string {
  const consumerParts = consumerPath.split('/').filter(Boolean);
  const patternParts = endpoint.path.split('/').filter(Boolean);

  let upstreamPath = endpoint.upstreamPath;

  patternParts.forEach((part, i) => {
    if (part.endsWith('*') && part.startsWith(':')) {
      const catchAllSegments = consumerParts.slice(i);
      upstreamPath = upstreamPath.replace(part, catchAllSegments.join('/'));
    } else if (part.startsWith(':') && consumerParts[i]) {
      upstreamPath = upstreamPath.replace(part, consumerParts[i]);
    }
  });

  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  const url = new URL(`${base}${path}`);

  // Forward consumer query params (e.g. ?pipeline=...&model=...)
  if (consumerSearchParams) {
    consumerSearchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  // Static/configured query params override consumer params
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

  if (endpoint.upstreamContentType) {
    headers.set('Content-Type', endpoint.upstreamContentType);
  } else {
    const original = request.headers.get('content-type');
    if (original) headers.set('Content-Type', original);
  }

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
  secrets: ResolvedSecrets,
  method: string,
  url: URL,
  body?: BodyInit | null,
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

    case 'query': {
      const paramName = (config.paramName as string) || 'key';
      const secretRef = (config.secretRef as string) || 'token';
      const secretValue = secrets[secretRef];
      if (secretValue) {
        url.searchParams.set(paramName, secretValue);
      }
      break;
    }

    case 'aws-s3': {
      const accessKeyRef = (config.accessKeyRef as string) || 'access_key';
      const secretKeyRef = (config.secretKeyRef as string) || 'secret_key';
      const accessKey = secrets[accessKeyRef] || '';
      const secretKey = secrets[secretKeyRef] || '';
      if (accessKey && secretKey) {
        signAwsV4({
          method,
          url,
          headers,
          body: body instanceof ArrayBuffer ? body : typeof body === 'string' ? body : null,
          accessKey,
          secretKey,
          region: (config.region as string) || 'us-east-1',
          service: (config.service as string) || 's3',
          signPayload: (config.signPayload as boolean) ?? false,
        });
      }
      break;
    }

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
  consumerBody: string | null,
  consumerBodyRaw?: ArrayBuffer | null,
): BodyInit | undefined {
  if (endpoint.bodyTransform === 'binary') {
    return consumerBodyRaw ? consumerBodyRaw : undefined;
  }

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
