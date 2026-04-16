import {
  getCsrfToken,
  generateCorrelationId,
  HEADER_CSRF_TOKEN,
  HEADER_CORRELATION,
} from '@naap/plugin-sdk';

const BASE_URL = '/api/v1/orchestrator-leaderboard';

/** Must match shell `STORAGE_KEYS.AUTH_TOKEN` (see apps/web-next auth-context). */
const AUTH_TOKEN_KEY = 'naap_auth_token';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  const shellContext = (window as unknown as { __SHELL_CONTEXT__?: { authToken?: string } })
    .__SHELL_CONTEXT__;
  if (shellContext?.authToken) return shellContext.authToken;
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }
  return null;
}

function buildHeaders(jsonBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (jsonBody) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const csrf = getCsrfToken();
  if (csrf) {
    headers[HEADER_CSRF_TOKEN] = csrf;
  }
  headers[HEADER_CORRELATION] = generateCorrelationId();
  return headers;
}

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
    headers: buildHeaders(true),
    body: JSON.stringify(request),
    credentials: 'include',
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
    headers: buildHeaders(false),
    credentials: 'include',
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

// ---------------------------------------------------------------------------
// Discovery Plans
// ---------------------------------------------------------------------------

export type PlanSortBy = 'slaScore' | 'latency' | 'price' | 'swapRate' | 'avail';

export interface DiscoveryPlan {
  id: string;
  billingPlanId: string;
  name: string;
  description: string | null;
  teamId: string | null;
  ownerUserId: string | null;
  capabilities: string[];
  topN: number;
  slaWeights: SLAWeights | null;
  slaMinScore: number | null;
  sortBy: PlanSortBy | null;
  filters: LeaderboardFilters | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlanResults {
  planId: string;
  refreshedAt: string;
  capabilities: Record<string, OrchestratorRow[]>;
  meta: {
    totalOrchestrators: number;
    refreshIntervalMs: number;
    cacheAgeMs: number;
  };
}

export interface PlanUpdatePayload {
  name?: string;
  capabilities?: string[];
  topN?: number;
  slaWeights?: SLAWeights | null;
  slaMinScore?: number | null;
  sortBy?: PlanSortBy | null;
  filters?: LeaderboardFilters | null;
  enabled?: boolean;
}

export async function fetchPlans(): Promise<DiscoveryPlan[]> {
  const res = await fetch(`${BASE_URL}/plans`, {
    headers: buildHeaders(false),
    credentials: 'include',
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }

  const json: APIResponse<{ plans: DiscoveryPlan[] }> = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');

  return json.data.plans;
}

export async function fetchPlanResults(planId: string): Promise<PlanResults> {
  const res = await fetch(`${BASE_URL}/plans/${planId}/results`, {
    headers: buildHeaders(false),
    credentials: 'include',
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }

  const json: APIResponse<{ data: PlanResults }> = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');

  return json.data.data;
}

export async function updatePlan(
  planId: string,
  updates: PlanUpdatePayload,
): Promise<DiscoveryPlan> {
  const res = await fetch(`${BASE_URL}/plans/${planId}`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(updates),
    credentials: 'include',
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }

  const json: APIResponse<{ plan: DiscoveryPlan }> = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');

  return json.data.plan;
}

// ---------------------------------------------------------------------------
// Dataset Config (admin)
// ---------------------------------------------------------------------------

export interface DatasetConfig {
  refreshIntervalHours: number;
  lastRefreshedAt: string | null;
  lastRefreshedBy: string | null;
  updatedAt: string;
}

export async function fetchDatasetConfig(): Promise<DatasetConfig> {
  const res = await fetch(`${BASE_URL}/dataset/config`, {
    headers: buildHeaders(false),
    credentials: 'include',
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }

  const json: APIResponse<DatasetConfig> = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');

  return json.data;
}

export async function updateDatasetConfig(
  refreshIntervalHours: number,
): Promise<DatasetConfig> {
  const res = await fetch(`${BASE_URL}/dataset/config`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify({ refreshIntervalHours }),
    credentials: 'include',
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }

  const json: APIResponse<DatasetConfig> = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');

  return json.data;
}

export async function triggerDatasetRefresh(): Promise<{
  refreshed: boolean;
  capabilities: number;
  orchestrators: number;
}> {
  const res = await fetch(`${BASE_URL}/dataset/refresh`, {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }

  const json: APIResponse<{
    refreshed: boolean;
    capabilities: number;
    orchestrators: number;
  }> = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');

  return json.data;
}

export async function seedDemoPlans(): Promise<{ created: number }> {
  const res = await fetch(`${BASE_URL}/plans/seed`, {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }

  const json: APIResponse<{ created: number }> = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');

  return json.data;
}
