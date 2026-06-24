/**
 * Auto per-app discovery generation — DB-free mapping (NAAP P4, Deliverable 2).
 *
 * Turns a synced provider plan-spec (`ProviderPlan`, pulled per
 * `ProviderInstance`) into:
 *   - the normalized `capabilities` list (`pipeline/modelId` strings),
 *   - a content `revision` fingerprint (idempotency key for the sync),
 *   - the `DiscoveryPlan` field set the orchestrator-leaderboard already serves
 *     via `GET /plans/:id/python-gateway` (capability-filtered + tier-shuffled).
 *
 * Pure + side-effect free so it can be unit-tested without a DB. The persistence
 * (upsert) lives in `plan-spec-sync.ts`; the request-time selection lives in
 * `key-discovery.ts`. Both reuse {@link buildAutoDiscoveryPlanId} so the
 * key → ProviderPlan → DiscoveryPlan id mapping cannot drift.
 */

import { createHash } from 'node:crypto';

import type {
  DiscoveryPolicy,
  PymthouseDiscoveryPlanRow,
} from '@/lib/pymthouse-discovery-plans';

/** DiscoveryPlan.topN default when the provider plan-spec sets no policy topN. */
export const AUTO_DISCOVERY_DEFAULT_TOP_N = 10;

/**
 * Deterministic `DiscoveryPlan.billingPlanId` for an auto-generated per-app
 * discovery: `"${providerInstanceId}:${providerPlanId}"`. This is the stable
 * idempotency key (the column is `@unique`) AND the bridge the request-time
 * resolver uses to map `key → Subscription → ProviderPlan → DiscoveryPlan`.
 */
export function buildAutoDiscoveryPlanId(
  providerInstanceId: string,
  providerPlanId: string,
): string {
  return `${providerInstanceId}:${providerPlanId}`;
}

/**
 * Normalize a pulled plan row's capabilities into the leaderboard
 * `pipeline/modelId` strings, de-duplicated and sorted for a stable fingerprint.
 * Rows missing either part are dropped (they cannot match an orchestrator).
 */
export function planRowToCapabilities(row: PymthouseDiscoveryPlanRow): string[] {
  const set = new Set<string>();
  for (const cap of row.capabilities) {
    const pipeline = cap.pipeline.trim();
    const modelId = cap.modelId.trim();
    if (!pipeline || !modelId) continue;
    set.add(`${pipeline}/${modelId}`);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Content fingerprint of the meaningful, discovery-affecting fields of a plan
 * spec. Re-running the sync recomputes the same revision for an unchanged spec,
 * so the upsert is idempotent and only a genuine change re-generates the
 * `DiscoveryPlan`. Stable JSON (sorted keys) keeps the hash order-independent.
 */
export function computeProviderPlanRevision(input: {
  name: string;
  capabilities: string[];
  discoveryPolicy: DiscoveryPolicy | null;
}): string {
  const payload = stableStringify({
    name: input.name,
    capabilities: [...input.capabilities].sort((a, b) => a.localeCompare(b)),
    discoveryPolicy: input.discoveryPolicy ?? null,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/** DiscoveryPlan fields auto-derived from a ProviderPlan spec. */
export interface AutoDiscoveryPlanFields {
  name: string;
  billingProviderSlug: string;
  capabilities: string[];
  topN: number;
  slaWeights: DiscoveryPolicy['slaWeights'] | null;
  slaMinScore: number | null;
  sortBy: string | null;
  filters: DiscoveryPolicy['filters'] | null;
}

/**
 * Map a synced provider plan-spec onto the `DiscoveryPlan` field set. The
 * `discoveryPolicy` (topN/sortBy/slaMinScore/slaWeights/filters) flows straight
 * through onto the DiscoveryPlan, so the existing per-cap filter + tier-shuffle
 * serve the per-app discovery with no route change.
 */
export function toAutoDiscoveryPlanFields(input: {
  adapterType: string;
  name: string;
  capabilities: string[];
  discoveryPolicy: DiscoveryPolicy | null;
}): AutoDiscoveryPlanFields {
  const policy = input.discoveryPolicy;
  return {
    name: input.name,
    billingProviderSlug: input.adapterType,
    capabilities: input.capabilities,
    topN: policy?.topN ?? AUTO_DISCOVERY_DEFAULT_TOP_N,
    slaWeights: policy?.slaWeights ?? null,
    slaMinScore: policy?.slaMinScore ?? null,
    sortBy: policy?.sortBy ?? null,
    filters: policy?.filters ?? null,
  };
}

/** Stable JSON stringify (recursively sorted object keys) for fingerprinting. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
