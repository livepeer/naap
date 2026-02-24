/**
 * Service Gateway — Config Resolver
 *
 * Loads connector + endpoint configuration from the database,
 * with an in-memory cache (60s TTL) to avoid DB hits on every request.
 *
 * Supports polymorphic ownership:
 *   - Team scope:     `scopeId` is a team UUID → lookup by `{ teamId, slug }`
 *   - Personal scope: `scopeId` is `personal:<userId>` → lookup by `{ ownerUserId, slug }`
 */

import { prisma } from '@/lib/db';
import type { ResolvedConfig, ResolvedConnector, ResolvedEndpoint } from './types';

// ── In-Memory Cache ──

interface CacheEntry {
  config: ResolvedConfig | null;
  expiresAt: number;
}

const CONFIG_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 60 seconds
const NEGATIVE_CACHE_TTL_MS = 5_000; // 5 seconds for not-found results

function getCacheKey(scopeId: string, slug: string, method: string, path: string): string {
  return `gw:config:${scopeId}:${slug}:${method}:${path}`;
}

/**
 * Invalidate all cached configs for a connector (called on admin updates).
 * `scopeId` can be a teamId or `personal:<userId>`.
 */
export function invalidateConnectorCache(scopeId: string, slug: string): void {
  const prefix = `gw:config:${scopeId}:${slug}:`;
  for (const key of CONFIG_CACHE.keys()) {
    if (key.startsWith(prefix)) {
      CONFIG_CACHE.delete(key);
    }
  }
}

/**
 * Find a connector by owner scope + slug.
 * Personal scope queries by `ownerUserId`; team scope queries by `teamId`.
 */
async function findConnectorByOwner(scopeId: string, slug: string) {
  if (scopeId.startsWith('personal:')) {
    const ownerUserId = scopeId.slice('personal:'.length);
    return prisma.serviceConnector.findUnique({
      where: { ownerUserId_slug: { ownerUserId, slug } },
      include: { endpoints: true },
    });
  }
  return prisma.serviceConnector.findUnique({
    where: { teamId_slug: { teamId: scopeId, slug } },
    include: { endpoints: true },
  });
}

/**
 * Resolve connector + endpoint config for a gateway request.
 *
 * @param scopeId - Caller's scope: a team UUID or `personal:<userId>`
 * @param slug    - Connector slug from URL path
 * @param method  - HTTP method (GET, POST, etc.)
 * @param path    - Consumer endpoint path (e.g. "/query")
 */
export async function resolveConfig(
  scopeId: string,
  slug: string,
  method: string,
  path: string
): Promise<ResolvedConfig | null> {
  const cacheKey = getCacheKey(scopeId, slug, method, path);

  const cached = CONFIG_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  const connector = await findConnectorByOwner(scopeId, slug);

  if (!connector || connector.status !== 'published') {
    CONFIG_CACHE.set(cacheKey, { config: null, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
    return null;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const endpoint = connector.endpoints.find(
    (ep) =>
      ep.enabled &&
      ep.method.toUpperCase() === method.toUpperCase() &&
      matchPath(ep.path, normalizedPath)
  );

  if (!endpoint) {
    CONFIG_CACHE.set(cacheKey, { config: null, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
    return null;
  }

  const resolvedConnector: ResolvedConnector = {
    id: connector.id,
    teamId: connector.teamId,
    ownerUserId: connector.ownerUserId,
    slug: connector.slug,
    displayName: connector.displayName,
    status: connector.status,
    upstreamBaseUrl: connector.upstreamBaseUrl,
    allowedHosts: connector.allowedHosts,
    defaultTimeout: connector.defaultTimeout,
    healthCheckPath: connector.healthCheckPath,
    authType: connector.authType,
    authConfig: connector.authConfig as Record<string, unknown>,
    secretRefs: connector.secretRefs,
    responseWrapper: connector.responseWrapper,
    streamingEnabled: connector.streamingEnabled,
    errorMapping: connector.errorMapping as Record<string, string>,
  };

  const resolvedEndpoint: ResolvedEndpoint = {
    id: endpoint.id,
    connectorId: endpoint.connectorId,
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    enabled: endpoint.enabled,
    upstreamMethod: endpoint.upstreamMethod,
    upstreamPath: endpoint.upstreamPath,
    upstreamContentType: endpoint.upstreamContentType,
    upstreamQueryParams: endpoint.upstreamQueryParams as Record<string, string>,
    upstreamStaticBody: endpoint.upstreamStaticBody,
    bodyTransform: endpoint.bodyTransform,
    headerMapping: endpoint.headerMapping as Record<string, string>,
    rateLimit: endpoint.rateLimit,
    timeout: endpoint.timeout,
    maxRequestSize: endpoint.maxRequestSize,
    maxResponseSize: endpoint.maxResponseSize,
    cacheTtl: endpoint.cacheTtl,
    retries: endpoint.retries,
    bodyPattern: endpoint.bodyPattern,
    bodyBlacklist: endpoint.bodyBlacklist,
    bodySchema: endpoint.bodySchema,
    requiredHeaders: endpoint.requiredHeaders,
  };

  const config: ResolvedConfig = {
    connector: resolvedConnector,
    endpoint: resolvedEndpoint,
  };

  CONFIG_CACHE.set(cacheKey, { config, expiresAt: Date.now() + CACHE_TTL_MS });
  return config;
}

/**
 * Match consumer path against endpoint path pattern.
 * Supports simple wildcard segments: /tables/:name -> /tables/foo
 */
function matchPath(pattern: string, actual: string): boolean {
  const patternParts = pattern.split('/').filter(Boolean);
  const actualParts = actual.split('/').filter(Boolean);

  if (patternParts.length !== actualParts.length) return false;

  return patternParts.every((part, i) => {
    if (part.startsWith(':')) return true; // wildcard segment
    return part === actualParts[i];
  });
}
