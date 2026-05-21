/**
 * Applies PymtHouse app-level discovery allowlist to dashboard orchestrator rows.
 * Used when `pipeline` + `model_id` query params scope the request.
 */

import type { DashboardOrchestrator } from '@naap/plugin-sdk';

import type { DiscoveryPolicy } from '@/lib/pymthouse-discovery-plans';
import {
  getPymthouseManifestSnapshot,
  isPipelineModelInManifest,
} from '@/lib/pymthouse-manifest';

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
 * Filter / sort / cap orchestrators using a user discovery policy.
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
 * When `pipeline` and `modelId` are set, optionally intersects with the PymtHouse Builder
 * discovery allowlist (M2M). If the pair is not on the allowlist when restrictions exist,
 * returns no rows. If the allowlist is empty or unreachable, does not restrict (fail-open).
 * Applies `userDiscoveryPolicy` only (no merged PymtHouse SLA envelope from legacy plans).
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

  const manifest = getPymthouseManifestSnapshot().data;
  if (manifest?.capabilities?.length) {
    if (!isPipelineModelInManifest(manifest, pipeline, modelId)) {
      return [];
    }
  }

  const merged = opts.userDiscoveryPolicy ?? null;
  return applyDiscoveryPolicyToOrchestrators(rows, merged);
}
