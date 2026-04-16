/**
 * Pipeline catalog resolver — NAAP Dashboard API backed.
 *
 * The endpoint returns the full pipeline + model catalog derived from
 * orchestrator capability announcements. No supplemental merging from
 * net/models or perf/by-model is needed.
 *
 * Source:
 *   GET /v1/dashboard/pipeline-catalog
 */

import type { DashboardPipelineCatalogEntry } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

export async function resolvePipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  return cachedFetch('facade:pipeline-catalog', TTL.PIPELINE_CATALOG, () =>
    naapGet<DashboardPipelineCatalogEntry[]>('dashboard/pipeline-catalog', undefined, {
      cache: 'no-store',
      errorLabel: 'pipeline-catalog',
    })
  );
}
