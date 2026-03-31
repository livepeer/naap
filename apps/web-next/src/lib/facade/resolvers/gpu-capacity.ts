/**
 * GPU Capacity resolver — NAAP API backed.
 *
 * Fetches GET /v1/gpu/metrics (paginated) and aggregates GPU inventory.
 *
 * Source:
 *   GET /v1/gpu/metrics?window=24h → paginated GPU metric rows
 */

import type { DashboardGPUCapacity } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

// ---------------------------------------------------------------------------
// Raw NAAP API types
// ---------------------------------------------------------------------------

interface NaapGPUMetricRow {
  orchestrator_address: string;
  pipeline_id: string;
  model_id: string | null;
  gpu_id: string | null;
  gpu_model_name: string | null;
  known_sessions_count: number;
}

// ---------------------------------------------------------------------------
// Paginated fetch helper
// ---------------------------------------------------------------------------

async function fetchAllGPURows(): Promise<NaapGPUMetricRow[]> {
  const pageSize = 200;
  const baseUrl = naapApiUpstreamUrl('gpu/metrics');

  async function fetchPage(page: number): Promise<{ rows: NaapGPUMetricRow[]; totalPages: number }> {
    const url = new URL(baseUrl);
    url.searchParams.set('window', '24h');
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));

    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`[facade/gpu-capacity] gpu/metrics page ${page} returned HTTP ${res.status}`);

    const body = (await res.json()) as Record<string, unknown>;
    const rows = (body.metrics ?? body.data ?? []) as NaapGPUMetricRow[];
    const pagination = body.pagination as { total_pages?: number } | undefined;
    const totalPages = Math.max(1, Math.floor(Number(pagination?.total_pages ?? 1)));
    return { rows, totalPages };
  }

  const { rows: firstRows, totalPages } = await fetchPage(1);
  if (totalPages <= 1) return firstRows;

  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(i + 2).then((r) => r.rows))
  );
  return [...firstRows, ...rest.flat()];
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveGPUCapacity(_opts: { timeframe?: string }): Promise<DashboardGPUCapacity> {
  return cachedFetch('facade:gpu-capacity', TTL.GPU_CAPACITY * 1000, async () => {
    const rows = await fetchAllGPURows();

    // Track unique GPU IDs (with sessions) → total and model breakdown
    const gpuToModel = new Map<string, string>(); // gpu_id → gpu_model_name
    const pipelineGpus = new Map<string, Set<string>>(); // pipeline_id → Set<gpu_id>

    for (const row of rows) {
      const sessions = row.known_sessions_count ?? 0;
      if (sessions <= 0 || !row.gpu_id) continue;

      if (!gpuToModel.has(row.gpu_id)) {
        gpuToModel.set(row.gpu_id, row.gpu_model_name ?? 'Unknown GPU');
      }

      if (row.pipeline_id) {
        if (!pipelineGpus.has(row.pipeline_id)) pipelineGpus.set(row.pipeline_id, new Set());
        pipelineGpus.get(row.pipeline_id)!.add(row.gpu_id);
      }
    }

    // GPU model counts
    const modelCounts = new Map<string, number>();
    for (const model of gpuToModel.values()) {
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    }

    const totalGPUs = gpuToModel.size;

    const models = [...modelCounts.entries()]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count);

    const pipelineGPUEntries = [...pipelineGpus.entries()]
      .map(([name, gpuSet]) => ({ name, gpus: gpuSet.size }))
      .sort((a, b) => b.gpus - a.gpus);

    return {
      totalGPUs,
      activeGPUs: totalGPUs,
      availableCapacity: totalGPUs > 0 ? 1.0 : 0,
      models,
      pipelineGPUs: pipelineGPUEntries,
    };
  });
}
