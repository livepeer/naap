/**
 * Orchestrator Leaderboard — SLA Scoring & Post-Query Filtering
 *
 * Applies post-query filters and optional SLA-weighted re-ranking
 * to the ClickHouse result set.
 */

import type {
  ClickHouseLeaderboardRow,
  LeaderboardFilters,
  OrchestratorRow,
  SLAWeights,
} from './types';

const DEFAULT_WEIGHTS: Required<SLAWeights> = {
  latency: 0.4,
  swapRate: 0.3,
  price: 0.3,
};

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

export function mapRow(row: ClickHouseLeaderboardRow): OrchestratorRow {
  return {
    orchUri: String(row.orch_uri ?? ''),
    gpuName: String(row.gpu_name ?? ''),
    gpuGb: Number(row.gpu_gb) || 0,
    avail: Number(row.avail) || 0,
    totalCap: Number(row.total_cap) || 0,
    pricePerUnit: Number(row.price_per_unit) || 0,
    bestLatMs: row.best_lat_ms != null ? Number(row.best_lat_ms) : null,
    avgLatMs: row.avg_lat_ms != null ? Number(row.avg_lat_ms) : null,
    swapRatio: row.swap_ratio != null ? Number(row.swap_ratio) : null,
    avgAvail: row.avg_avail != null ? Number(row.avg_avail) : null,
  };
}

// ---------------------------------------------------------------------------
// Post-query filtering
// ---------------------------------------------------------------------------

export function applyFilters(
  rows: ClickHouseLeaderboardRow[],
  filters?: LeaderboardFilters
): ClickHouseLeaderboardRow[] {
  if (!filters) return rows;

  return rows.filter((r) => {
    if (filters.gpuRamGbMin != null && r.gpu_gb < filters.gpuRamGbMin) return false;
    if (filters.gpuRamGbMax != null && r.gpu_gb > filters.gpuRamGbMax) return false;
    if (filters.priceMax != null && r.price_per_unit > filters.priceMax) return false;
    if (filters.maxAvgLatencyMs != null && r.avg_lat_ms != null && r.avg_lat_ms > filters.maxAvgLatencyMs) return false;
    if (filters.maxSwapRatio != null && r.swap_ratio != null && r.swap_ratio > filters.maxSwapRatio) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// SLA scoring
// ---------------------------------------------------------------------------

function normalizeWeights(weights?: SLAWeights): Required<SLAWeights> {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const sum = (w.latency || 0) + (w.swapRate || 0) + (w.price || 0);
  if (sum === 0) return DEFAULT_WEIGHTS;
  return {
    latency: (w.latency || 0) / sum,
    swapRate: (w.swapRate || 0) / sum,
    price: (w.price || 0) / sum,
  };
}

interface MinMax {
  minLat: number; maxLat: number;
  minSwap: number; maxSwap: number;
  minPrice: number; maxPrice: number;
}

function computeMinMax(rows: ClickHouseLeaderboardRow[]): MinMax {
  let minLat = Infinity, maxLat = -Infinity;
  let minSwap = Infinity, maxSwap = -Infinity;
  let minPrice = Infinity, maxPrice = -Infinity;

  for (const r of rows) {
    if (r.best_lat_ms != null) {
      if (r.best_lat_ms < minLat) minLat = r.best_lat_ms;
      if (r.best_lat_ms > maxLat) maxLat = r.best_lat_ms;
    }
    if (r.swap_ratio != null) {
      if (r.swap_ratio < minSwap) minSwap = r.swap_ratio;
      if (r.swap_ratio > maxSwap) maxSwap = r.swap_ratio;
    }
    if (r.price_per_unit < minPrice) minPrice = r.price_per_unit;
    if (r.price_per_unit > maxPrice) maxPrice = r.price_per_unit;
  }

  return { minLat, maxLat, minSwap, maxSwap, minPrice, maxPrice };
}

function norm(value: number | null, min: number, max: number): number {
  if (value == null) return 0.5;
  if (max === min) return 1;
  return 1 - (value - min) / (max - min);
}

export function computeSLAScore(
  row: ClickHouseLeaderboardRow,
  weights: Required<SLAWeights>,
  mm: MinMax
): number {
  const latScore = norm(row.best_lat_ms, mm.minLat, mm.maxLat);
  const swapScore = norm(row.swap_ratio, mm.minSwap, mm.maxSwap);
  const priceScore = norm(row.price_per_unit, mm.minPrice, mm.maxPrice);

  return weights.latency * latScore + weights.swapRate * swapScore + weights.price * priceScore;
}

/**
 * Re-rank rows by computed SLA score. Returns OrchestratorRow[] with
 * slaScore attached, sorted descending (best first).
 */
export function rerank(
  rows: ClickHouseLeaderboardRow[],
  weights?: SLAWeights
): OrchestratorRow[] {
  const w = normalizeWeights(weights);
  const mm = computeMinMax(rows);

  const scored = rows.map((r) => ({
    ...mapRow(r),
    slaScore: Math.round(computeSLAScore(r, w, mm) * 1000) / 1000,
  }));

  scored.sort((a, b) => b.slaScore - a.slaScore);
  return scored;
}
