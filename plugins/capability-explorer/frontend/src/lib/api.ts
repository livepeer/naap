import { authHeaders } from '@naap/plugin-utils/auth';
import type { CapabilityConnection, EnrichedCapability, CategoryInfo, ExplorerStats, SortField, SortOrder, CapabilityCategory, CapabilityQueryRecord, DataSourceInfo, ExplorerConfig, SnapshotRecord } from './types';

const BASE_URL = '/api/v1/capability-explorer';

function mergeInit(init?: RequestInit): RequestInit {
  const auth = authHeaders();
  return {
    credentials: 'include',
    ...init,
    headers: {
      ...auth,
      ...(init?.headers as Record<string, string>),
    },
  };
}

async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Expected JSON (${res.status}): ${text.slice(0, 240)}`);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, mergeInit(init));
  const json = (await parseJsonResponse(res)) as {
    success?: boolean;
    data?: T;
    error?: { message?: string };
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message || `API request failed (${res.status})`);
  }
  return json.data as T;
}

export interface ListCapabilitiesOptions {
  category?: CapabilityCategory;
  search?: string;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  limit?: number;
  offset?: number;
}

export async function fetchCapabilities(opts: ListCapabilitiesOptions = {}): Promise<CapabilityConnection> {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (opts.search) params.set('search', opts.search);
  if (opts.sortBy) params.set('sortBy', opts.sortBy);
  if (opts.sortOrder) params.set('sortOrder', opts.sortOrder);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return apiFetch<CapabilityConnection>(`/capabilities${qs ? `?${qs}` : ''}`);
}

export async function fetchCapability(id: string): Promise<EnrichedCapability> {
  return apiFetch<EnrichedCapability>(`/capabilities/${encodeURIComponent(id)}`);
}

export async function fetchCategories(): Promise<CategoryInfo[]> {
  return apiFetch<CategoryInfo[]>('/categories');
}

export async function fetchStats(): Promise<ExplorerStats> {
  return apiFetch<ExplorerStats>('/stats');
}

/** GraphQL envelope returned by POST /graphql (matches JSON body for external callers). */
export interface GraphQLHttpPayload {
  data?: unknown;
  errors?: readonly unknown[];
}

export async function queryGraphQL(
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphQLHttpPayload> {
  const res = await fetch(
    `${BASE_URL}/graphql`,
    mergeInit({
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    }),
  );
  const json = (await parseJsonResponse(res)) as {
    success?: boolean;
    data?: GraphQLHttpPayload;
    error?: { message?: string };
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message || `GraphQL request failed (${res.status})`);
  }
  if (json.data === undefined || json.data === null) {
    throw new Error('GraphQL response missing data envelope');
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Capability Queries (Discovery)
// ---------------------------------------------------------------------------

export async function fetchQueries(): Promise<{ queries: CapabilityQueryRecord[] }> {
  return apiFetch<{ queries: CapabilityQueryRecord[] }>('/queries');
}

export async function createQuery(input: {
  name: string;
  slug: string;
  category?: string;
  search?: string;
  minGpuCount?: number;
  maxPriceUsd?: number;
  minCapacity?: number;
  sortBy?: string;
  sortOrder?: string;
  limit?: number;
}): Promise<CapabilityQueryRecord> {
  return apiFetch<CapabilityQueryRecord>('/queries', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchQuery(id: string): Promise<CapabilityQueryRecord> {
  return apiFetch<CapabilityQueryRecord>(`/queries/${encodeURIComponent(id)}`);
}

export async function updateQuery(id: string, input: Record<string, unknown>): Promise<CapabilityQueryRecord> {
  return apiFetch<CapabilityQueryRecord>(`/queries/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteQuery(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/queries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchQueryResults(id: string): Promise<CapabilityConnection> {
  return apiFetch<CapabilityConnection>(`/queries/${encodeURIComponent(id)}/results`);
}

// ---------------------------------------------------------------------------
// Admin — Data Sources & Config
// ---------------------------------------------------------------------------

export async function fetchSources(): Promise<{ sources: DataSourceInfo[] }> {
  return apiFetch<{ sources: DataSourceInfo[] }>('/admin/sources');
}

export async function fetchConfig(): Promise<ExplorerConfig> {
  return apiFetch<ExplorerConfig>('/admin/config');
}

export async function updateConfig(
  input: Partial<Pick<ExplorerConfig, 'enabledSources' | 'refreshIntervalHours' | 'refreshIntervals'>>,
): Promise<ExplorerConfig> {
  return apiFetch<ExplorerConfig>('/admin/config', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function fetchSnapshots(limit = 20): Promise<{ snapshots: SnapshotRecord[] }> {
  return apiFetch<{ snapshots: SnapshotRecord[] }>(`/admin/snapshots?limit=${limit}`);
}

export async function triggerRefresh(): Promise<unknown> {
  return apiFetch('/refresh', { method: 'POST' });
}
