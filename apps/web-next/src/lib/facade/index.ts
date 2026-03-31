/**
 * Data Facade — single entry point for all UI data needs.
 *
 * Each function maps to one UI widget or data domain. BFF routes and
 * plugin backends call these functions instead of reaching into
 * resolvers, raw-data, or external services directly.
 *
 * FACADE_USE_STUBS=true — returns hardcoded stub data (Phase 0 default).
 * Unset (or "false") — delegates to real resolver implementations added
 * phase by phase in ./resolvers/.
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

const USE_STUBS = process.env.FACADE_USE_STUBS === 'true';

// ---------------------------------------------------------------------------
// Dashboard — Leaderboard API backed (Phase 1)
// ---------------------------------------------------------------------------

export async function getDashboardKPI(opts: { timeframe?: string }): Promise<DashboardKPI> {
  if (USE_STUBS) return { ...stubs.kpi, timeframeHours: parseInt(opts.timeframe ?? '24', 10) || 24 };
  // Phase 1: import and call resolvers/kpi.ts
  throw new Error('[facade] getDashboardKPI: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}

export async function getDashboardPipelines(opts: {
  limit?: number;
  timeframe?: string;
}): Promise<DashboardPipelineUsage[]> {
  if (USE_STUBS) return stubs.pipelines.slice(0, opts.limit ?? 5);
  // Phase 1: import and call resolvers/pipelines.ts
  throw new Error('[facade] getDashboardPipelines: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}

export async function getDashboardPipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  if (USE_STUBS) return stubs.pipelineCatalog;
  // Phase 1: import and call resolvers/pipeline-catalog.ts
  throw new Error('[facade] getDashboardPipelineCatalog: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}

export async function getDashboardOrchestrators(opts: {
  period?: string;
}): Promise<DashboardOrchestrator[]> {
  if (USE_STUBS) return stubs.orchestrators;
  // Phase 1: import and call resolvers/orchestrators.ts
  void opts;
  throw new Error('[facade] getDashboardOrchestrators: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}

export async function getDashboardPricing(): Promise<DashboardPipelinePricing[]> {
  if (USE_STUBS) return stubs.pricing;
  // Phase 1: import and call resolvers/pricing.ts
  throw new Error('[facade] getDashboardPricing: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}

// ---------------------------------------------------------------------------
// Dashboard — The Graph backed (Phase 2)
// ---------------------------------------------------------------------------

export async function getDashboardProtocol(): Promise<DashboardProtocol> {
  if (USE_STUBS) return stubs.protocol;
  // Phase 2: import and call resolvers/protocol.ts
  throw new Error('[facade] getDashboardProtocol: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}

export async function getDashboardFees(opts: { days?: number }): Promise<DashboardFeesInfo> {
  if (USE_STUBS) return stubs.fees;
  // Phase 2: import and call resolvers/fees.ts
  void opts;
  throw new Error('[facade] getDashboardFees: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}

// ---------------------------------------------------------------------------
// Dashboard — ClickHouse backed (Phase 3)
// ---------------------------------------------------------------------------

export async function getDashboardGPUCapacity(opts: {
  timeframe?: string;
}): Promise<DashboardGPUCapacity> {
  if (USE_STUBS) return stubs.gpuCapacity;
  // Phase 3: import and call resolvers/gpu-capacity.ts
  void opts;
  throw new Error('[facade] getDashboardGPUCapacity: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}

export async function getDashboardJobFeed(): Promise<JobFeedItem[]> {
  if (USE_STUBS) return stubs.jobFeed;
  // Phase 3: import and call resolvers/job-feed.ts
  throw new Error('[facade] getDashboardJobFeed: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}

// ---------------------------------------------------------------------------
// Developer / Network Models — Leaderboard API backed (Phase 4)
// ---------------------------------------------------------------------------

export async function getNetworkModels(opts: { limit?: number }): Promise<NetworkModel[]> {
  if (USE_STUBS) return stubs.networkModels.slice(0, opts.limit ?? 50);
  // Phase 4: import and call resolvers/network-models.ts
  void opts;
  throw new Error('[facade] getNetworkModels: real resolver not yet implemented — set FACADE_USE_STUBS=true');
}
