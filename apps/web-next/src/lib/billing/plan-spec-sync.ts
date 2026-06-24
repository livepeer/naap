/**
 * Plan-spec PULL & per-app discovery sync (NAAP P4, Deliverable 2).
 *
 * Generalizes the single-app `fetchPymthouseDiscoveryPlans()` (global
 * `PYMTHOUSE_*` env) into a PER-`ProviderInstance` pull that:
 *   1. derives the instance's pull creds from its NON-SECRET `config` + the M2M
 *      secret in `SecretVault` (never global env, never logged),
 *   2. upserts each pulled plan as a `ProviderPlan` row keyed
 *      `[providerInstanceId, providerPlanId]` with a content `revision`,
 *   3. on a NEW or CHANGED revision, auto-creates/refreshes the per-app
 *      `DiscoveryPlan` (`billingPlanId = "${instanceId}:${planId}"`) the
 *      orchestrator-leaderboard already serves — no manual `createPlan`.
 *
 * Zero regression: gated by `plan_spec_sync` (default OFF). With the flag OFF
 * this module is a no-op — `ProviderPlan`/auto-`DiscoveryPlan` are never read or
 * written, and discovery stays exactly today's static `storyboard-default`
 * behavior. Idempotent: re-running with an unchanged spec recomputes the same
 * revision and writes nothing new (no duplicate rows). Graceful: a provider
 * whose plan API is unavailable (null pull) is skipped, never hard-failing the
 * whole sync or live discovery.
 */

import 'server-only';

import { Prisma } from '@naap/database';
import { getBuilderApiV1BaseFromIssuerUrl } from '@pymthouse/builder-sdk/config';

import { prisma } from '@/lib/db';
import { isFeatureEnabled, PLAN_SPEC_SYNC_FLAG } from '@/lib/feature-flags';
import {
  fetchPymthouseDiscoveryPlans,
  type PymthouseDiscoveryPlansCreds,
  type PymthouseDiscoveryPlansResponse,
} from '@/lib/pymthouse-discovery-plans';

import {
  buildAutoDiscoveryPlanId,
  computeProviderPlanRevision,
  planRowToCapabilities,
  toAutoDiscoveryPlanFields,
} from './auto-discovery-plan';
import { PYMTHOUSE_ADAPTER_SLUG } from './pymthouse-adapter';
import {
  getProviderInstanceSecret,
  parsePymthouseInstanceConfig,
  type ProviderInstanceRecord,
} from './provider-instance';

export { PLAN_SPEC_SYNC_FLAG } from '@/lib/feature-flags';

/** Per-instance pull dependency (injectable for tests). */
export type PlanPullFn = (
  creds: PymthouseDiscoveryPlansCreds,
  signal?: AbortSignal,
) => Promise<PymthouseDiscoveryPlansResponse | null>;

const defaultPlanPull: PlanPullFn = (creds, signal) =>
  fetchPymthouseDiscoveryPlans({ creds, signal });

/** Coerce a validated policy object to Prisma Json input (or skip when null). */
function jsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null ? undefined : (value as Prisma.InputJsonValue);
}

/** Outcome of syncing a single ProviderInstance. */
export interface InstanceSyncResult {
  providerInstanceId: string;
  /**
   * - `synced`: pull succeeded (rows upserted; may be 0 plans).
   * - `unavailable`: provider plan API/creds unavailable → skipped (graceful).
   * - `unsupported`: adapterType has no plan-spec pull yet → skipped.
   */
  status: 'synced' | 'unavailable' | 'unsupported';
  plansUpserted: number;
  discoveryPlansUpserted: number;
}

export interface SyncAllResult {
  /** False when `plan_spec_sync` is OFF (no-op, table untouched). */
  enabled: boolean;
  instances: InstanceSyncResult[];
}

/**
 * Build the per-instance pymthouse pull creds from a `ProviderInstance` row.
 * Returns null when the adapterType is non-pymthouse, the non-secret config is
 * incomplete, the issuer URL cannot resolve an API base, or the M2M secret is
 * missing — callers skip (graceful) rather than throw. The secret is read only
 * via `SecretVault` and never logged.
 */
export async function buildPymthousePullCreds(
  instance: ProviderInstanceRecord,
): Promise<PymthouseDiscoveryPlansCreds | null> {
  if (instance.adapterType !== PYMTHOUSE_ADAPTER_SLUG) {
    return null;
  }
  const config = parsePymthouseInstanceConfig(instance.config);
  if (!config || !instance.secretRef) {
    return null;
  }
  let apiV1Base: string;
  try {
    apiV1Base = getBuilderApiV1BaseFromIssuerUrl(config.issuerUrl);
  } catch {
    return null;
  }
  if (!apiV1Base) {
    return null;
  }
  const m2mClientSecret = await getProviderInstanceSecret(instance.secretRef);
  if (!m2mClientSecret) {
    return null;
  }
  return {
    apiV1Base,
    publicClientId: config.publicClientId,
    m2mClientId: config.m2mClientId,
    m2mClientSecret,
  };
}

/**
 * Upsert one pulled plan into `ProviderPlan` (idempotent on
 * `[providerInstanceId, providerPlanId]`) and, when the spec is new or its
 * revision changed, refresh the auto per-app `DiscoveryPlan`. Returns whether a
 * DiscoveryPlan write happened so the caller can count regenerations.
 */
