/**
 * Server-side gateway caller for internal consumers (dashboard BFF, etc).
 *
 * Reuses the gateway resolution/transform/proxy pipeline without going through
 * the auth-gated external `/api/v1/gw/:connector/...` route. Designed for
 * server-side code that needs to call published connectors directly.
 *
 * Security (high level):
 * - This module is server-only (`import 'server-only'`); it must never be
 *   imported from client components or shared code that runs in the browser.
 * - It is not an HTTP route: nothing is "exposed" unless some route handler
 *   calls it. It does not accept end-user connector slugs without the same
 *   trust assumptions as any other server BFF code.
 * - It does not use per-connector "gateway API keys" that external clients
 *   use on `/api/v1/gw/...`. Those keys gate the public proxy; internal
 *   callers bypass that layer by design because they already run on the server.
 * - Secrets: dashboard ClickHouse calls pass `secretsOverride` from env at
 *   runtime so credentials are not required from SecretVault for those paths.
 *   If `secretsOverride` is omitted and the connector has `secretRefs`,
 *   `resolveSecrets` is used (same as the external gateway path).
 */

import 'server-only';

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

/**
 * Call a published connector internally, bypassing the external gateway auth
 * layer. Uses the same resolve -> transform -> proxy pipeline as the public
 * gateway route but returns the raw upstream Response so callers can apply
 * their own parsing and caching.
 */
export async function callConnectorInternal(
  options: InternalCallOptions,
): Promise<InternalCallResult> {
  const config = await resolveConfig(
    INTERNAL_SCOPE,
    options.slug,
    options.method,
    options.endpointPath,
  );

  if (!config) {
    throw new Error(
      `[gateway/internal] No published connector "${options.slug}" with ` +
      `${options.method} ${options.endpointPath}. ` +
      `Seed public connectors.`,
    );
  }

  let resolvedConfig = config;
  if (options.baseUrlOverride) {
    const overrideUrl = options.baseUrlOverride.replace(/\/+$/, '');
    let allowedHosts: string[];
    try {
      allowedHosts = [new URL(overrideUrl).hostname];
    } catch {
      allowedHosts = resolvedConfig.connector.allowedHosts;
    }
    resolvedConfig = {
      ...resolvedConfig,
      connector: {
        ...resolvedConfig.connector,
        upstreamBaseUrl: overrideUrl,
        allowedHosts,
      },
    };
  }

  let secrets: ResolvedSecrets;
  if (options.secretsOverride) {
    secrets = options.secretsOverride;
  } else if (resolvedConfig.connector.secretRefs.length > 0) {
    let secretScopeId = INTERNAL_SCOPE;
    if (resolvedConfig.connector.visibility === 'public') {
      if (resolvedConfig.connector.ownerUserId) {
        secretScopeId = `personal:${resolvedConfig.connector.ownerUserId}`;
      } else if (resolvedConfig.connector.teamId) {
        secretScopeId = resolvedConfig.connector.teamId;
      }
    }
    secrets = await resolveSecrets(
      secretScopeId,
      resolvedConfig.connector.secretRefs,
      null,
      resolvedConfig.connector.slug,
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
    resolvedConfig,
    secrets,
    options.body ?? null,
    options.endpointPath,
  );

  const timeout =
    options.timeout ??
    resolvedConfig.endpoint.timeout ??
    resolvedConfig.connector.defaultTimeout;

  const proxyResult = await proxyToUpstream(
    upstream,
    timeout,
    resolvedConfig.endpoint.retries,
    resolvedConfig.connector.allowedHosts,
    resolvedConfig.connector.streamingEnabled,
    resolvedConfig.connector.slug,
  );

  return {
    response: proxyResult.response,
    upstreamLatencyMs: proxyResult.upstreamLatencyMs,
  };
}
