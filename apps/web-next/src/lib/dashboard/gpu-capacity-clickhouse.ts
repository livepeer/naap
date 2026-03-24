/**
 * GPU capacity data from ClickHouse `network_capabilities` events.
 *
 * Replaces the leaderboard-based GPU metrics fetch with a direct ClickHouse
 * query against the latest `network_capabilities` snapshot. This provides
 * real-time GPU hardware inventory and model availability for the dashboard.
 *
 * Env (server-only): CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD
 *
 * Caching: two-layer strategy (same as pipeline-unit-cost.ts):
 *   1. In-process TTL cache (works in dev where Next Data Cache is off)
 *   2. next: { revalidate } on the outbound fetch (production Data Cache)
 */

import type { DashboardGPUCapacity } from '@naap/plugin-sdk';
import {
  PIPELINE_DISPLAY,
} from './pipeline-config.js';

export const GPU_CAPACITY_CH_TTL_SECONDS = 1 * 60;

// ---------------------------------------------------------------------------
// SQL — fetch orchestrator hardware from the latest network_capabilities event
// ---------------------------------------------------------------------------

const GPU_CAPACITY_SQL = `
WITH
latest_timestamp AS (
    SELECT max(timestamp) AS max_ts
    FROM network_events.network_events
    WHERE type = 'network_capabilities'
),
latest_nodes AS (
    SELECT
        arrayJoin(JSONExtract(toString(data), 'Array(JSON)')) AS node
    FROM network_events.network_events, latest_timestamp
    WHERE type = 'network_capabilities'
      AND timestamp = max_ts
)
SELECT
    JSONExtractString(toString(node), 'address') AS address,
    JSONExtractString(toString(node), 'orch_uri') AS orch_uri,
    JSONExtractString(toString(node), 'capabilities', 'version') AS version,
    JSONExtractArrayRaw(toString(node), 'hardware') AS hardware_raw,
    JSONExtractArrayRaw(toString(node), 'capabilities_prices') AS prices_raw
FROM latest_nodes
WHERE JSONExtractString(toString(node), 'address') != ''
FORMAT JSON
`.trim();

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
  const activeGPUs = totalGPUs; // all reported GPUs are available in the latest snapshot

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
// In-process TTL cache
// ---------------------------------------------------------------------------

let gpuCapacityCache: { expiresAt: number; promise: Promise<DashboardGPUCapacity> } | null = null;

async function fetchGPUCapacityUncached(): Promise<DashboardGPUCapacity> {
  const baseUrl = process.env.CLICKHOUSE_URL?.trim();
  const user = process.env.CLICKHOUSE_USER?.trim();
  const password = process.env.CLICKHOUSE_PASSWORD?.trim();

  if (!baseUrl || !user || !password) {
    console.warn('[gpu-capacity-ch] ClickHouse env not configured — returning empty');
    return { totalGPUs: 0, activeGPUs: 0, availableCapacity: 0, models: [], pipelineGPUs: [] };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/`;
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const t0 = Date.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: GPU_CAPACITY_SQL,
    signal: AbortSignal.timeout(60_000),
    next: { revalidate: GPU_CAPACITY_CH_TTL_SECONDS },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[gpu-capacity-ch] ClickHouse HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }

  const body = (await res.json()) as { data?: ClickHouseNodeRow[] };
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

export function fetchGPUCapacityFromClickHouse(): Promise<DashboardGPUCapacity> {
  const now = Date.now();
  if (gpuCapacityCache && gpuCapacityCache.expiresAt > now) {
    console.log(`[gpu-capacity-ch] CACHE HIT (expires in ${Math.round((gpuCapacityCache.expiresAt - now) / 1000)}s)`);
    return gpuCapacityCache.promise;
  }

  console.log('[gpu-capacity-ch] CACHE MISS — fetching upstream');
  const promise = fetchGPUCapacityUncached().catch((err) => {
    gpuCapacityCache = null;
    throw err;
  });
  gpuCapacityCache = { expiresAt: now + GPU_CAPACITY_CH_TTL_SECONDS * 1000, promise };
  return promise;
}
