import { useEffect, useState } from 'react';
import {
  fetchPipelines,
  fetchGPUMetrics,
  fetchSLACompliance,
  type GPUMetricRow,
  type SLAComplianceRow,
} from '../api/leaderboard';
import {
  PIPELINE_DISPLAY,
  MODEL_DISPLAY,
  EXCLUDED_MODELS,
  REALTIME_FPS_THRESHOLD,
  UNKNOWN_GPU,
} from '../data/model-catalog';

export interface CatalogModel {
  id: string;
  modelId: string;
  pipelineId: string;
  displayName: string;
  pipelineType: string;
  orchestratorCount: number;
  gpuTypes: string[];
  avgFPS: number;
  latencyP50: number | null;
  slaScore: number | null;
  isRealtime: boolean;
}

interface ModelCatalogResult {
  models: CatalogModel[];
  loading: boolean;
  error: string | null;
}

function matchesModel(row: GPUMetricRow | SLAComplianceRow, pipelineId: string, modelId: string): boolean {
  const m = row.model_id ?? row.pipeline;
  const p = row.pipeline;
  return m === modelId || p === modelId || (p === pipelineId && m === modelId);
}

function shortGPUName(name: string): string {
  return name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '');
}

function weightedSLAScore(rows: SLAComplianceRow[]): number | null {
  const valid = rows.filter((r) => r.sla_score != null && r.known_sessions > 0);
  if (!valid.length) return null;
  const totalSessions = valid.reduce((sum, row) => sum + row.known_sessions, 0);
  if (totalSessions <= 0) return null;
  return valid.reduce((sum, row) => sum + (row.sla_score! * row.known_sessions), 0) / totalSessions;
}

export function useModelCatalog(): ModelCatalogResult {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const [pipelines, gpuRows, slaRows] = await Promise.all([
          fetchPipelines(),
          fetchGPUMetrics('1h'),
          fetchSLACompliance('24h'),
        ]);

        if (cancelled) return;

        const result: CatalogModel[] = [];

        for (const pipeline of pipelines) {
          const pipelineType = PIPELINE_DISPLAY[pipeline.id] ?? pipeline.id;

          for (const modelId of pipeline.models) {
            if (EXCLUDED_MODELS.has(modelId)) continue;
            if (MODEL_DISPLAY[modelId] === null) continue;

            const displayName = MODEL_DISPLAY[modelId] ?? modelId;
            const modelGPURows = gpuRows.filter((row) => matchesModel(row, pipeline.id, modelId));
            const modelSLARows = slaRows.filter((row) => matchesModel(row, pipeline.id, modelId));

            const orchestratorCount = new Set(
              modelSLARows.map((row) => row.orchestrator_address).filter(Boolean)
            ).size;

            const gpuTypesSet = new Set<string>();
            for (const row of modelGPURows) {
              const gpuName = row.gpu_name ?? UNKNOWN_GPU;
              if (gpuName !== UNKNOWN_GPU) gpuTypesSet.add(shortGPUName(gpuName));
            }
            const gpuTypes = [...gpuTypesSet].sort();

            const validFPS = modelGPURows.filter((row) => row.avg_output_fps > 0);
            const avgFPS = validFPS.length
              ? Math.round(validFPS.reduce((sum, row) => sum + row.avg_output_fps, 0) / validFPS.length)
              : 0;

            const latencies = modelGPURows
              .map((row) => row.e2e_latency_ms)
              .filter((value): value is number => value != null);
            const latencyP50 = latencies.length
              ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
              : null;

            const slaScore = weightedSLAScore(modelSLARows);

            result.push({
              id: `${pipeline.id}::${modelId}`,
              modelId,
              pipelineId: pipeline.id,
              displayName,
              pipelineType,
              orchestratorCount,
              gpuTypes,
              avgFPS,
              latencyP50,
              slaScore,
              isRealtime: avgFPS >= REALTIME_FPS_THRESHOLD,
            });
          }
        }

        setModels(result);
        setError(null);
        if (import.meta.env.DEV) {
          console.debug('[useModelCatalog] Loaded', result.length, 'models from leaderboard API');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load model catalog');
          if (import.meta.env.DEV) {
            console.warn('[useModelCatalog] Leaderboard API request failed:', err);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading, error };
}
