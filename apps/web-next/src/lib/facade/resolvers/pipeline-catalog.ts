/**
 * Pipeline catalog resolver — merged from several sources for cold-start stability.
 *
 * 1. **Stable baseline:** `GET /v1/net/models` (already warmed on startup via
 *    `instrumentation.ts → warmNetworkData()`). Intended to list every
 *    pipeline+model the network has registered.
 *
 * 2. **Warm overlay:** `GET /v1/dashboard/pipeline-catalog` (warm-orchestrator
 *    snapshot). Provides regions and may lag on cold start.
 *
 * 3. **REST catalog:** `GET /v1/pipelines` (see `getRawPipelineCatalog`).
 *    Retried on failure/empty so we do not rely solely on `net/models`, which can
 *    intermittently return only pipelines with current activity.
 *
 * 4. **Demand augment:** `network/demand` (24h cache) supplies pipeline/model
 *    ids seen in the lookback window when net/models is activity-only.
 *
 * 5. **Display seed:** If the union still collapses to a single pipeline, merge
 *    empty shells for every id in {@link PIPELINE_DISPLAY} so the Pipelines panel
 *    does not hide other capabilities until data arrives.
 */

import type { DashboardPipelineCatalogEntry } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import {
  getRawDemandRows,
  getRawPipelineCatalog,
  type NetworkDemandRow,
  type PipelineCatalogEntry,
} from '@/lib/dashboard/raw-data';
import { getRawNetModels } from '../network-data.js';
import { cachedFetch, TTL } from '../cache.js';

const WARM_CATALOG_REVALIDATE_SEC = Math.floor(TTL.PIPELINE_CATALOG / 1000);
import { PIPELINE_DISPLAY } from '@/lib/dashboard/pipeline-config';

const PIPELINES_RETRY_BACKOFF_MS = [0, 500, 1500] as const;

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

async function fetchPipelinesCatalogReliable(): Promise<PipelineCatalogEntry[]> {
  let lastErr: unknown;
  for (let i = 0; i < PIPELINES_RETRY_BACKOFF_MS.length; i++) {
    const delay = PIPELINES_RETRY_BACKOFF_MS[i];
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const rows = await getRawPipelineCatalog();
      if (rows.length > 0) {
        return rows;
      }
      lastErr = new Error('[facade/pipeline-catalog] /v1/pipelines returned empty catalog');
    } catch (err) {
      lastErr = err;
      console.warn(`[facade/pipeline-catalog] /v1/pipelines attempt ${i + 1} failed:`, err);
    }
  }
  console.warn(
    '[facade/pipeline-catalog] /v1/pipelines exhausted retries — continuing without REST catalog',
    lastErr,
  );
  return [];
}

/** Pipeline + model ids from demand rows (broader than activity-only net/models). */
function catalogFromDemandRows(rows: NetworkDemandRow[]): DashboardPipelineCatalogEntry[] {
  const byPipeline = new Map<string, { name: string; models: Set<string> }>();

  for (const row of rows) {
    const pipelineId = row.pipeline_id?.trim();
    if (!pipelineId) continue;
    if (PIPELINE_DISPLAY[pipelineId] === null) continue;

    const displayName = PIPELINE_DISPLAY[pipelineId] ?? pipelineId;
    const model = row.model_id?.trim() ?? '';

    let slot = byPipeline.get(pipelineId);
    if (!slot) {
      slot = { name: displayName, models: new Set() };
      byPipeline.set(pipelineId, slot);
    }
    if (model) {
      slot.models.add(model);
    }
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
    const [netModels, warmCatalog, rawPipelines, demandRows] = await Promise.all([
      getRawNetModels(),
      fetchWarmCatalog(),
      fetchPipelinesCatalogReliable(),
      getRawDemandRows().catch((err) => {
        console.warn('[facade/pipeline-catalog] demand augment skipped:', err);
        return [] as NetworkDemandRow[];
      }),
    ]);
    const base = buildStableCatalog(netModels, warmCatalog);
    const fromPipelinesEndpoint = pipelinesEndpointToDashboard(rawPipelines);
    const fromDemand = catalogFromDemandRows(demandRows);
    let merged = unionCatalogEntries(base, fromPipelinesEndpoint, fromDemand);

    if (merged.length <= 1) {
      merged = unionCatalogEntries(merged, catalogSeedFromDisplay());
    }

    return merged;
  });
}
