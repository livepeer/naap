/**
 * Service Gateway — Idempotency Support
 *
 * Caches responses by idempotency key so that retried requests
 * return the same response without re-executing the upstream call.
 * Uses @naap/cache for Redis (production) / in-memory (dev) parity.
 */

const IDEMPOTENCY_TTL_S = 300; // 5 minutes
const PREFIX = 'gw:idempotency';

export interface CachedResponse {
  status: number;
  body: string;
  contentType: string;
  headers: Record<string, string>;
}

export async function checkIdempotency(
  teamId: string,
  connectorSlug: string,
  endpointPath: string,
  idempotencyKey: string,
  method: string
): Promise<CachedResponse | null> {
  try {
    const { cacheGet } = await import('@naap/cache');
    const key = buildKey(teamId, connectorSlug, endpointPath, idempotencyKey, method);
    return await cacheGet<CachedResponse>(key, { prefix: PREFIX });
  } catch {
    return null;
  }
}

export async function storeIdempotency(
  teamId: string,
  connectorSlug: string,
  endpointPath: string,
  idempotencyKey: string,
  method: string,
  response: CachedResponse
): Promise<void> {
  try {
    const { cacheSet } = await import('@naap/cache');
    const key = buildKey(teamId, connectorSlug, endpointPath, idempotencyKey, method);
    await cacheSet(key, response, { prefix: PREFIX, ttl: IDEMPOTENCY_TTL_S });
  } catch {
    // Non-critical — worst case, retry hits upstream again
  }
}

function buildKey(
  teamId: string,
  connectorSlug: string,
  endpointPath: string,
  idempotencyKey: string,
  method: string
): string {
  return `${teamId}:${connectorSlug}:${method}:${endpointPath}:${idempotencyKey}`;
}
