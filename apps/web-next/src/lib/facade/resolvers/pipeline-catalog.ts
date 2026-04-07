/**
 * Pipeline catalog resolver — `dashboard/pipeline-catalog` is the source of truth.
 *
 * 1. **Source of truth:** `GET /v1/dashboard/pipeline-catalog`. Only pipeline IDs
 *    returned by this endpoint (or explicitly listed in PIPELINE_DISPLAY) are
 *    allowed into the final catalog. Fallback sources may only enrich (add
 *    models/regions) to entries already present — they cannot introduce new IDs.
 *
 * 2. **Model enrichment:** `GET /v1/net/models` adds models to existing entries
 *    (warmed on startup via `instrumentation.ts → warmNetworkData()`).
 *
 * 3. **Perf augment:** `perf/by-model` (24h range) supplies additional model ids
 *    for entries already in the valid set.
 *
 * 4. **Display seed (stubs only):** If {@link FACADE_USE_STUBS} is set and the
 *    union still collapses to a single pipeline, merge empty shells for every id
 *    in {@link PIPELINE_DISPLAY}. Disabled in production to avoid injecting
 *    placeholder rows when upstream data is temporarily incomplete.
 */

import type { DashboardPipelineCatalogEntry } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { getRawNetModels } from '../network-data.js';
import { cachedFetch, TTL } from '../cache.js';
import { resolvePerfByModel } from './perf-by-model.js';

import { PIPELINE_DISPLAY } from '@/lib/dashboard/pipeline-config';
import { LIVE_VIDEO_PIPELINE_ID } from '@/lib/dashboard/pipeline-config';

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
    const displayName = PIPELINE_DISPLAY[pipelineId];
    if (displayName == null) continue;

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
    if (PIPELINE_DISPLAY[pipelineKey] == null) continue;

    const displayName = PIPELINE_DISPLAY[pipelineKey] ?? pipelineKey;

    let slot = byPipeline.get(pipelineKey);
    if (!slot) {
      slot = { name: displayName, models: new Set() };
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

/** Empty shells for known pipeline ids — last resort when upstream merges to one row. */
function catalogSeedFromDisplay(): DashboardPipelineCatalogEntry[] {
  return Object.entries(PIPELINE_DISPLAY)
    .filter((row): row is [string, string] => row[1] !== null)
    .map(([id, name]) => ({
      id,
      name,
      models: [],
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
      getRawNetModels(),
      fetchWarmCatalog(),
      resolvePerfByModel({ start: start.toISOString(), end: end.toISOString() }).catch((err) => {
        console.warn('[facade/pipeline-catalog] perf-by-model augment skipped:', err);
        return {};
      }),
    ]);

    const validIds: ReadonlySet<string> = warmCatalog.length > 0
      ? new Set(warmCatalog.map((e) => e.id))
      : new Set(Object.keys(PIPELINE_DISPLAY).filter((id) => PIPELINE_DISPLAY[id] != null));

    if (warmCatalog.length > 0) {
      console.log(`[facade/pipeline-catalog] valid set: ${validIds.size} IDs from dashboard/pipeline-catalog`);
    } else {
      console.log(`[facade/pipeline-catalog] warm catalog empty — falling back to PIPELINE_DISPLAY allowlist (${validIds.size} IDs)`);
    }

    const filteredNetModels = netModels.filter((r) => validIds.has(r.Pipeline?.trim() ?? ''));
    const base = buildStableCatalog(filteredNetModels, warmCatalog);

    const fromPerfByModel = catalogFromPerfByModel(fpsByPipelineModel)
      .filter((e) => validIds.has(e.id));

    let merged = unionCatalogEntries(base, fromPerfByModel);

    if (process.env.FACADE_USE_STUBS === 'true') {
      const catalogLooksIncomplete =
        merged.length <= 1
        || (merged.length > 0 && merged.every((e) => e.id === LIVE_VIDEO_PIPELINE_ID));
      if (catalogLooksIncomplete) {
        merged = unionCatalogEntries(merged, catalogSeedFromDisplay());
      }
    }

    return merged;
  });
}
