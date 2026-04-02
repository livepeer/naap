/**
 * Pipeline catalog resolver — merged from two sources for cold-start stability.
 *
 * 1. **Stable baseline:** `GET /v1/net/models` (already warmed on startup via
 *    `instrumentation.ts → warmNetworkData()`). Contains every pipeline+model
 *    the network has registered, regardless of warm-orchestrator state.
 *
 * 2. **Warm overlay:** `GET /v1/dashboard/pipeline-catalog` (warm-orchestrator
 *    snapshot). Provides regions and may lag on cold start. Merged on top of
 *    the stable baseline so rows are never missing.
 *
 * The result is a union: every pipeline+model from net/models appears as a row,
 * enriched with regions from the warm catalog when available.
 */

import type { DashboardPipelineCatalogEntry } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { getRawNetModels } from '../network-data.js';
import { cachedFetch, TTL } from '../cache.js';

const WARM_CATALOG_REVALIDATE_SEC = Math.floor(TTL.PIPELINE_CATALOG / 1000);
import { PIPELINE_DISPLAY } from '@/lib/dashboard/pipeline-config';

async function fetchWarmCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  try {
    const res = await fetch(naapApiUpstreamUrl('dashboard/pipeline-catalog'), {
      next: { revalidate: WARM_CATALOG_REVALIDATE_SEC },
    } as RequestInit & { next: { revalidate: number } });
    if (!res.ok) {
      console.warn(`[facade/pipeline-catalog] warm catalog HTTP ${res.status} — using stable only`);
      return [];
    }
    return (await res.json()) as DashboardPipelineCatalogEntry[];
  } catch (err) {
    console.warn('[facade/pipeline-catalog] warm catalog fetch failed — using stable only:', err);
    return [];
  }
}

function buildStableCatalog(
  netModels: Array<{ Pipeline: string; Model: string }>,
  warmCatalog: DashboardPipelineCatalogEntry[],
): DashboardPipelineCatalogEntry[] {
  const warmByPipeline = new Map<string, DashboardPipelineCatalogEntry>();
  for (const entry of warmCatalog) {
    warmByPipeline.set(entry.id, entry);
  }

  const merged = new Map<string, { models: Set<string>; regions: Set<string>; name: string }>();

  for (const row of netModels) {
    const pipelineId = row.Pipeline?.trim();
    if (!pipelineId) continue;
    const displayName = PIPELINE_DISPLAY[pipelineId];
    if (displayName === null) continue;

    const model = row.Model?.trim();
    if (!model) continue;

    let entry = merged.get(pipelineId);
    if (!entry) {
      const warm = warmByPipeline.get(pipelineId);
      entry = {
        models: new Set(warm?.models ?? []),
        regions: new Set(warm?.regions ?? []),
        name: warm?.name ?? displayName ?? pipelineId,
      };
      merged.set(pipelineId, entry);
    }
    entry.models.add(model);
  }

  for (const warm of warmCatalog) {
    if (!merged.has(warm.id)) {
      merged.set(warm.id, {
        models: new Set(warm.models),
        regions: new Set(warm.regions),
        name: warm.name,
      });
    }
  }

  const stableCount = merged.size;
  const warmCount = warmCatalog.length;
  if (stableCount !== warmCount) {
    console.log(
      `[facade/pipeline-catalog] merged: ${stableCount} pipelines (stable) vs ${warmCount} (warm)`,
    );
  }

  return [...merged.entries()].map(([id, entry]) => ({
    id,
    name: entry.name,
    models: [...entry.models],
    regions: [...entry.regions],
  }));
}

export async function resolvePipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  return cachedFetch('facade:pipeline-catalog', TTL.PIPELINE_CATALOG, async () => {
    const [netModels, warmCatalog] = await Promise.all([
      getRawNetModels(),
      fetchWarmCatalog(),
    ]);
    return buildStableCatalog(netModels, warmCatalog);
  });
}
