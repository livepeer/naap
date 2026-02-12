/**
 * Service Gateway — Config Resolver
 *
 * Loads connector + endpoint configuration from the database,
 * with an in-memory cache (60s TTL) to avoid DB hits on every request.
 * All queries are team-scoped.
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

function getCacheKey(teamId: string, slug: string, method: string, path: string): string {
  return `gw:config:${teamId}:${slug}:${method}:${path}`;
}

/**
 * Invalidate all cached configs for a connector (called on admin updates)
 */
export function invalidateConnectorCache(teamId: string, slug: string): void {
  const prefix = `gw:config:${teamId}:${slug}:`;
  for (const key of CONFIG_CACHE.keys()) {
    if (key.startsWith(prefix)) {
      CONFIG_CACHE.delete(key);
    }
  }
}

/**
 * Resolve connector + endpoint config for a gateway request.
 *
 * @param teamId  - Caller's team ID (resolved from auth BEFORE this call)
 * @param slug    - Connector slug from URL path
 * @param method  - HTTP method (GET, POST, etc.)
 * @param path    - Consumer endpoint path (e.g. "/query")
 */
export async function resolveConfig(
  teamId: string,
  slug: string,
  method: string,
  path: string
): Promise<ResolvedConfig | null> {
  const cacheKey = getCacheKey(teamId, slug, method, path);

  // Check cache
  const cached = CONFIG_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  // Load from DB — always team-scoped
  const connector = await prisma.serviceConnector.findUnique({
    where: {
      teamId_slug: { teamId, slug },
    },
    include: {
      endpoints: true,
    },
  });

  if (!connector || connector.status !== 'published') {
    CONFIG_CACHE.set(cacheKey, { config: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  // Find matching endpoint
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const endpoint = connector.endpoints.find(
    (ep) =>
      ep.enabled &&
      ep.method.toUpperCase() === method.toUpperCase() &&
      matchPath(ep.path, normalizedPath)
  );

  if (!endpoint) {
    CONFIG_CACHE.set(cacheKey, { config: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  const resolvedConnector: ResolvedConnector = {
    id: connector.id,
    teamId: connector.teamId,
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
