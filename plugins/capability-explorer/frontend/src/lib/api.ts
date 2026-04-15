import type { CapabilityConnection, EnrichedCapability, CategoryInfo, ExplorerStats, SortField, SortOrder, CapabilityCategory, CapabilityQueryRecord } from './types';

const BASE_URL = '/api/v1/capability-explorer';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message || 'API request failed');
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

export async function queryGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BASE_URL}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message || 'GraphQL request failed');
  }
  return json.data?.data as T;
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

export async function seedQueries(): Promise<{ created: number; total: number }> {
  return apiFetch<{ created: number; total: number }>('/queries/seed', {
    method: 'POST',
  });
}
