// @naap/api-client - Typed API clients for workflows

import { config, getApiUrl } from '@naap/config';
import type { 
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
