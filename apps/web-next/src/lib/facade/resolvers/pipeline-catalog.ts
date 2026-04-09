/**
 * Pipeline catalog resolver — all pipelines from upstream sources are eligible.
 *
 * 1. **Model/region enrichment:** `GET /v1/dashboard/pipeline-catalog` supplies
 *    regions and canonical names. It enriches but never gates.
 *
 * 2. **Model discovery:** `GET /v1/net/models` contributes all pipeline/model
 *    pairs (warmed on startup via `instrumentation.ts → warmNetworkData()`).
 *
 * 3. **Perf augment:** `perf/by-model` (24h range) supplies additional model ids.
 */

import type { DashboardPipelineCatalogEntry } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import type { NetworkModel } from '../types.js';
import { getRawNetModels } from '../network-data.js';
import { cachedFetch, TTL } from '../cache.js';
import { resolvePerfByModel } from './perf-by-model.js';

async function fetchWarmCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  try {
    const res = await fetch(naapApiUpstreamUrl('dashboard/pipeline-catalog'), {
      cache: 'no-store',
    });
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

    const model = row.Model?.trim();
    if (!model) continue;

    let entry = merged.get(pipelineId);
    if (!entry) {
      const warm = warmByPipeline.get(pipelineId);
      entry = {
        models: new Set(warm?.models ?? []),
        regions: new Set(warm?.regions ?? []),
        name: warm?.name ?? pipelineId,
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

/** Pipeline + model ids from perf-by-model (`${pipeline}:${model}` => avgFps). */
function catalogFromPerfByModel(
  fpsByPipelineModel: Record<string, number>,
): DashboardPipelineCatalogEntry[] {
  const byPipeline = new Map<string, { name: string; models: Set<string> }>();

  for (const key of Object.keys(fpsByPipelineModel)) {
    const idx = key.indexOf(':');
    if (idx <= 0 || idx >= key.length - 1) continue;
    const pipelineKey = key.slice(0, idx).trim();
    const modelKey = key.slice(idx + 1).trim();
    if (!pipelineKey || !modelKey) continue;

    let slot = byPipeline.get(pipelineKey);
    if (!slot) {
      slot = { name: pipelineKey, models: new Set() };
      byPipeline.set(pipelineKey, slot);
    }
    slot.models.add(modelKey);
  }

  return [...byPipeline.entries()].map(([id, o]) => ({
    id,
    name: o.name,
    models: [...o.models],
    regions: [],
  }));
}

/** Union pipeline ids, merging model and region sets (order-stable). */
function unionCatalogEntries(...parts: DashboardPipelineCatalogEntry[][]): DashboardPipelineCatalogEntry[] {
  const map = new Map<string, { name: string; models: Set<string>; regions: Set<string> }>();

  for (const part of parts) {
    for (const e of part) {
      const cur = map.get(e.id);
      if (!cur) {
        map.set(e.id, {
          name: e.name,
          models: new Set(e.models),
          regions: new Set(e.regions),
        });
        continue;
      }
      for (const m of e.models) {
        cur.models.add(m);
      }
      for (const r of e.regions) {
        cur.regions.add(r);
      }
    }
  }

  return [...map.entries()]
    .map(([id, o]) => ({
      id,
      name: o.name,
      models: [...o.models].sort((a, b) => a.localeCompare(b)),
      regions: [...o.regions].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function resolvePipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  return cachedFetch('facade:pipeline-catalog', TTL.PIPELINE_CATALOG, async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const [netModels, warmCatalog, fpsByPipelineModel] = await Promise.all([
      getRawNetModels().catch((err) => {
        console.warn('[facade/pipeline-catalog] net/models augment skipped:', err);
        return [] as NetworkModel[];
      }),
      fetchWarmCatalog(),
      resolvePerfByModel({ start: start.toISOString(), end: end.toISOString() }).catch((err) => {
        console.warn('[facade/pipeline-catalog] perf-by-model augment skipped:', err);
        return {};
      }),
    ]);

    console.log(`[facade/pipeline-catalog] net/models: ${netModels.length} rows${warmCatalog.length > 0 ? `, warm catalog: ${warmCatalog.length} entries` : ', warm catalog empty'}`);

    const base = buildStableCatalog(netModels, warmCatalog);
    const fromPerfByModel = catalogFromPerfByModel(fpsByPipelineModel);

    return unionCatalogEntries(base, fromPerfByModel);
  });
}
