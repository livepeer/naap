const BASE_URL = '/api/v1/orchestrator-leaderboard';

export interface OrchestratorRow {
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
  slaScore?: number;
}

export interface LeaderboardFilters {
  gpuRamGbMin?: number;
  gpuRamGbMax?: number;
  priceMax?: number;
  maxAvgLatencyMs?: number;
  maxSwapRatio?: number;
}

export interface SLAWeights {
  latency?: number;
  swapRate?: number;
  price?: number;
}

export interface LeaderboardRequest {
  capability: string;
  topN?: number;
  filters?: LeaderboardFilters;
  slaWeights?: SLAWeights;
}

export interface APIResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

export interface RankResponse {
  data: OrchestratorRow[];
  cacheStatus: 'HIT' | 'MISS';
  cacheAge: number;
  dataFreshness: string;
}

export async function fetchRank(request: LeaderboardRequest): Promise<RankResponse> {
  const res = await fetch(`${BASE_URL}/rank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }

  const json: APIResponse<OrchestratorRow[]> = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');

  return {
    data: json.data,
    cacheStatus: (res.headers.get('X-Cache') as 'HIT' | 'MISS') || 'MISS',
    cacheAge: parseInt(res.headers.get('X-Cache-Age') || '0', 10),
    dataFreshness: res.headers.get('X-Data-Freshness') || new Date().toISOString(),
  };
}

export async function fetchCapabilities(): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/filters`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }

  const json: APIResponse<{ capabilities: string[] }> = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');

  return json.data.capabilities;
}
