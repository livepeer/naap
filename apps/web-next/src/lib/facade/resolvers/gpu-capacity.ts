/**
 * GPU Capacity resolver — NAAP API backed.
 *
 * Pipeline list and GPU counts are derived entirely from the hardware[] array
 * in each orchestrator's RawCapabilities JSON. Only pipelines with actual GPU
 * hardware entries appear here.
 *
 * Sources:
 *   facade/network-data → GET /v1/net/orchestrators?active_only=false&limit=200
 */

import type { DashboardGPUCapacity } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { getRawOrchestrators } from '../network-data.js';

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveGPUCapacity(_opts: { timeframe?: string }): Promise<DashboardGPUCapacity> {
  return cachedFetch('facade:gpu-capacity', TTL.GPU_CAPACITY * 1000, async () => {
    const orchs = await getRawOrchestrators();

    // --- Build GPU inventory from orchestrator hardware[] entries ---
    const gpuToModel = new Map<string, string>(); // gpu_id → gpu_model_name
    const pipelineGpus = new Map<string, Set<string>>(); // pipeline → Set<gpu_id>
    const pipelineModelGpus = new Map<string, Map<string, Set<string>>>(); // pipeline → model → Set<gpu_id>

    for (const orch of orchs) {
      const hardware = orch.capabilities?.hardware ?? [];
      for (const entry of hardware) {
        const gpuInfoMap = entry.gpu_info ?? {};
        for (const gpuInfo of Object.values(gpuInfoMap)) {
          if (!gpuInfo.id) continue;

          if (!gpuToModel.has(gpuInfo.id)) {
            gpuToModel.set(gpuInfo.id, gpuInfo.name ?? 'Unknown GPU');
          }

          if (entry.pipeline) {
            if (!pipelineGpus.has(entry.pipeline)) pipelineGpus.set(entry.pipeline, new Set());
            pipelineGpus.get(entry.pipeline)!.add(gpuInfo.id);

            if (entry.model_id) {
              if (!pipelineModelGpus.has(entry.pipeline)) pipelineModelGpus.set(entry.pipeline, new Map());
              const modelMap = pipelineModelGpus.get(entry.pipeline)!;
              if (!modelMap.has(entry.model_id)) modelMap.set(entry.model_id, new Set());
              modelMap.get(entry.model_id)!.add(gpuInfo.id);
            }
          }
        }
      }
    }

    // --- Build pipeline entries from hardware data only ---
    const pipelineGPUEntries = [...pipelineGpus.entries()].map(([pipeline, gpuSet]) => {
      const modelMap = pipelineModelGpus.get(pipeline);
      const perModel = modelMap
        ? [...modelMap.entries()].map(([model, mGpus]) => ({ model, gpus: mGpus.size })).sort((a, b) => b.gpus - a.gpus)
        : [];
      return { name: pipeline, gpus: gpuSet.size, models: perModel };
    }).sort((a, b) => b.gpus - a.gpus);

    // --- Overall GPU model counts (unchanged — from hardware data) ---
    const modelCounts = new Map<string, number>();
    for (const model of gpuToModel.values()) {
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    }

    const totalGPUs = gpuToModel.size;
    const models = [...modelCounts.entries()]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalGPUs,
      activeGPUs: totalGPUs,
      availableCapacity: totalGPUs > 0 ? 1.0 : 0,
      models,
      pipelineGPUs: pipelineGPUEntries,
    };
  });
}
