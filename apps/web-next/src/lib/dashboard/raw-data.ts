/**
 * Server-side raw data types for the dashboard BFF.
 *
 * The `/v1/pipelines` REST catalog endpoint has been removed as a data source.
 * Pipeline catalog data is now sourced entirely from:
 *   1. `dashboard/pipeline-catalog` (source of truth)
 *   2. `net/models` (model enrichment)
 *   3. `perf-by-model` (model IDs from recent performance data)
 */

export interface PipelineCatalogEntry {
  id: string;
  models: string[];
  regions: string[];
}
