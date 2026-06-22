/**
 * Pymthouse capability resolution (BPP ② — live, NAAP follow-up #1).
 *
 * Resolves the capability grant set for a validated key LIVE from the pymthouse
 * provider, keyed on the account's `externalUserId` (the NaaP
 * `billingAccountRef.accountId`). This reproduces the resolution that the merged
 * pymthouse `POST /api/v1/auth/validate` (BPP ②) performs server-side:
 *
 *   - no subscription, or a subscription without a resolvable plan → delegated
 *     MVP → the wildcard `["*"]` (grants everything the app offers);
 *   - a subscription bound to a plan → that plan's capability bundles, mapped to
 *     canonical `"<pipeline>:<model>"` ids.
 *
 * O1 (subject identity): the merged `POST /api/v1/auth/validate` is keyed on a
 * pymthouse-issued provider API key (`pmth_*`, hashed → `apiKeys` lookup), which
 * NaaP's seat → team → account binding does NOT hold — NaaP holds the provider
 * `externalUserId` (= `accountId`) plus M2M client credentials. Rather than mint
 * and persist a per-account provider API key (a new secret-management surface),
 * we resolve capabilities live through the already-wired M2M client keyed on the
 * externalUserId, reproducing the validate endpoint's own logic. The provider
 * stays the single source of truth (O3: live-only, no local grant table).
 *
 * SECURITY: all provider I/O goes through the env-configured M2M client (never a
 * request-derived URL — preserves the front door's no-SSRF property). The cache
 * is keyed per externalUserId so it never crosses a tenant boundary. Structured
 * logs carry only counts / booleans — never the raw account id or any secret.
 */

import 'server-only';

import { getPmtHouseServerClient } from '@/lib/pymthouse-client';
import { normalizeProviderCapabilities } from '@/lib/capabilities/taxonomy';

/** Canonical wildcard grant returned for delegated (no-plan) accounts. */
const CAPABILITY_WILDCARD = '*';

/** Default short cache TTL (mirrors the 45 s discovery-plans cache pattern). */
const DEFAULT_CACHE_TTL_MS = 45_000;

/** Where the resolved capabilities came from (informational logging only). */
export type CapabilityResolutionSource = 'delegated' | 'plan' | 'plan_unresolved';

/** Live capability resolution result for one account (provider-neutral). */
export interface PymthouseCapabilityResolution {
  capabilities: string[];
  quota: { remaining: number; resetAt?: string } | null;
  /** Neutral, opaque subscription pointer when the account has a subscription. */
  subscriptionRef?: string;
  source: CapabilityResolutionSource;
}

interface CacheEntry {
  at: number;
  data: PymthouseCapabilityResolution;
}

let cache = new Map<string, CacheEntry>();

/** Vitest / isolated tests: clear the per-account capability cache. */
export function resetPymthouseCapabilityCacheForTests(): void {
  cache = new Map<string, CacheEntry>();
}

/** Effective cache TTL (configurable via env, like the usage-pull cache). */
function cacheTtlMs(): number {
  const raw = process.env.PYMTHOUSE_CAPABILITY_CACHE_TTL_MS?.trim();
  if (!raw) return DEFAULT_CACHE_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CACHE_TTL_MS;
}

function log(level: 'info' | 'warn', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'warn') console.warn(line);
  else console.info(line);
}

/**
 * Map a plan's capability bundles to canonical `"<pipeline>:<model>"` ids.
 * Rows missing either part are dropped; the result is taxonomy-normalized so
 * malformed ids never reach the gate as grants.
 */
function mapPlanCapabilities(
  capabilities: ReadonlyArray<{ pipeline?: string | null; modelId?: string | null }>,
): string[] {
  const raw: string[] = [];
  for (const cap of capabilities) {
    const pipeline = cap.pipeline?.trim();
    const modelId = cap.modelId?.trim();
    if (pipeline && modelId) raw.push(`${pipeline}:${modelId}`);
  }
  return normalizeProviderCapabilities(raw);
}

/**
 * Resolve the capability grant set for one account live from pymthouse.
 *
 * Fail-closed contract:
 *   - a provider/transport error PROPAGATES (the front door catches it and
 *     falls back to an empty capability set — deny everything when the gate is
 *     ON); callers must NOT treat a thrown error as "all capabilities";
 *   - a well-formed response with no resolvable plan yields `["*"]` (delegated
 *     MVP, matching the provider's own validate semantics);
 *   - a subscription whose plan cannot be resolved yields `[]` (the key is still
 *     valid, but grants nothing until the plan resolves).
 *
 * @param externalUserId the provider account id (NaaP `billingAccountRef.accountId`)
 */
export async function resolvePymthouseCapabilities(
  externalUserId: string,
  opts?: { skipCache?: boolean },
): Promise<PymthouseCapabilityResolution> {
  const now = Date.now();
  const ttl = cacheTtlMs();

  if (!opts?.skipCache && ttl > 0) {
    const hit = cache.get(externalUserId);
    if (hit && now - hit.at < ttl) {
      log('info', 'pymthouse.capabilities.cache_hit', {
        capabilityCount: hit.data.capabilities.length,
        source: hit.data.source,
      });
      return hit.data;
    }
  }

  const client = getPmtHouseServerClient();

  // Provider errors propagate (fail closed at the front door); do NOT swallow.
  const subscriptionResponse = await client.getUserSubscription(externalUserId);
  const subscription = subscriptionResponse?.subscription ?? null;
  const subscriptionRef = subscription?.id ? subscription.id : undefined;

  let resolution: PymthouseCapabilityResolution;

  if (!subscription || !subscription.planId) {
    // Delegated MVP: capabilities = all (wildcard), quota unmetered.
    resolution = {
      capabilities: [CAPABILITY_WILDCARD],
      quota: null,
      source: 'delegated',
      ...(subscriptionRef ? { subscriptionRef } : {}),
    };
  } else {
    const { products } = await client.listBillingProducts();
    const product = Array.isArray(products)
      ? products.find((p) => p.id === subscription.planId)
      : undefined;

    if (!product) {
      // Subscription bound to a plan we cannot resolve → grant nothing (fail
      // closed) rather than over-grant. Key stays valid.
      log('warn', 'pymthouse.capabilities.plan_unresolved', { hasSubscription: true });
      resolution = {
        capabilities: [],
        quota: null,
        source: 'plan_unresolved',
        ...(subscriptionRef ? { subscriptionRef } : {}),
      };
    } else {
      resolution = {
        capabilities: mapPlanCapabilities(product.capabilities ?? []),
        // O4: quota.remaining enforcement is OUT OF SCOPE for this follow-up; the
        // gate enforces capability membership only, so quota stays null here.
        quota: null,
        source: 'plan',
        ...(subscriptionRef ? { subscriptionRef } : {}),
      };
    }
  }

  if (ttl > 0) {
    cache.set(externalUserId, { at: now, data: resolution });
  }

  log('info', 'pymthouse.capabilities.resolved', {
    capabilityCount: resolution.capabilities.length,
    source: resolution.source,
    cacheHit: false,
  });
  return resolution;
}
