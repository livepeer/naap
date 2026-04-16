/**
 * Orchestrator Leaderboard — Shared Types
 *
 * Types for the leaderboard API request/response, ClickHouse row mapping,
 * SLA weight configuration, discovery plans, and the in-memory cache.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// API Request
// ---------------------------------------------------------------------------

export interface LeaderboardFilters {
  gpuRamGbMin?: number;
  gpuRamGbMax?: number;
  priceMax?: number;
  maxAvgLatencyMs?: number;
  maxSwapRatio?: number;
}

export interface SLAWeights {
  latency?: number;
  swapRate?: number;
  price?: number;
}

export interface LeaderboardRequest {
  capability: string;
  topN?: number;
  filters?: LeaderboardFilters;
  slaWeights?: SLAWeights;
}

// ---------------------------------------------------------------------------
// API Response
// ---------------------------------------------------------------------------

export interface OrchestratorRow {
  orchUri: string;
  gpuName: string;
  gpuGb: number;
  avail: number;
  totalCap: number;
  pricePerUnit: number;
  bestLatMs: number | null;
  avgLatMs: number | null;
  swapRatio: number | null;
  avgAvail: number | null;
  slaScore?: number;
}

// ---------------------------------------------------------------------------
// ClickHouse JSON Response Mapping
// ---------------------------------------------------------------------------

export interface ClickHouseLeaderboardRow {
  orch_uri: string;
  gpu_name: string;
  gpu_gb: number;
  avail: number;
  total_cap: number;
  price_per_unit: number;
  best_lat_ms: number | null;
  avg_lat_ms: number | null;
  swap_ratio: number | null;
  avg_avail: number | null;
}

export interface ClickHouseJSONResponse {
  meta: Array<{ name: string; type: string }>;
  data: ClickHouseLeaderboardRow[];
  rows: number;
  statistics: { elapsed: number; rows_read: number; bytes_read: number };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Discovery Plans — Zod schemas
// ---------------------------------------------------------------------------

const CAPABILITY_RE = /^[a-zA-Z0-9_-]+$/;

export const FiltersSchema = z.object({
  gpuRamGbMin: z.number().min(0).optional(),
  gpuRamGbMax: z.number().min(0).optional(),
  priceMax: z.number().min(0).optional(),
  maxAvgLatencyMs: z.number().min(0).optional(),
  maxSwapRatio: z.number().min(0).max(1).optional(),
}).strict().optional();

export const SLAWeightsSchema = z.object({
  latency: z.number().min(0).max(1).optional(),
  swapRate: z.number().min(0).max(1).optional(),
  price: z.number().min(0).max(1).optional(),
}).strict().optional();

export const PLAN_SORT_OPTIONS = [
  'slaScore', 'latency', 'price', 'swapRate', 'avail',
] as const;

export type PlanSortBy = (typeof PLAN_SORT_OPTIONS)[number];

export const CreatePlanSchema = z.object({
  billingPlanId: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  capabilities: z.array(z.string().regex(CAPABILITY_RE).max(128)).min(1).max(50),
  topN: z.number().int().min(1).max(1000).default(10),
  slaWeights: SLAWeightsSchema,
  slaMinScore: z.number().min(0).max(1).optional(),
  sortBy: z.enum(PLAN_SORT_OPTIONS).optional(),
  filters: FiltersSchema,
});

export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;

export const UpdatePlanSchema = CreatePlanSchema.partial().omit({ billingPlanId: true });

export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;

// ---------------------------------------------------------------------------
// Discovery Plan — runtime types
// ---------------------------------------------------------------------------

export interface DiscoveryPlan {
  id: string;
  billingPlanId: string;
  name: string;
  description: string | null;
  teamId: string | null;
  ownerUserId: string | null;
  capabilities: string[];
  topN: number;
  slaWeights: SLAWeights | null;
  slaMinScore: number | null;
  sortBy: PlanSortBy | null;
  filters: LeaderboardFilters | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlanCapabilityResult {
  capability: string;
  orchestrators: OrchestratorRow[];
}

export interface PlanResults {
  planId: string;
  refreshedAt: string;
  capabilities: Record<string, OrchestratorRow[]>;
  plan?: {
    name: string;
    description: string | null;
    capabilities: string[];
    topN: number;
  };
  meta: {
    totalOrchestrators: number;
    refreshIntervalMs: number;
    cacheAgeMs: number;
  };
}
