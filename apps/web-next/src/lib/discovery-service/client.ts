/**
 * HTTP client for the standalone discovery-service (Go).
 * Used when DISCOVERY_SERVICE_URL is configured.
 */

import type {
  DiscoveryPlan,
  LeaderboardFilters,
  OrchestratorRow,
  PlanSortBy,
  SLAWeights,
} from '@/lib/orchestrator-leaderboard/types';

const DEFAULT_TIMEOUT_MS = 30_000;

function baseUrl(): string | null {
  const url = process.env.DISCOVERY_SERVICE_URL?.trim();
  return url ? url.replace(/\/$/, '') : null;
}

export function isDiscoveryServiceEnabled(): boolean {
  return baseUrl() != null;
}

interface DiscoveryQueryResponse {
  results: Record<string, DiscoveryServiceRow[]>;
  datasetVersion?: number;
  queryTimeMs?: number;
}

interface DiscoveryServiceRow {
  orchUri: string;
  gpuName: string;
  gpuGb: number;
  avail: number;
  totalCap: number;
  pricePerUnit: number;
  bestLatMs: number | null;
  avgLatMs: number | null;
  swapRatio: number | null;
  avgAvail: number | null;
  score?: number;
  slaScore?: number;
}

function queryCapabilityName(capability: string): string {
  const trimmed = capability.trim();
  const slash = trimmed.lastIndexOf('/');
  const name = slash >= 0 ? trimmed.slice(slash + 1).trim() : trimmed;
  return name || trimmed;
}

function mapRow(r: DiscoveryServiceRow): OrchestratorRow {
  return {
    orchUri: r.orchUri,
    gpuName: r.gpuName,
    gpuGb: r.gpuGb,
    avail: r.avail,
    totalCap: r.totalCap,
    pricePerUnit: r.pricePerUnit,
    bestLatMs: r.bestLatMs,
    avgLatMs: r.avgLatMs,
    swapRatio: r.swapRatio,
    avgAvail: r.avgAvail,
    slaScore: r.slaScore,
  };
}

/**
 * Evaluate plan filters via discovery-service POST /v1/discovery/query.
 */
export async function queryPlanFromDiscoveryService(
  plan: Pick<
    DiscoveryPlan,
    'capabilities' | 'filters' | 'slaWeights' | 'slaMinScore' | 'sortBy' | 'topN'
  >,
): Promise<Record<string, OrchestratorRow[]>> {
  const root = baseUrl();
  if (!root) {
    throw new Error('DISCOVERY_SERVICE_URL is not configured');
  }

  const shortCaps = plan.capabilities.map(queryCapabilityName);
  const body = {
    capabilities: shortCaps,
    topN: plan.topN,
    filters: plan.filters as LeaderboardFilters | undefined,
    slaWeights: plan.slaWeights as SLAWeights | undefined,
    slaMinScore: plan.slaMinScore,
    sortBy: plan.sortBy as PlanSortBy | undefined,
  };

  const res = await fetch(`${root}/v1/discovery/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`discovery-service query failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as DiscoveryQueryResponse;
  const out: Record<string, OrchestratorRow[]> = {};

  for (let i = 0; i < plan.capabilities.length; i++) {
    const fullCap = plan.capabilities[i];
    const short = shortCaps[i];
    const rows = json.results[short] ?? [];
    out[fullCap] = rows.map(mapRow);
  }

  return out;
}

export interface DiscoveryRefreshResult {
  refreshed: boolean;
  capabilities: number;
  orchestrators: number;
  durationMs?: number;
}

/**
 * Trigger dataset refresh on discovery-service.
 */
export async function refreshDiscoveryServiceDataset(
  refreshedBy: string,
  cronSecret?: string,
): Promise<DiscoveryRefreshResult> {
  const root = baseUrl();
  if (!root) {
    throw new Error('DISCOVERY_SERVICE_URL is not configured');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Refreshed-By': refreshedBy,
  };
  if (cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`;
  }

  const res = await fetch(`${root}/v1/discovery/dataset/refresh`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`discovery-service refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<DiscoveryRefreshResult>;
}
