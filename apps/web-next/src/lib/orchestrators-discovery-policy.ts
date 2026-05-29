/**
 * Applies PymtHouse app-level discovery exclusions to dashboard orchestrator rows.
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

function sortValue(
  row: DashboardOrchestrator,
  sortBy: NonNullable<DiscoveryPolicy['sortBy']>,
): number | undefined {
  switch (sortBy) {
    case 'slaScore':
      return row.slaScore ?? -1;
    case 'swapRate':
      return row.noSwapRatio ?? -1;
    case 'avail':
      return row.gpuCount;
    case 'latency':
    case 'price':
      // DashboardOrchestrator exposes no per-row latency/price metric, so this
      // sort mode is unavailable. Return undefined (instead of silently using
      // slaScore) so the caller can detect it and preserve input order.
      return undefined;
    default:
      return undefined;
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
    const dir = -1;
    out = [...out].sort((a, b) => {
      const av = sortValue(a, policy.sortBy!);
      const bv = sortValue(b, policy.sortBy!);
      // Metric unavailable for this sort mode: leave input order untouched
      // rather than reordering by an unrelated metric.
      if (av === undefined || bv === undefined) return 0;
      return dir * (av - bv);
    });
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
 * When `pipeline` and `modelId` are set, applies the PymtHouse Builder Network
 * Discovery denylist (M2M). Explicit exclusions return no rows; everything else
 * in the NaaP catalog remains discoverable. Missing manifest denies by default
 * unless `PYMTHOUSE_ALLOW_MISSING_MANIFEST_FAIL_OPEN=1` is set (audited).
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
  if (!isPipelineModelInManifest(manifest, pipeline, modelId)) {
    return [];
  }

  const merged = opts.userDiscoveryPolicy ?? null;
  return applyDiscoveryPolicyToOrchestrators(rows, merged);
}
