/**
 * GPU capacity data from ClickHouse `network_capabilities` events.
 *
 * Fetches raw rows via the `livepeer-naap-analytics` managed connector in the
 * Service Gateway, then aggregates into the DashboardGPUCapacity shape.
 *
 * Caching is handled by the gateway's per-endpoint cacheTtl (60s).
 */

import type { DashboardGPUCapacity } from '@naap/plugin-sdk';
import {
  PIPELINE_DISPLAY,
} from './pipeline-config.js';
import { queryManagedConnector } from '@/lib/gateway/internal-client';

export const GPU_CAPACITY_CH_TTL_SECONDS = 1 * 60;

const CONNECTOR_SLUG = 'livepeer-naap-analytics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClickHouseNodeRow {
  address: string;
  orch_uri: string;
  version: string;
  hardware_raw: string[];
  prices_raw: string[];
}

interface ParsedGPU {
  id: string;
  name: string;
  memoryTotal: number;
}

interface ParsedHardwareEntry {
  pipeline: string;
  modelId: string;
  gpus: ParsedGPU[];
}

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

function parseHardwareEntry(rawJson: string): ParsedHardwareEntry | null {
  try {
    const hw = JSON.parse(rawJson) as {
      pipeline?: string;
      model_id?: string;
      gpu_info?: Record<string, { id?: string; name?: string; memory_total?: string | number }>;
    };
    const pipeline = hw.pipeline?.trim() ?? '';
    const modelId = hw.model_id?.trim() ?? '';
    if (!pipeline && !modelId) return null;

    const gpus: ParsedGPU[] = [];
    if (hw.gpu_info && typeof hw.gpu_info === 'object') {
      for (const gpuEntry of Object.values(hw.gpu_info)) {
        if (!gpuEntry?.id) continue;
        gpus.push({
          id: gpuEntry.id,
          name: gpuEntry.name ?? 'Unknown GPU',
          memoryTotal: Number(gpuEntry.memory_total ?? 0),
        });
      }
    }
    return { pipeline, modelId, gpus };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function aggregateGPUCapacity(rows: ClickHouseNodeRow[]): DashboardGPUCapacity {
  const allGpuIds = new Set<string>();
  const gpuNameById = new Map<string, string>();
  const pipelineGpuSets = new Map<string, { gpuIds: Set<string>; byModel: Map<string, Set<string>> }>();

  for (const row of rows) {
    for (const hwRaw of row.hardware_raw) {
      const entry = parseHardwareEntry(hwRaw);
      if (!entry) continue;

      for (const gpu of entry.gpus) {
        allGpuIds.add(gpu.id);
        gpuNameById.set(gpu.id, gpu.name);
      }

      const pipelineId = entry.pipeline;
      if (pipelineId && PIPELINE_DISPLAY[pipelineId] !== null) {
        if (!pipelineGpuSets.has(pipelineId)) {
          pipelineGpuSets.set(pipelineId, { gpuIds: new Set(), byModel: new Map() });
        }
        const pAcc = pipelineGpuSets.get(pipelineId)!;
        for (const gpu of entry.gpus) {
          pAcc.gpuIds.add(gpu.id);
        }
        if (entry.modelId) {
          if (!pAcc.byModel.has(entry.modelId)) pAcc.byModel.set(entry.modelId, new Set());
          for (const gpu of entry.gpus) {
            pAcc.byModel.get(entry.modelId)!.add(gpu.id);
          }
        }
      }
    }
  }

  const totalGPUs = allGpuIds.size;
  const activeGPUs = totalGPUs;

  const modelCounts = new Map<string, number>();
  for (const [, gpuName] of gpuNameById) {
    modelCounts.set(gpuName, (modelCounts.get(gpuName) ?? 0) + 1);
  }
  const models = [...modelCounts.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count);

  const pipelineGPUs = [...pipelineGpuSets.entries()]
    .map(([pipelineId, acc]) => ({
      name: PIPELINE_DISPLAY[pipelineId] ?? pipelineId,
      gpus: acc.gpuIds.size,
      models: acc.byModel.size > 0
        ? [...acc.byModel.entries()]
            .map(([model, gpuIds]) => ({ model, gpus: gpuIds.size }))
            .sort((a, b) => b.gpus - a.gpus)
        : undefined,
    }))
    .sort((a, b) => b.gpus - a.gpus);

  return {
    totalGPUs,
    activeGPUs,
    availableCapacity: 100,
    models,
    pipelineGPUs,
  };
}

// ---------------------------------------------------------------------------
// Fetch via managed connector
// ---------------------------------------------------------------------------

export async function fetchGPUCapacityFromClickHouse(): Promise<DashboardGPUCapacity> {
  const t0 = Date.now();

  let response: Response;
  try {
    response = await queryManagedConnector(CONNECTOR_SLUG, '/gpu-capacity');
  } catch (err) {
    console.warn('[gpu-capacity-ch] Managed connector query failed:', err);
    return { totalGPUs: 0, activeGPUs: 0, availableCapacity: 0, models: [], pipelineGPUs: [] };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `[gpu-capacity-ch] ClickHouse HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }

  const body = (await response.json()) as { data?: ClickHouseNodeRow[] };
  const data = body.data;
  if (!Array.isArray(data)) {
    throw new Error('[gpu-capacity-ch] ClickHouse response missing data array');
  }

  const result = aggregateGPUCapacity(data);
  console.log(
    `[gpu-capacity-ch] fetched ${data.length} nodes → ` +
    `${result.totalGPUs} GPUs, ${result.models.length} hardware models, ` +
    `${result.pipelineGPUs.length} pipelines in ${Date.now() - t0}ms`
  );
  return result;
}
