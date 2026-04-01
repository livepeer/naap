/**
 * Dashboard Provider — BFF Thin Adapter
 *
 * This plugin is a thin adapter that fetches widget-ready JSON from
 * Next.js BFF route handlers at /api/v1/dashboard/* and publishes
 * the results to the event bus via createDashboardProvider().
 *
 * All data fetching, pagination, transformation, and aggregation is
 * performed server-side. The browser plugin just fetches + forwards.
 */

import {
  createDashboardProvider,
  type IEventBus,
} from '@naap/plugin-sdk';

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`BFF API ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Provider registration
// ---------------------------------------------------------------------------

/**
 * Register the BFF-backed dashboard provider on the event bus.
 *
 * @param eventBus - The shell event bus instance
 * @returns Cleanup function to call on plugin unmount
 */
export function registerDashboardProvider(eventBus: IEventBus): () => void {
  return createDashboardProvider(eventBus, {
    kpi: ({ timeframe }) => apiFetch(`/api/v1/dashboard/kpi?timeframe=${timeframe ?? 12}`),
    protocol: () => apiFetch('/api/v1/dashboard/protocol'),
    fees: ({ days }) => apiFetch(`/api/v1/dashboard/fees${days != null ? `?days=${days}` : ''}`),
    pipelines: ({ limit, timeframe }) => {
      const params = new URLSearchParams();
      if (timeframe != null) params.set('timeframe', String(timeframe));
      if (limit != null) params.set('limit', String(limit));
      const qs = params.toString();
      return apiFetch(`/api/v1/dashboard/pipelines${qs ? `?${qs}` : ''}`);
    },
    pipelineCatalog: () => apiFetch('/api/v1/dashboard/pipeline-catalog'),
    gpuCapacity: (args) => apiFetch(`/api/v1/dashboard/gpu-capacity${args?.timeframe != null ? `?timeframe=${args.timeframe}` : ''}`),
    pricing: () => apiFetch('/api/v1/dashboard/pricing'),
    orchestrators: ({ period }) => apiFetch(`/api/v1/dashboard/orchestrators${period ? `?period=${encodeURIComponent(period)}` : ''}`),
  });
}
