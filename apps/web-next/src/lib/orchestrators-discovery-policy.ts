/**
 * Applies PymtHouse app-scoped discovery plans to dashboard orchestrator rows.
 * Used when `pipeline` + `model_id` query params scope the request.
 */

import type { DashboardOrchestrator } from '@naap/plugin-sdk';

import type { DiscoveryPolicy, PymthouseDiscoveryPlansResponse } from '@/lib/pymthouse-discovery-plans';
import { fetchPymthouseDiscoveryPlans, mergeDiscoveryPolicies } from '@/lib/pymthouse-discovery-plans';

function bundleMatches(pipeline: string, modelId: string, b: { pipeline: string; modelId: string }): boolean {
  return b.pipeline === pipeline && (b.modelId === modelId || b.modelId === '*');
}

/**
 * Merge plan default + all bundles that match `{ pipeline, modelId }` (including `modelId === "*"`).
 */
export function effectiveCapabilityDiscoveryPolicy(
  plan: PymthouseDiscoveryPlansResponse['plans'][0],
  pipeline: string,
  modelId: string,
): DiscoveryPolicy | null {
  const matching = plan.capabilities.filter((b) => bundleMatches(pipeline, modelId, b));
  if (matching.length === 0) {
    return null;
  }
  let acc: DiscoveryPolicy | null = plan.discoveryPolicy;
  for (const b of matching) {
    acc = mergeDiscoveryPolicies(acc, b.discoveryPolicy);
  }
  // Capability is allowed but every layer omitted policy — treat as unconstrained envelope.
  if (acc === null) {
    return {};
  }
  return acc;
}

/**
 * Intersect policies across all active plans that declare a matching capability bundle.
 */
export function resolveMergedDiscoveryPolicyForCapability(
  response: PymthouseDiscoveryPlansResponse,
  pipeline: string,
  modelId: string,
): DiscoveryPolicy | null {
  let acc: DiscoveryPolicy | null = null;
  for (const plan of response.plans) {
    const perPlan = effectiveCapabilityDiscoveryPolicy(plan, pipeline, modelId);
    if (perPlan === null) {
      continue;
    }
    acc = mergeDiscoveryPolicies(acc, perPlan);
  }
  return acc;
}

function swapRatioFromNoSwapPct(noSwapRatio: number | null | undefined): number | null {
  if (noSwapRatio === null || noSwapRatio === undefined) return null;
  return (100 - noSwapRatio) / 100;
}

function passesFilters(row: DashboardOrchestrator, policy: DiscoveryPolicy): boolean {
  if (policy.slaMinScore !== undefined) {
    if (row.slaScore === null) return false;
    const minPct = policy.slaMinScore * 100;
    if (row.slaScore < minPct) return false;
  }

  const f = policy.filters;
  if (!f) return true;

  if (f.maxSwapRatio !== undefined) {
    const sr = swapRatioFromNoSwapPct(row.noSwapRatio);
    if (sr !== null && sr > f.maxSwapRatio) return false;
  }

  return true;
}

function sortValue(row: DashboardOrchestrator, sortBy: NonNullable<DiscoveryPolicy['sortBy']>): number {
  switch (sortBy) {
    case 'slaScore':
      return row.slaScore ?? -1;
    case 'swapRate':
      return row.noSwapRatio ?? -1;
    case 'avail':
      return row.gpuCount;
    case 'latency':
      return row.knownSessions;
    case 'price':
      return row.successRatio;
    default:
      return row.slaScore ?? -1;
  }
}

/**
 * Filter / sort / cap orchestrators using a merged discovery policy.
 */
export function applyDiscoveryPolicyToOrchestrators(
  rows: DashboardOrchestrator[],
  policy: DiscoveryPolicy | null,
): DashboardOrchestrator[] {
  if (!policy || Object.keys(policy).length === 0) {
    return rows;
  }

  let out = rows.filter((row) => passesFilters(row, policy));

  if (policy.sortBy) {
    const dir = policy.sortBy === 'price' || policy.sortBy === 'latency' ? 1 : -1;
    out = [...out].sort((a, b) => dir * (sortValue(a, policy.sortBy!) - sortValue(b, policy.sortBy!)));
  }

  if (policy.topN !== undefined) {
    out = out.slice(0, policy.topN);
  }

  return out;
}

export interface OrchestratorDiscoveryOpts {
  pipeline?: string;
  modelId?: string;
  userDiscoveryPolicy?: DiscoveryPolicy | null;
}

/**
 * When `pipeline` and `modelId` are set and PymtHouse discovery env is configured,
 * fetches app policy, merges with `userDiscoveryPolicy`, and applies to `rows`.
 * If PymtHouse is unreachable or returns no data, returns `rows` unchanged (fail-open).
 */
export async function applyPymthouseDiscoveryToOrchestrators(
  rows: DashboardOrchestrator[],
  opts: OrchestratorDiscoveryOpts,
): Promise<DashboardOrchestrator[]> {
  const pipeline = opts.pipeline?.trim();
  const modelId = opts.modelId?.trim();
  if (!pipeline || !modelId) {
    return rows;
  }

  const remote = await fetchPymthouseDiscoveryPlans();
  if (!remote?.plans.length) {
    return rows;
  }

  const appPolicy = resolveMergedDiscoveryPolicyForCapability(remote, pipeline, modelId);
  if (appPolicy === null) {
    return [];
  }

  const merged = mergeDiscoveryPolicies(appPolicy, opts.userDiscoveryPolicy ?? null);
  return applyDiscoveryPolicyToOrchestrators(rows, merged);
}
