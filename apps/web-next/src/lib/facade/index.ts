/**
 * Data Facade — single entry point for all UI data needs.
 *
 * Each function maps to one UI widget or data domain. BFF routes and
 * plugin backends call these functions instead of reaching into
 * resolvers, raw-data, or external services directly.
 *
 * FACADE_USE_STUBS=true — forces all functions to return hardcoded stub data.
 * Unset (or "false") — all resolvers call the live NAAP API; stub data is never
 * injected, including catalog seeding stubs.
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
import { resolveJobsByModel } from './resolvers/jobs-by-model.js';
import { resolveJobsDemand } from './resolvers/jobs-demand.js';
import { resolveJobsSLA } from './resolvers/jobs-sla.js';
import { resolveAIBatchSummary } from './resolvers/ai-batch-summary.js';
import { resolveAIBatchJobs } from './resolvers/ai-batch-jobs.js';
import { resolveAIBatchLLMSummary } from './resolvers/ai-batch-llm-summary.js';
import { resolveBYOCSummary } from './resolvers/byoc-summary.js';
import { resolveBYOCJobs } from './resolvers/byoc-jobs.js';
import { resolveBYOCWorkers } from './resolvers/byoc-workers.js';
import { resolveBYOCAuth } from './resolvers/byoc-auth.js';

const USE_STUBS = process.env.FACADE_USE_STUBS === 'true';

// ---------------------------------------------------------------------------
// Dashboard — NAAP API backed (Phase 1)
// ---------------------------------------------------------------------------

export async function getDashboardKPI(opts: { 
  timeframe?: string;
  pipeline?: string;
  model_id?: string;
}): Promise<DashboardKPI> {
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

// ---------------------------------------------------------------------------
// Jobs — NAAP API backed
// ---------------------------------------------------------------------------

export { type JobModelPerformance } from './resolvers/jobs-by-model.js';
export { type JobsDemandRow, type JobsDemandResponse, type CursorPagination } from './resolvers/jobs-demand.js';
export { type JobsSLARow, type JobsSLAResponse } from './resolvers/jobs-sla.js';
export { type AIBatchJobSummary } from './resolvers/ai-batch-summary.js';
export { type AIBatchJobRecord } from './resolvers/ai-batch-jobs.js';
export { type AIBatchLLMSummary } from './resolvers/ai-batch-llm-summary.js';
export { type BYOCJobSummary } from './resolvers/byoc-summary.js';
export { type BYOCJobRecord } from './resolvers/byoc-jobs.js';
export { type BYOCWorkerSummary } from './resolvers/byoc-workers.js';
export { type BYOCAuthSummary } from './resolvers/byoc-auth.js';

export async function getJobsByModel(opts: {
  window?: string;
  pipeline_id?: string;
  model_id?: string;
  job_type?: 'ai-batch' | 'byoc';
}): Promise<import('./resolvers/jobs-by-model.js').JobModelPerformance[]> {
  if (USE_STUBS) return stubs.jobsByModel;
  return resolveJobsByModel(opts);
}

export async function getJobsDemand(opts: {
  window?: string;
  pipeline_id?: string;
  model_id?: string;
  gateway?: string;
  job_type?: 'ai-batch' | 'byoc';
  limit?: number;
  cursor?: string;
}): Promise<import('./resolvers/jobs-demand.js').JobsDemandResponse> {
  if (USE_STUBS) return stubs.jobsDemand;
  return resolveJobsDemand(opts);
}

export async function getJobsSLA(opts: {
  window?: string;
  pipeline_id?: string;
  model_id?: string;
  orchestrator_address?: string;
  job_type?: 'ai-batch' | 'byoc';
  limit?: number;
  cursor?: string;
}): Promise<import('./resolvers/jobs-sla.js').JobsSLAResponse> {
  if (USE_STUBS) return stubs.jobsSLA;
  return resolveJobsSLA(opts);
}

export async function getAIBatchSummary(opts: {
  start: string;
  end: string;
}): Promise<import('./resolvers/ai-batch-summary.js').AIBatchJobSummary[]> {
  if (USE_STUBS) return stubs.aiBatchSummary;
  return resolveAIBatchSummary(opts);
}

export async function getAIBatchJobs(opts: {
  start: string;
  end: string;
  limit?: number;
  cursor?: string;
}): Promise<import('./resolvers/ai-batch-jobs.js').AIBatchJobRecord[]> {
  if (USE_STUBS) return stubs.aiBatchJobs;
  return resolveAIBatchJobs(opts);
}

export async function getAIBatchLLMSummary(opts: {
  start: string;
  end: string;
}): Promise<import('./resolvers/ai-batch-llm-summary.js').AIBatchLLMSummary[]> {
  if (USE_STUBS) return stubs.aiBatchLLMSummary;
  return resolveAIBatchLLMSummary(opts);
}

export async function getBYOCSummary(opts: {
  start: string;
  end: string;
}): Promise<import('./resolvers/byoc-summary.js').BYOCJobSummary[]> {
  if (USE_STUBS) return stubs.byocSummary;
  return resolveBYOCSummary(opts);
}

export async function getBYOCJobs(opts: {
  start: string;
  end: string;
  limit?: number;
  cursor?: string;
}): Promise<import('./resolvers/byoc-jobs.js').BYOCJobRecord[]> {
  if (USE_STUBS) return stubs.byocJobs;
  return resolveBYOCJobs(opts);
}

export async function getBYOCWorkers(opts: {
  start: string;
  end: string;
}): Promise<import('./resolvers/byoc-workers.js').BYOCWorkerSummary[]> {
  if (USE_STUBS) return stubs.byocWorkers;
  return resolveBYOCWorkers(opts);
}

export async function getBYOCAuth(opts: {
  start: string;
  end: string;
}): Promise<import('./resolvers/byoc-auth.js').BYOCAuthSummary[]> {
  if (USE_STUBS) return stubs.byocAuth;
  return resolveBYOCAuth(opts);
}
