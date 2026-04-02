/**
 * Data Facade — single entry point for all UI data needs.
 *
 * Each function maps to one UI widget or data domain. BFF routes and
 * plugin backends call these functions instead of reaching into
 * resolvers, raw-data, or external services directly.
 *
 * FACADE_USE_STUBS=true — forces all functions to return hardcoded stub data.
 * Unset (or "false") — implemented resolvers call the live NAAP API;
 * unimplemented resolvers (phases not yet complete) return stub data silently.
 *
 * Adding a new data domain:
 *   1. Add the function signature here
 *   2. Add stub data in stubs.ts
 *   3. Add the real resolver in resolvers/<domain>.ts
 *   4. Wire the BFF route to call this function
 */

import type {
  DashboardKPI,
  DashboardPipelineUsage,
  DashboardPipelineCatalogEntry,
  DashboardOrchestrator,
  DashboardProtocol,
  DashboardFeesInfo,
  DashboardGPUCapacity,
  DashboardPipelinePricing,
} from '@naap/plugin-sdk';

import type { NetworkModel, JobFeedItem } from './types.js';
import * as stubs from './stubs.js';
import { resolveKPI } from './resolvers/kpi.js';
import { resolvePipelines } from './resolvers/pipelines.js';
import { resolvePipelineCatalog } from './resolvers/pipeline-catalog.js';
import { resolveOrchestrators } from './resolvers/orchestrators.js';
import { resolveGPUCapacity } from './resolvers/gpu-capacity.js';
import { resolvePricing } from './resolvers/pricing.js';
import { resolveNetworkModels } from './resolvers/network-models.js';
import { resolveNetCapacity } from './resolvers/net-capacity.js';
import { resolvePerfByModel } from './resolvers/perf-by-model.js';
import { resolveDaydreamCapacity } from './resolvers/daydream-capacity.js';
import { resolveProtocol } from './resolvers/protocol.js';
import { resolveFees } from './resolvers/fees.js';
import { resolveJobFeed } from './resolvers/job-feed.js';

const USE_STUBS = process.env.FACADE_USE_STUBS === 'true';

// ---------------------------------------------------------------------------
// Dashboard — NAAP API backed (Phase 1)
// ---------------------------------------------------------------------------

export async function getDashboardKPI(opts: { timeframe?: string }): Promise<DashboardKPI> {
  if (USE_STUBS) return { ...stubs.kpi, timeframeHours: parseInt(opts.timeframe ?? '24', 10) || 24 };
  return resolveKPI(opts);
}

export async function getDashboardPipelines(opts: {
  limit?: number;
  timeframe?: string;
}): Promise<DashboardPipelineUsage[]> {
  if (USE_STUBS) {
    const lim = opts.limit ?? 5;
    const parsed = parseInt(opts.timeframe ?? '24', 10);
    const hours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
    const factor = hours / 24;
    return stubs.pipelines
      .map((p) => ({
        ...p,
        mins: Math.round(p.mins * factor),
        sessions: Math.max(0, Math.round(p.sessions * factor)),
      }))
      .slice(0, lim);
  }
  return resolvePipelines({ limit: opts.limit, timeframe: opts.timeframe });
}

export async function getDashboardPipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  if (USE_STUBS) return stubs.pipelineCatalog;
  return resolvePipelineCatalog();
}

export async function getDashboardOrchestrators(opts: {
  period?: string;
}): Promise<DashboardOrchestrator[]> {
  if (USE_STUBS) return stubs.orchestrators;
  return resolveOrchestrators(opts);
}

export async function getDashboardPricing(): Promise<DashboardPipelinePricing[]> {
  if (USE_STUBS) return stubs.pricing;
  return resolvePricing();
}

// ---------------------------------------------------------------------------
// Dashboard — The Graph backed
// ---------------------------------------------------------------------------

export async function getDashboardProtocol(): Promise<DashboardProtocol> {
  if (USE_STUBS) return stubs.protocol;
  return resolveProtocol();
}

export async function getDashboardFees(opts: { days?: number }): Promise<DashboardFeesInfo> {
  if (USE_STUBS) return stubs.fees;
  return resolveFees(opts);
}

// ---------------------------------------------------------------------------
// Dashboard — NAAP API backed
// ---------------------------------------------------------------------------

export async function getDashboardGPUCapacity(opts: {
  timeframe?: string;
}): Promise<DashboardGPUCapacity> {
  if (USE_STUBS) return stubs.gpuCapacity;
  return resolveGPUCapacity(opts);
}

export async function getDashboardJobFeed(): Promise<JobFeedItem[]> {
  if (USE_STUBS) return stubs.jobFeed;
  return resolveJobFeed({});
}

// ---------------------------------------------------------------------------
// Developer / Network Models — NAAP API backed
// ---------------------------------------------------------------------------

export async function getNetworkModels(opts: { limit?: number }): Promise<{
  models: NetworkModel[];
  total: number;
}> {
  if (USE_STUBS) {
    const all = stubs.networkModels;
    const models =
      opts.limit === undefined
        ? all
        : all.slice(0, Math.max(0, Math.floor(opts.limit)));
    return { models, total: all.length };
  }
  return resolveNetworkModels(opts);
}

// ---------------------------------------------------------------------------
// Net capacity — NAAP API backed
// ---------------------------------------------------------------------------

export async function getNetCapacity(): Promise<Record<string, number>> {
  if (USE_STUBS) return {};
  return resolveNetCapacity();
}

export async function getPerfByModel(opts: {
  start: string;
  end: string;
}): Promise<Record<string, number>> {
  if (USE_STUBS) return {};
  return resolvePerfByModel(opts);
}

// ---------------------------------------------------------------------------
// Live-video-to-video capacity — api.daydream.live backed
// ---------------------------------------------------------------------------

export async function getLiveVideoCapacity(models: string[]): Promise<Record<string, number>> {
  if (USE_STUBS) return {};
  return resolveDaydreamCapacity(models);
}
