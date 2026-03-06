/**
 * Service Gateway — Request Transform (Orchestrator)
 *
 * Builds the upstream request from consumer request + connector config.
 * Delegates body transformation and auth injection to the strategy registry.
 */

import type {
  ResolvedConfig,
  ResolvedSecrets,
  UpstreamRequest,
} from './types';
import { registry } from './transforms';
import { interpolateSecrets } from './transforms/types';

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
  const headers = buildUpstreamHeaders(endpoint, secrets, request);

  // ── Body (registry-dispatched) ──
  const bodyStrategy = registry.getBody(endpoint.bodyTransform);
  const body = bodyStrategy.transform({
    bodyTransform: endpoint.bodyTransform,
    consumerBody,
    consumerBodyRaw,
    upstreamStaticBody: endpoint.upstreamStaticBody,
  });

  // ── Auth injection (registry-dispatched, after URL + body are finalized) ──
  const authStrategy = registry.getAuth(connector.authType);
  authStrategy.inject({
    headers,
    authConfig: connector.authConfig,
    secrets,
    connectorSlug: connector.slug,
    method,
    url,
    body,
  });

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

  if (consumerSearchParams) {
    consumerSearchParams.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
  }

  const queryParams = endpoint.upstreamQueryParams;
  if (queryParams && typeof queryParams === 'object') {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/**
 * Build upstream headers: content type, custom mappings, observability.
 */
function buildUpstreamHeaders(
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

  const mapping = endpoint.headerMapping;
  if (mapping && typeof mapping === 'object') {
    for (const [key, value] of Object.entries(mapping)) {
      headers.set(key, interpolateSecrets(String(value), secrets));
    }
  }

  const requestId = request.headers.get('x-request-id');
  if (requestId) headers.set('x-request-id', requestId);

  const traceId = request.headers.get('x-trace-id');
  if (traceId) headers.set('x-trace-id', traceId);

  return headers;
}
