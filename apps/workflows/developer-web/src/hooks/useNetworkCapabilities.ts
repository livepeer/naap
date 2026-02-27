/**
 * useNetworkCapabilities
 *
 * Fetches the leaderboard API in parallel and aggregates raw rows into
 * typed NetworkModel objects ready for the Models tab search UI.
 *
 * Data flow:
 *   /api/pipelines        → catalog of (pipeline, model, regions)
 *   /api/gpu/metrics?1h   → per-orchestrator hardware + FPS/latency
 *   /api/sla/compliance?24h → per-orchestrator SLA scores
 *   /api/regions          → region ID → display name (AI regions only)
 */

import { useState, useEffect } from 'react';
import type {
  NetworkModel,
  GPUHardwareSummary,
  GatewayOffer,
  NetworkDemandSummary,
  CapacityLevel,
  SLATier,
} from '@naap/types';
import {
  fetchPipelines,
  fetchRegions,
  fetchGPUMetrics,
  fetchSLACompliance,
  fetchNetworkDemand,
  type GPUMetricRow,
  type SLAComplianceRow,
  type RegionEntry,
  type NetworkDemandRow,
} from '../api/leaderboard.js';
import {
  PIPELINE_DISPLAY,
  MODEL_DISPLAY,
  EXCLUDED_MODELS,
  REALTIME_FPS_THRESHOLD,
  UNKNOWN_GPU,
} from '../data/network-config.js';

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/**
 * In the leaderboard GPU metrics, the `pipeline` field corresponds to the
 * model/sub-pipeline identifier (e.g. "streamdiffusion-sdxl"), not the parent
 * pipeline ID (e.g. "live-video-to-video"). This function tries both.
 */
function matchesModel(row: GPUMetricRow, pipelineId: string, modelId: string): boolean {
  const m = row.model_id ?? row.pipeline;
  const p = row.pipeline;
  return m === modelId || p === modelId || (p === pipelineId && m === modelId);
}

function matchesSLA(row: SLAComplianceRow, pipelineId: string, modelId: string): boolean {
  const m = row.model_id ?? row.pipeline;
  const p = row.pipeline;
  return m === modelId || p === modelId || (p === pipelineId && m === modelId);
}

function matchesDemand(row: NetworkDemandRow, pipelineId: string, modelId: string): boolean {
  return row.pipeline === modelId || row.pipeline === pipelineId;
}

/** Aggregate GPU metric rows by gpu_name */
function buildGPUHardware(rows: GPUMetricRow[]): GPUHardwareSummary[] {
  const byName = new Map<string, GPUMetricRow[]>();
  for (const r of rows) {
    const name = r.gpu_name ?? UNKNOWN_GPU;
    const bucket = byName.get(name) ?? [];
    bucket.push(r);
    byName.set(name, bucket);
  }

  return [...byName.entries()].map(([name, group]) => {
    const gpuIds = new Set(group.map((r) => r.gpu_id).filter(Boolean));
    const count = gpuIds.size || group.length;

    // VRAM: take max seen (all same hw should be equal; avoid 0 nulls)
    const maxVRAM = group.reduce((m, r) => Math.max(m, r.gpu_memory_total ?? 0), 0);
    const memoryGB = maxVRAM > 0 ? Math.round(maxVRAM / 1e9) : 0;

    const validFPS = group.filter((r) => r.avg_output_fps > 0);
    const avgFPS = validFPS.length
      ? Math.round(validFPS.reduce((s, r) => s + r.avg_output_fps, 0) / validFPS.length)
      : 0;
    const p95FPS = Math.round(
      group.reduce((s, r) => s + r.p95_output_fps, 0) / Math.max(group.length, 1)
    );

    const latencies = group.map((r) => r.e2e_latency_ms).filter((v): v is number => v != null);
    const avgLatencyMs = latencies.length
      ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
      : null;

    const failureRate =
      group.reduce((s, r) => s + r.failure_rate, 0) / Math.max(group.length, 1);

    return { name, count, memoryGB, avgFPS, p95FPS, avgLatencyMs, failureRate };
  });
}

