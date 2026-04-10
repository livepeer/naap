/**
 * Stable JSON contracts for PymtHouse plan builder and admin tooling.
 * Consumers: pymthouse (NAAP_INTELLIGENCE_BASE_URL or full URLs per route).
 *
 * @see schemaVersion — bump when breaking response shape.
 */

import { randomUUID } from 'crypto';
import type { DashboardPipelineCatalogEntry, DashboardPipelinePricing } from '@naap/plugin-sdk';
import type { NetworkModel } from '@/lib/facade/types';
import {
  getDashboardGPUCapacity,
  getDashboardKPI,
  getDashboardPipelineCatalog,
  getDashboardPricing,
  getNetworkModels,
  getPerfByModel,
} from '@/lib/facade';
import { normalizeGpuCapacityTimeframeKey } from '@/lib/facade/resolvers/gpu-capacity';
import { normalizeTimeframeHours } from '@/lib/facade/resolvers/kpi';

export const PYMTHOUSE_PLAN_BUILDER_SCHEMA_VERSION = '1.0' as const;

export function newCorrelationId(): string {
  return randomUUID();
}

export function pymthouseIntegrationError(
  error: string,
  error_description: string,
  correlation_id: string
) {
  return { error, error_description, correlation_id };
}

export interface CapabilitiesCatalogPayload {
  schemaVersion: typeof PYMTHOUSE_PLAN_BUILDER_SCHEMA_VERSION;
  generatedAt: string;
  source: {
    pipelineCatalog: string;
    networkModels: string;
  };
  pipelineCatalog: DashboardPipelineCatalogEntry[];
  networkModels: NetworkModel[];
  totals: {
    pipelineCount: number;
    modelCount: number;
  };
}

export async function buildCapabilitiesCatalog(opts: {
  networkModelsLimit?: number;
}): Promise<CapabilitiesCatalogPayload> {
  const limit = opts.networkModelsLimit ?? 200;
  const [pipelineCatalog, { models }] = await Promise.all([
    getDashboardPipelineCatalog(),
    getNetworkModels({ limit: Math.min(Math.max(limit, 1), 500) }),
  ]);

  return {
    schemaVersion: PYMTHOUSE_PLAN_BUILDER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      pipelineCatalog: 'naap-facade:resolvePipelineCatalog',
      networkModels: 'naap-facade:resolveNetworkModels',
    },
    pipelineCatalog,
    networkModels: models,
    totals: {
      pipelineCount: pipelineCatalog.length,
      modelCount: models.length,
    },
  };
}

export interface SlaSummaryPayload {
  schemaVersion: typeof PYMTHOUSE_PLAN_BUILDER_SCHEMA_VERSION;
  generatedAt: string;
  source: {
    kpi: string;
    gpuCapacity: string;
    perfByModel: string;
  };
  window: {
    kpiHours: number;
    perfRange: { start: string; end: string };
    gpuTimeframe: string;
  };
  kpi: Awaited<ReturnType<typeof getDashboardKPI>>;
  gpuCapacity: Awaited<ReturnType<typeof getDashboardGPUCapacity>>;
  /** Keys are `pipeline:model` → average FPS (when upstream returns data). */
  perfByModel: Record<string, number>;
}

export async function buildSlaSummary(opts: {
  timeframe?: string | null;
  perfDays?: number;
}): Promise<SlaSummaryPayload> {
  const hours = normalizeTimeframeHours(opts.timeframe ?? undefined);
  const timeframe = String(hours);
  const gpuTf = normalizeGpuCapacityTimeframeKey(opts.timeframe ?? undefined);
  const perfDays = Math.min(Math.max(opts.perfDays ?? 7, 1), 30);
  const end = new Date();
  const start = new Date(end.getTime() - perfDays * 24 * 60 * 60 * 1000);
  const perfStart = start.toISOString().slice(0, 13);
  const perfEnd = end.toISOString().slice(0, 13);

  const [kpi, gpuCapacity, perfByModel] = await Promise.all([
    getDashboardKPI({ timeframe }),
    getDashboardGPUCapacity({ timeframe: opts.timeframe ?? undefined }),
    getPerfByModel({ start: perfStart, end: perfEnd }),
  ]);

  return {
    schemaVersion: PYMTHOUSE_PLAN_BUILDER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      kpi: 'naap-facade:resolveKPI',
      gpuCapacity: 'naap-facade:resolveGPUCapacity',
      perfByModel: 'naap-api:perf/by-model',
    },
    window: {
      kpiHours: hours,
      perfRange: { start: perfStart, end: perfEnd },
      gpuTimeframe: gpuTf,
    },
    kpi,
    gpuCapacity,
    perfByModel,
  };
}

export interface NetworkPricePayload {
  schemaVersion: typeof PYMTHOUSE_PLAN_BUILDER_SCHEMA_VERSION;
  generatedAt: string;
  experimental: true;
  source: string;
  pricing: DashboardPipelinePricing[];
}

export async function buildNetworkPricePayload(): Promise<NetworkPricePayload> {
  const pricing = await getDashboardPricing();
  return {
    schemaVersion: PYMTHOUSE_PLAN_BUILDER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    experimental: true,
    source: 'naap-facade:resolvePricing',
    pricing,
  };
}
