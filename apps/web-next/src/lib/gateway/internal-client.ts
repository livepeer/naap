/**
 * Service Gateway — Internal Client
 *
 * Executes the gateway resolve -> cache -> secrets -> transform -> proxy
 * pipeline in-process, without an HTTP round-trip. Used by the BFF layer
 * to call managed connectors server-side.
 *
 * Shares the same in-memory response cache as the HTTP gateway route,
 * so cache hits are instant and cache TTLs come from the endpoint config.
 */

import { resolveConfig } from './resolve';
import { resolveSecrets } from './secrets';
import { buildUpstreamRequest } from './transform';
import { proxyToUpstream, ProxyError } from './proxy';
import { getCachedResponse, setCachedResponse, buildCacheKey } from './cache';
import './transforms';

const SYSTEM_SCOPE = 'public';

export interface ManagedConnectorOptions {
  queryParams?: Record<string, string>;
}

/**
 * Query a managed (or any public) connector endpoint in-process.
 *
 * Resolves the connector from DB/cache, checks the response cache,
 * injects secrets, and proxies to upstream — all without an HTTP hop.
 *
 * Returns raw upstream Response on success, or throws on failure.
 */
export async function queryManagedConnector(
  slug: string,
  endpointPath: string,
  options?: ManagedConnectorOptions,
): Promise<Response> {
  const method = 'GET';
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;

  const config = await resolveConfig(SYSTEM_SCOPE, slug, method, normalizedPath);
  if (!config) {
    throw new Error(`[gateway/internal] No published connector "${slug}" with ${method} ${normalizedPath}`);
  }

  const queryString = options?.queryParams
    ? '?' + new URLSearchParams(options.queryParams).toString()
    : '';
  const cacheKey = buildCacheKey(SYSTEM_SCOPE, slug, method, normalizedPath + queryString, null);
  const cacheTtl = config.endpoint.cacheTtl;

  if (cacheTtl && cacheTtl > 0) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { ...cached.headers, 'X-Gateway-Cache': 'HIT' },
      });
    }
  }

  let secretScopeId = SYSTEM_SCOPE;
  if (config.connector.visibility === 'public') {
    if (config.connector.ownerUserId) {
      secretScopeId = `personal:${config.connector.ownerUserId}`;
    } else if (config.connector.teamId) {
      secretScopeId = config.connector.teamId;
    }
  }
  const secrets = await resolveSecrets(secretScopeId, config.connector.secretRefs, null, config.connector.slug);

  const syntheticUrl = `http://internal/api/v1/gw/${slug}${normalizedPath}${queryString}`;
  const syntheticRequest = new Request(syntheticUrl, { method });

  const upstream = buildUpstreamRequest(syntheticRequest, config, secrets, null, normalizedPath);

  const timeout = config.endpoint.timeout || config.connector.defaultTimeout;
  let proxyResult;
  try {
    proxyResult = await proxyToUpstream(
      upstream,
      timeout,
      config.endpoint.retries,
      config.connector.allowedHosts,
      config.connector.streamingEnabled,
      config.connector.slug,
    );
  } catch (err) {
    const proxyError = err instanceof ProxyError ? err : new ProxyError('UPSTREAM_ERROR', String(err), 502);
    throw new Error(`[gateway/internal] ${proxyError.code}: ${proxyError.message}`);
  }

  const response = proxyResult.response;

  if (cacheTtl && cacheTtl > 0 && response.status >= 200 && response.status < 300) {
    const cloned = response.clone();
    const responseBody = await cloned.arrayBuffer();
    const headers: Record<string, string> = {};
    cloned.headers.forEach((v, k) => { headers[k] = v; });
    setCachedResponse(cacheKey, { body: responseBody, status: cloned.status, headers }, cacheTtl);
  }

  return response;
}

/**
 * Check whether a managed connector is configured (exists and is published).
 */
export async function isManagedConnectorConfigured(slug: string): Promise<boolean> {
  try {
    const config = await resolveConfig(SYSTEM_SCOPE, slug, 'GET', '/gpu-capacity');
    return config !== null;
  } catch {
    return false;
  }
}
