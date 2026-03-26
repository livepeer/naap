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
  type NetworkDemandFilters,
  type GPUMetricsFilters,
  type SLAComplianceFilters,
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
    networkDemand: (args: NetworkDemandFilters) => {
      const params = new URLSearchParams();
      if (args.window) params.set('window', args.window);
      if (args.gateway) params.set('gateway', args.gateway);
      if (args.region) params.set('region', args.region);
      if (args.pipelineId) params.set('pipelineId', args.pipelineId);
      if (args.modelId) params.set('modelId', args.modelId);
      return apiFetch(`/api/v1/dashboard/network-demand?${params.toString()}`);
    },
    gpuMetrics: (args: GPUMetricsFilters) => {
      const params = new URLSearchParams();
      if (args.window) params.set('window', args.window);
      if (args.orchestratorAddress) params.set('orchestratorAddress', args.orchestratorAddress);
      if (args.pipelineId) params.set('pipelineId', args.pipelineId);
      if (args.modelId) params.set('modelId', args.modelId);
      if (args.gpuId) params.set('gpuId', args.gpuId);
      if (args.region) params.set('region', args.region);
      if (args.gpuModelName) params.set('gpuModelName', args.gpuModelName);
      if (args.runnerVersion) params.set('runnerVersion', args.runnerVersion);
      if (args.cudaVersion) params.set('cudaVersion', args.cudaVersion);
      return apiFetch(`/api/v1/dashboard/gpu-metrics?${params.toString()}`);
    },
    slaCompliance: (args: SLAComplianceFilters) => {
      const params = new URLSearchParams();
      if (args.window) params.set('window', args.window);
      if (args.orchestratorAddress) params.set('orchestratorAddress', args.orchestratorAddress);
      if (args.pipelineId) params.set('pipelineId', args.pipelineId);
      if (args.modelId) params.set('modelId', args.modelId);
      if (args.gpuId) params.set('gpuId', args.gpuId);
      if (args.region) params.set('region', args.region);
      return apiFetch(`/api/v1/dashboard/sla-compliance?${params.toString()}`);
    },
  });
}
