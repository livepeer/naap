/**
 * Pipeline catalog resolver — merged from three sources for cold-start stability.
 *
 * 1. **Stable baseline:** `GET /v1/net/models` (already warmed on startup via
 *    `instrumentation.ts → warmNetworkData()`). Intended to list every
 *    pipeline+model the network has registered.
 *
 * 2. **Warm overlay:** `GET /v1/dashboard/pipeline-catalog` (warm-orchestrator
 *    snapshot). Provides regions and may lag on cold start.
 *
 * 3. **REST catalog:** `GET /v1/pipelines` (see `getRawPipelineCatalog`).
 *    Merged because `net/models` can intermittently return only pipelines with
 *    current activity (e.g. just `live-video-to-video`) while the warm catalog
 *    fetch fails or is empty — which previously collapsed the Pipelines panel
 *    to a single section after refresh.
 */

import type { DashboardPipelineCatalogEntry } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { getRawPipelineCatalog, type PipelineCatalogEntry } from '@/lib/dashboard/raw-data';
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

/** Same visibility rules as `lib/dashboard` `resolvePipelineCatalog`. */
function pipelinesEndpointToDashboard(rows: PipelineCatalogEntry[]): DashboardPipelineCatalogEntry[] {
  return rows
    .filter((entry) => PIPELINE_DISPLAY[entry.id] !== null)
    .map((entry) => ({
      id: entry.id,
      name: PIPELINE_DISPLAY[entry.id] ?? entry.id,
      models: entry.models ?? [],
      regions: entry.regions ?? [],
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
    const [netModels, warmCatalog, rawPipelines] = await Promise.all([
      getRawNetModels(),
      fetchWarmCatalog(),
      getRawPipelineCatalog().catch((err) => {
        console.warn('[facade/pipeline-catalog] /v1/pipelines merge skipped:', err);
        return [] as PipelineCatalogEntry[];
      }),
    ]);
    const base = buildStableCatalog(netModels, warmCatalog);
    const fromPipelinesEndpoint = pipelinesEndpointToDashboard(rawPipelines);
    return unionCatalogEntries(base, fromPipelinesEndpoint);
  });
}
