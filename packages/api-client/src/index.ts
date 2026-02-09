// @naap/api-client - Typed API clients for workflows

import { config, getApiUrl } from '@naap/config';
import type { 
  Gateway, 
  Orchestrator, 
  NetworkStats, 
  Capability,
  Job,
  ForumPost,
  MarketplaceAsset,
  CapacityRequest 
} from '@naap/types';

/**
 * Base fetch wrapper with error handling
 */
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Base service client
export const baseApi = {
  getHealthz: () => apiFetch<{ status: string }>(getApiUrl('base', '/healthz')),
  getSession: () => apiFetch<{ user: unknown }>(getApiUrl('base', '/auth/session')),
};

// Gateway Manager client
export const gatewayApi = {
  getAll: () => apiFetch<Gateway[]>(getApiUrl('gateway-manager', '/gateways')),
  getById: (id: string) => apiFetch<Gateway>(getApiUrl('gateway-manager', `/gateways/${id}`)),
  getOrchestrators: (id: string) => apiFetch<Orchestrator[]>(getApiUrl('gateway-manager', `/gateways/${id}/orchestrators`)),
};

// Orchestrator Manager client
export const orchestratorApi = {
  getAll: () => apiFetch<Orchestrator[]>(getApiUrl('orchestrator-manager', '/orchestrators')),
  getById: (id: string) => apiFetch<Orchestrator>(getApiUrl('orchestrator-manager', `/orchestrators/${id}`)),
  getPipelines: (id: string) => apiFetch<unknown[]>(getApiUrl('orchestrator-manager', `/orchestrators/${id}/pipelines`)),
};

// Network Analytics client
export const analyticsApi = {
  getStats: () => apiFetch<NetworkStats>(getApiUrl('network-analytics', '/stats')),
  getCapabilities: () => apiFetch<Capability[]>(getApiUrl('network-analytics', '/capabilities')),
  getJobs: (params?: { limit?: number }) => apiFetch<Job[]>(getApiUrl('network-analytics', `/jobs?limit=${params?.limit || 20}`)),
};

// Marketplace client
export const marketplaceApi = {
  getAssets: () => apiFetch<MarketplaceAsset[]>(getApiUrl('marketplace', '/assets')),
  getAssetById: (id: string) => apiFetch<MarketplaceAsset>(getApiUrl('marketplace', `/assets/${id}`)),
};

// Community client
export const communityApi = {
  getPosts: () => apiFetch<ForumPost[]>(getApiUrl('community', '/posts')),
  getPostById: (id: string) => apiFetch<ForumPost>(getApiUrl('community', `/posts/${id}`)),
};

// Capacity Planner client
export const capacityApi = {
  getRequests: () => apiFetch<CapacityRequest[]>(getApiUrl('capacity-planner', '/requests')),
  getRequestById: (id: string) => apiFetch<CapacityRequest>(getApiUrl('capacity-planner', `/requests/${id}`)),
};

export { config };