/** Weighted avg sla_score by known_sessions */
function weightedSLAScore(rows: SLAComplianceRow[]): number | null {
  const valid = rows.filter((r) => r.sla_score != null && r.known_sessions > 0);
  if (!valid.length) return null;
  const totalSessions = valid.reduce((s, r) => s + r.known_sessions, 0);
  return valid.reduce((s, r) => s + (r.sla_score! * r.known_sessions), 0) / totalSessions;
}

function gatewayId(gatewayName: string): string {
  return gatewayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function toCapacityLevel(missingCapacityCount: number, totalDemandSessions: number): CapacityLevel {
  if (totalDemandSessions <= 0) return 'medium';
  const shortageRate = missingCapacityCount / totalDemandSessions;
  if (shortageRate <= 0.02) return 'high';
  if (shortageRate <= 0.1) return 'medium';
  return 'low';
}

function toSLATier(successRatio: number): SLATier {
  if (successRatio >= 0.995) return 'gold';
  if (successRatio >= 0.98) return 'silver';
  return 'bronze';
}

function buildGatewayOffers(
  rows: NetworkDemandRow[],
  regionMap: Map<string, string>,
  fallbackLatencyMs: number | null
): GatewayOffer[] {
  const byGateway = new Map<string, NetworkDemandRow[]>();
  for (const row of rows) {
    const bucket = byGateway.get(row.gateway) ?? [];
    bucket.push(row);
    byGateway.set(row.gateway, bucket);
  }

  const summaries: NetworkDemandSummary[] = [...byGateway.entries()].map(([gatewayName, group]) => {
    const totalSessions = group.reduce((sum, row) => sum + row.total_sessions, 0);
    const servedSessions = group.reduce((sum, row) => sum + row.served_sessions, 0);
    const totalDemandSessions = group.reduce((sum, row) => sum + row.total_demand_sessions, 0);
    const missingCapacityCount = group.reduce((sum, row) => sum + row.missing_capacity_count, 0);
    const totalInferenceMinutes = group.reduce((sum, row) => sum + row.total_inference_minutes, 0);
    const feePaymentEth = group.reduce((sum, row) => sum + row.fee_payment_eth, 0);
    const weightedSuccess = totalSessions
      ? group.reduce((sum, row) => sum + row.success_ratio * row.total_sessions, 0) / totalSessions
      : 0;
    const regions = [...new Set(
      group
        .map((row) => row.region)
        .filter((region): region is string => Boolean(region))
        .map((code) => regionMap.get(code) ?? code)
    )];

    return {
      gatewayId: gatewayId(gatewayName),
      gatewayName,
      pipeline: group[0]?.pipeline ?? '',
      regions,
      totalSessions,
      servedSessions,
      missingCapacityCount,
      successRatio: weightedSuccess,
      totalInferenceMinutes,
      feePaymentEth,
      demandLevel: toCapacityLevel(missingCapacityCount, totalDemandSessions),
    };
  });

  return summaries
    .map((summary) => ({
      gatewayId: summary.gatewayId,
      gatewayName: summary.gatewayName,
      slaTier: toSLATier(summary.successRatio),
      uptimeGuarantee: Number((summary.successRatio * 100).toFixed(2)),
      latencyGuarantee: fallbackLatencyMs ?? 250,
      unitPrice:
        summary.totalInferenceMinutes > 0
          ? summary.feePaymentEth / summary.totalInferenceMinutes
          : 0,
      regions: summary.regions,
      capacity: summary.demandLevel,
    }))
    .sort((a, b) => {
      const capacityRank = { high: 3, medium: 2, low: 1 };
      const byCapacity = capacityRank[b.capacity] - capacityRank[a.capacity];
      if (byCapacity !== 0) return byCapacity;
      return b.uptimeGuarantee - a.uptimeGuarantee;
    });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface NetworkCapabilities {
  models: NetworkModel[];
  gpuTypes: string[];
  regions: RegionEntry[];
  loading: boolean;
  error: string | null;
}

export function useNetworkCapabilities(refreshIntervalMs = 60_000): NetworkCapabilities {
  const [models, setModels] = useState<NetworkModel[]>([]);
  const [gpuTypes, setGpuTypes] = useState<string[]>([]);
  const [regions, setRegions] = useState<RegionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(isInitialLoad = false) {
      try {
        if (isInitialLoad) setLoading(true);

        const [pipelines, regionList, gpuRows, slaRows, demandRows] = await Promise.all([
          fetchPipelines(),
          fetchRegions(),
          fetchGPUMetrics('1h'),
          fetchSLACompliance('24h'),
          fetchNetworkDemand('1h'),
        ]);

        if (cancelled) return;

        // Build region lookup: id → display name
        const regionMap = new Map(regionList.map((r) => [r.id, r.name]));

        const result: NetworkModel[] = [];

        for (const pipeline of pipelines) {
          const pipelineType = PIPELINE_DISPLAY[pipeline.id] ?? pipeline.id;

          for (const modelId of pipeline.models) {
            // Skip excluded (e.g. noop benchmark)
            if (EXCLUDED_MODELS.has(modelId)) continue;
            if (MODEL_DISPLAY[modelId] === null) continue;

            const displayName = MODEL_DISPLAY[modelId] ?? modelId;

            // Filter GPU metric rows for this model
            const modelGPURows = gpuRows.filter((r) =>
              matchesModel(r, pipeline.id, modelId)
            );

            // Filter SLA rows for this model
            const modelSLARows = slaRows.filter((r) =>
              matchesSLA(r, pipeline.id, modelId)
            );

            const gpuHardware = buildGPUHardware(modelGPURows);

            // Overall FPS: weighted avg across all GPU rows
            const validFPS = modelGPURows.filter((r) => r.avg_output_fps > 0);
            const avgFPS = validFPS.length
              ? Math.round(
                  validFPS.reduce((s, r) => s + r.avg_output_fps, 0) / validFPS.length
                )
              : 0;

            // E2E latency: avg across rows that have it
            const latencies = modelGPURows
              .map((r) => r.e2e_latency_ms)
              .filter((v): v is number => v != null);
            const e2eLatencyMs = latencies.length
              ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
              : null;

            const slaScore = weightedSLAScore(modelSLARows);

            const orchestratorCount = new Set(
              modelSLARows.map((r) => r.orchestrator_address).filter(Boolean)
            ).size;

            const regionCodes = pipeline.regions;
            const regionNames = regionCodes
              .map((code) => regionMap.get(code) ?? code)
              .filter(Boolean);
            const modelDemandRows = demandRows.filter((row) =>
              matchesDemand(row, pipeline.id, modelId)
            );
            const gatewayOffers = buildGatewayOffers(modelDemandRows, regionMap, e2eLatencyMs);

            result.push({
              id: `${pipeline.id}::${modelId}`,
              pipelineId: pipeline.id,
              pipelineType,
              modelId,
              displayName,
              regions: regionNames,
              regionCodes,
              gpuHardware,
              orchestratorCount,
              avgFPS,
              e2eLatencyMs,
              slaScore,
              isRealtime: avgFPS >= REALTIME_FPS_THRESHOLD,
              gatewayOffers,
            });
          }
        }

        // Derive unique GPU types across all models (excluding unknown)
        const allGPUNames = new Set<string>();
        for (const m of result) {
          for (const g of m.gpuHardware) {
            if (g.name !== UNKNOWN_GPU) allGPUNames.add(g.name);
          }
        }

        setModels(result);
        setGpuTypes([...allGPUNames].sort());
        setRegions(regionList);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load network data');
        }
      } finally {
        if (!cancelled && isInitialLoad) setLoading(false);
      }
    }

    load(true);
    const pollInterval = refreshIntervalMs > 0
      ? window.setInterval(() => {
          void load(false);
        }, refreshIntervalMs)
      : null;

    return () => {
      cancelled = true;
      if (pollInterval != null) window.clearInterval(pollInterval);
    };
  }, [refreshIntervalMs]);

  return { models, gpuTypes, regions, loading, error };
}
