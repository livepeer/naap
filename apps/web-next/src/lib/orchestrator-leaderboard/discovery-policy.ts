import type { DashboardOrchestrator } from '@naap/plugin-sdk';

export type DiscoverySortBy = 'slaScore' | 'latency' | 'price' | 'swapRate' | 'avail';

export interface DiscoveryPolicyFilters {
  gpuRamGbMin?: number;
  gpuRamGbMax?: number;
  priceMax?: number;
  maxAvgLatencyMs?: number;
  maxSwapRatio?: number;
}

export interface DiscoveryPolicy {
  topN?: number;
  sortBy?: DiscoverySortBy;
  slaMinScore?: number;
  slaWeights?: {
    latency?: number;
    swapRate?: number;
    price?: number;
  };
  filters?: DiscoveryPolicyFilters;
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
    if (sr === null || sr > f.maxSwapRatio) return false;
  }

  // Other filter dimensions are currently handled upstream (daydream).
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
    case 'price':
      // DashboardOrchestrator has no per-row latency/price; fall back to slaScore.
      return row.slaScore ?? -1;
    default:
      return row.slaScore ?? -1;
  }
}

/**
 * Filter / sort / cap orchestrators using a discovery policy.
 * (PR #337 Daydream-only: no PymtHouse pipeline/model manifest denylist.)
 */
export function applyDiscoveryPolicyToOrchestrators(
  rows: DashboardOrchestrator[],
  policy: DiscoveryPolicy | null,
): DashboardOrchestrator[] {
  if (!policy || Object.keys(policy).length === 0) return rows;

  let out = rows.filter((row) => passesFilters(row, policy));

  if (policy.sortBy) {
    const sortBy = policy.sortBy;
    const dir = -1;
    out = [...out].sort(
      (a, b) => dir * (sortValue(a, sortBy) - sortValue(b, sortBy)),
    );
  }

  if (policy.topN !== undefined) {
    out = out.slice(0, policy.topN);
  }

  return out;
}

