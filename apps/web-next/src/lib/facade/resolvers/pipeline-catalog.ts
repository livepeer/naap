/**
 * Pipeline catalog resolver — NAAP API backed.
 *
 * Groups model rows by Pipeline into catalog entries.
 *
 * Known limitations (Phase 1):
 *   - regions: [] — not available in /v1/net/models
 *
 * Source:
 *   facade/network-data → GET /v1/net/models?limit=200
 */

import type { DashboardPipelineCatalogEntry } from '@naap/plugin-sdk';
import { PIPELINE_DISPLAY } from '@/lib/dashboard/pipeline-config';
import { cachedFetch, TTL } from '../cache.js';
import { getRawNetModels } from '../network-data.js';

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolvePipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  return cachedFetch('facade:pipeline-catalog', TTL.PIPELINE_CATALOG * 1000, async () => {
    const rows = await getRawNetModels();

    // Group by pipeline, collecting unique model names
    const byPipeline = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.Pipeline === '' || PIPELINE_DISPLAY[row.Pipeline] === null) continue;
      if (!byPipeline.has(row.Pipeline)) byPipeline.set(row.Pipeline, new Set());
      byPipeline.get(row.Pipeline)!.add(row.Model);
    }

    return Array.from(byPipeline.entries()).map(([pipeline, modelSet]): DashboardPipelineCatalogEntry => ({
      id: pipeline,
      name: PIPELINE_DISPLAY[pipeline] ?? pipeline,
      models: Array.from(modelSet),
      regions: [], // not available in /v1/net/models
    }));
  });
}