async function upsertPlanAndDiscovery(
  instance: ProviderInstanceRecord,
  plan: PymthouseDiscoveryPlansResponse['plans'][number],
): Promise<{ discoveryUpserted: boolean }> {
  const capabilities = planRowToCapabilities(plan);
  const revision = computeProviderPlanRevision({
    name: plan.name,
    capabilities,
    discoveryPolicy: plan.discoveryPolicy,
  });

  const existing = await prisma.providerPlan.findUnique({
    where: {
      providerInstanceId_providerPlanId: {
        providerInstanceId: instance.id,
        providerPlanId: plan.id,
      },
    },
    select: { revision: true },
  });

  const revisionChanged = !existing || existing.revision !== revision;

  await prisma.providerPlan.upsert({
    where: {
      providerInstanceId_providerPlanId: {
        providerInstanceId: instance.id,
        providerPlanId: plan.id,
      },
    },
    create: {
      providerInstanceId: instance.id,
      providerPlanId: plan.id,
      name: plan.name,
      capabilities,
      discoveryPolicy: jsonOrUndefined(plan.discoveryPolicy),
      revision,
      source: 'pull',
      enabled: true,
      syncedAt: new Date(),
    },
    update: {
      name: plan.name,
      capabilities,
      discoveryPolicy: jsonOrUndefined(plan.discoveryPolicy),
      revision,
      source: 'pull',
      enabled: true,
      syncedAt: new Date(),
    },
  });

  // Idempotent: only (re)generate the per-app discovery when the spec changed.
  if (!revisionChanged) {
    return { discoveryUpserted: false };
  }

  const billingPlanId = buildAutoDiscoveryPlanId(instance.id, plan.id);
  const fields = toAutoDiscoveryPlanFields({
    adapterType: instance.adapterType,
    name: plan.name,
    capabilities,
    discoveryPolicy: plan.discoveryPolicy,
  });

  await prisma.discoveryPlan.upsert({
    where: { billingPlanId },
    create: {
      billingPlanId,
      billingProviderSlug: fields.billingProviderSlug,
      name: fields.name,
      visibility: 'public',
      capabilities: fields.capabilities,
      topN: fields.topN,
      slaWeights: jsonOrUndefined(fields.slaWeights),
      slaMinScore: fields.slaMinScore ?? undefined,
      sortBy: fields.sortBy ?? undefined,
      filters: jsonOrUndefined(fields.filters),
      enabled: true,
    },
    update: {
      billingProviderSlug: fields.billingProviderSlug,
      name: fields.name,
      capabilities: fields.capabilities,
      topN: fields.topN,
      slaWeights: jsonOrUndefined(fields.slaWeights),
      slaMinScore: fields.slaMinScore ?? undefined,
      sortBy: fields.sortBy ?? undefined,
      filters: jsonOrUndefined(fields.filters),
      enabled: true,
    },
  });

  return { discoveryUpserted: true };
}

/**
 * Sync a single `ProviderInstance`'s published plans → `ProviderPlan` rows +
 * auto `DiscoveryPlan`s. Never throws: unsupported adapter / unavailable
 * provider degrade to a skipped result.
 */
export async function syncProviderInstancePlans(
  instance: ProviderInstanceRecord,
  deps?: { pull?: PlanPullFn; signal?: AbortSignal },
): Promise<InstanceSyncResult> {
  const base: InstanceSyncResult = {
    providerInstanceId: instance.id,
    status: 'unavailable',
    plansUpserted: 0,
    discoveryPlansUpserted: 0,
  };

  const creds = await buildPymthousePullCreds(instance);
  if (!creds) {
    return {
      ...base,
      status: instance.adapterType === PYMTHOUSE_ADAPTER_SLUG ? 'unavailable' : 'unsupported',
    };
  }

  const pull = deps?.pull ?? defaultPlanPull;
  let pulled: PymthouseDiscoveryPlansResponse | null;
  try {
    pulled = await pull(creds, deps?.signal);
  } catch {
    return base;
  }
  if (!pulled) {
    return base;
  }

  let plansUpserted = 0;
  let discoveryPlansUpserted = 0;
  for (const plan of pulled.plans) {
    try {
      const res = await upsertPlanAndDiscovery(instance, plan);
      plansUpserted += 1;
      if (res.discoveryUpserted) discoveryPlansUpserted += 1;
    } catch (err) {
      console.error('[plan-spec-sync] upsert failed', {
        providerInstanceId: instance.id,
        providerPlanId: plan.id,
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return {
    providerInstanceId: instance.id,
    status: 'synced',
    plansUpserted,
    discoveryPlansUpserted,
  };
}

/**
 * Flag-gated sync of ALL enabled `ProviderInstance`s. With `plan_spec_sync` OFF
 * this is a strict no-op (`{ enabled: false }`) — the table is never read or
 * written and discovery is unchanged. Never throws.
 */
export async function syncAllProviderInstancePlans(deps?: {
  pull?: PlanPullFn;
  signal?: AbortSignal;
}): Promise<SyncAllResult> {
  let flagOn = false;
  try {
    flagOn = await isFeatureEnabled(PLAN_SPEC_SYNC_FLAG);
  } catch {
    flagOn = false;
  }
  if (!flagOn) {
    return { enabled: false, instances: [] };
  }

  let instances: ProviderInstanceRecord[];
  try {
    instances = await prisma.providerInstance.findMany({
      where: { enabled: true },
      select: {
        id: true,
        adapterType: true,
        slug: true,
        config: true,
        secretRef: true,
        enabled: true,
      },
    });
  } catch {
    return { enabled: true, instances: [] };
  }

  const results: InstanceSyncResult[] = [];
  for (const instance of instances) {
    results.push(await syncProviderInstancePlans(instance, deps));
  }
  return { enabled: true, instances: results };
}
