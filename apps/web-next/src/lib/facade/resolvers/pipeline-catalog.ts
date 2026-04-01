/**
 * Pipeline catalog resolver — NAAP Dashboard API backed.
 *
 * Single call to GET /v1/dashboard/pipeline-catalog which returns all
 * pipeline+model combinations offered by warm orchestrators, including regions.
 *
 * Source:
 *   GET /v1/dashboard/pipeline-catalog
 */

import type { DashboardPipelineCatalogEntry } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

async function naapGet<T>(path: string): Promise<T> {
  const res = await fetch(naapApiUpstreamUrl(path), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/pipeline-catalog] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function resolvePipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  return cachedFetch('facade:pipeline-catalog', TTL.PIPELINE_CATALOG * 1000, () =>
    naapGet<DashboardPipelineCatalogEntry[]>('dashboard/pipeline-catalog')
  );
}
