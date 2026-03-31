/**
 * Pipeline catalog resolver — NAAP API backed.
 *
 * Fetches GET /v1/net/models and groups rows by Pipeline into catalog entries.
 *
 * Known limitations (Phase 1):
 *   - regions: [] — not available in /v1/net/models
 *
 * Source:
 *   GET /v1/net/models?limit=200 → model rows grouped by pipeline
 */

import type { DashboardPipelineCatalogEntry } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { PIPELINE_DISPLAY } from '@/lib/dashboard/pipeline-config';
import { cachedFetch, TTL } from '../cache.js';

// ---------------------------------------------------------------------------
// Raw NAAP API types
// ---------------------------------------------------------------------------

interface NaapNetModelRow {
  Pipeline: string;
  Model: string;
  WarmOrchCount: number;
  TotalCapacity: number;
  PriceMinWeiPerPixel: number;
  PriceMaxWeiPerPixel: number;
  PriceAvgWeiPerPixel: number;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function naapGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/pipeline-catalog] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolvePipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  return cachedFetch('facade:pipeline-catalog', TTL.PIPELINE_CATALOG * 1000, async () => {
    const rows = await naapGet<NaapNetModelRow[]>('net/models', { limit: '200' });

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
