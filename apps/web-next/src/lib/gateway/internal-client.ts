/**
 * Server-side gateway caller for internal consumers (dashboard BFF, etc).
 *
 * Reuses the gateway resolution/transform/proxy pipeline without going through
 * the auth-gated external `/api/v1/gw/:connector/...` route. Designed for
 * server-side code that needs to call published connectors directly.
 *
 * For connectors with env-backed credentials (never stored in DB), callers
 * pass `secretsOverride` to inject secrets at runtime.
 */

import { resolveConfig } from './resolve';
import { buildUpstreamRequest } from './transform';
import { proxyToUpstream } from './proxy';
import { resolveSecrets } from './secrets';
import type { ResolvedSecrets } from './types';
import './transforms';

/**
 * Scope string that will never match a real team or personal scope, forcing
 * `resolveConfig` to fall through to the public-connector lookup.
 */
const INTERNAL_SCOPE = 'internal:system';

export interface InternalCallOptions {
  slug: string;
  method: string;
  endpointPath: string;
  body?: string | null;
  searchParams?: URLSearchParams;
  /** Runtime secrets that bypass SecretVault (e.g. env-backed credentials). */
  secretsOverride?: ResolvedSecrets;
  /** Runtime base URL override (e.g. CLICKHOUSE_URL from env). */
  baseUrlOverride?: string;
  timeout?: number;
}

export interface InternalCallResult {
  response: Response;
  upstreamLatencyMs: number;
}

interface DirectFallbackRequest {
  url: string;
  headers: Headers;
}

function withSearchParams(url: URL, searchParams?: URLSearchParams): URL {
  if (!searchParams) return url;
  searchParams.forEach((v, k) => url.searchParams.set(k, v));
  return url;
}

function buildLeaderboardFallback(options: InternalCallOptions): DirectFallbackRequest | null {
  const base = process.env.LEADERBOARD_API_URL?.trim();
  if (!base) return null;
  const relPath = options.endpointPath.replace(/^\/+/, '');
  const url = withSearchParams(
    new URL(`${base.replace(/\/+$/, '')}/${relPath}`),
    options.searchParams,
  );
  return {
    url: url.toString(),
    headers: new Headers({ Accept: 'application/json' }),
  };
}

function buildClickhouseFallback(options: InternalCallOptions): DirectFallbackRequest | null {
  const base = (options.baseUrlOverride ?? process.env.CLICKHOUSE_URL)?.trim();
  if (!base) return null;

  const username =
    options.secretsOverride?.username ?? process.env.CLICKHOUSE_USER?.trim() ?? '';
  const password =
    options.secretsOverride?.password ?? process.env.CLICKHOUSE_PASSWORD?.trim() ?? '';
  if (!username || !password) return null;

  const upstreamPath = options.endpointPath === '/query' ? '/' : options.endpointPath;
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  const url = withSearchParams(
    new URL(`${base.replace(/\/+$/, '')}${path}`),
    options.searchParams,
  );

  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  headers.set('Authorization', `Basic ${basic}`);

  return {
    url: url.toString(),
    headers,
  };
}

const DIRECT_FALLBACK_BUILDERS: Record<
  string,
  (options: InternalCallOptions) => DirectFallbackRequest | null
> = {
  'livepeer-leaderboard': buildLeaderboardFallback,
  clickhouse: buildClickhouseFallback,
};

async function directFallbackRequest(options: InternalCallOptions): Promise<InternalCallResult | null> {
  const builder = DIRECT_FALLBACK_BUILDERS[options.slug];
  if (!builder) return null;

  const request = builder(options);
  if (!request) return null;

  const t0 = Date.now();
  const response = await fetch(request.url, {
    method: options.method,
    headers: request.headers,
    body: options.body ?? undefined,
    signal: AbortSignal.timeout(options.timeout ?? 60_000),
  });

  return {
    response,
    upstreamLatencyMs: Date.now() - t0,
  };
}

/**
 * Call a published connector internally, bypassing the external gateway auth
 * layer. Uses the same resolve -> transform -> proxy pipeline as the public
 * gateway route but returns the raw upstream Response so callers can apply
 * their own parsing and caching.
 */
export async function callConnectorInternal(
  options: InternalCallOptions,
): Promise<InternalCallResult> {
  let config: Awaited<ReturnType<typeof resolveConfig>> | null;
  try {
    config = await resolveConfig(
      INTERNAL_SCOPE,
      options.slug,
      options.method,
      options.endpointPath,
    );
  } catch (err) {
    const fallback = await directFallbackRequest(options);
    if (fallback) return fallback;
    throw err;
  }

  if (!config) {
    const fallback = await directFallbackRequest(options);
    if (fallback) return fallback;
    throw new Error(
      `[gateway/internal] No published connector "${options.slug}" with ` +
      `${options.method} ${options.endpointPath}`,
    );
  }

  if (options.baseUrlOverride) {
    const overrideUrl = options.baseUrlOverride.replace(/\/+$/, '');
    let allowedHosts: string[];
    try {
      allowedHosts = [new URL(overrideUrl).hostname];
    } catch {
      allowedHosts = config.connector.allowedHosts;
    }
    config = {
      ...config,
      connector: {
        ...config.connector,
        upstreamBaseUrl: overrideUrl,
        allowedHosts,
      },
    };
  }

  let secrets: ResolvedSecrets;
  if (options.secretsOverride) {
    secrets = options.secretsOverride;
  } else if (config.connector.secretRefs.length > 0) {
    let secretScopeId = INTERNAL_SCOPE;
    if (config.connector.visibility === 'public') {
      if (config.connector.ownerUserId) {
        secretScopeId = `personal:${config.connector.ownerUserId}`;
      } else if (config.connector.teamId) {
        secretScopeId = config.connector.teamId;
      }
    }
    secrets = await resolveSecrets(
      secretScopeId,
      config.connector.secretRefs,
      null,
      config.connector.slug,
    );
  } else {
    secrets = {};
  }

  const syntheticUrl = new URL(
    `https://internal.gateway/${options.slug}${options.endpointPath}`,
  );
  if (options.searchParams) {
    options.searchParams.forEach((v, k) => syntheticUrl.searchParams.set(k, v));
  }
  const syntheticRequest = new Request(syntheticUrl.toString(), {
    method: options.method,
    headers: { Accept: 'application/json' },
  });

  const upstream = buildUpstreamRequest(
    syntheticRequest,
    config,
    secrets,
    options.body ?? null,
    options.endpointPath,
  );

  const timeout =
    options.timeout ??
    config.endpoint.timeout ??
    config.connector.defaultTimeout;

  const proxyResult = await proxyToUpstream(
    upstream,
    timeout,
    config.endpoint.retries,
    config.connector.allowedHosts,
    config.connector.streamingEnabled,
    config.connector.slug,
  );

  return {
    response: proxyResult.response,
    upstreamLatencyMs: proxyResult.upstreamLatencyMs,
  };
}
