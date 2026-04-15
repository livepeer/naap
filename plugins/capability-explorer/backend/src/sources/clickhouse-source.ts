import type { CapabilityDataSource, SourceContext, SourceResult, PartialCapability } from './interface.js';
import type { ClickHouseCapabilitySummary, CapabilityCategory, EnrichedModel } from '../types.js';
import { PIPELINE_TO_CATEGORY } from '../types.js';
import { buildCapabilitySummarySQL, buildLatencySQL, fetchFromClickHouse } from '../query.js';
import { generateSnippets } from '../snippets.js';
import { getHuggingFaceUrl } from '../hf-model-map.js';

interface LatencyRow {
  capability_name: string;
  avg_latency: number | null;
  best_latency: number | null;
}

function categorize(capabilityName: string): CapabilityCategory {
  return PIPELINE_TO_CATEGORY[capabilityName] || 'other';
}

function humanName(capabilityName: string): string {
  return capabilityName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export class ClickHouseSource implements CapabilityDataSource {
  readonly id = 'clickhouse';
  readonly name = 'ClickHouse Network Capabilities';
  readonly type = 'core' as const;

  async fetch(ctx: SourceContext): Promise<SourceResult> {
    const start = Date.now();
    try {
      const [summaryRows, latencyRows] = await Promise.all([
        fetchFromClickHouse<ClickHouseCapabilitySummary>(buildCapabilitySummarySQL(), ctx),
        fetchFromClickHouse<LatencyRow>(buildLatencySQL(), ctx).catch(() => [] as LatencyRow[]),
      ]);

      const latencyMap = new Map<string, LatencyRow>();
      for (const row of latencyRows) {
        latencyMap.set(row.capability_name, row);
      }

      const capabilities: PartialCapability[] = summaryRows.map((row) => {
        const category = categorize(row.capability_name);
        const latency = latencyMap.get(row.capability_name);
        const primaryModelId = row.capability_name;

        const model: EnrichedModel = {
          modelId: primaryModelId,
          name: humanName(primaryModelId),
          warm: true,
          huggingFaceUrl: getHuggingFaceUrl(primaryModelId),
          description: null,
          avgFps: null,
          gpuCount: row.gpu_count,
          meanPriceUsd: row.avg_price,
        };

        return {
          id: row.capability_name,
          fields: {
            id: row.capability_name,
            name: humanName(row.capability_name),
            category,
            source: 'livepeer-network',
            version: '1.0',
            description: '',
            modelSourceUrl: getHuggingFaceUrl(primaryModelId),
            thumbnail: null,
            license: null,
            tags: [category, row.capability_name],
            gpuCount: row.gpu_count,
            totalCapacity: row.total_capacity,
            orchestratorCount: row.orch_count,
            avgLatencyMs: latency?.avg_latency ?? null,
            bestLatencyMs: latency?.best_latency ?? null,
            avgFps: null,
            meanPriceUsd: row.avg_price,
            minPriceUsd: row.min_price,
            maxPriceUsd: row.max_price,
            priceUnit: category === 'llm' ? 'token' : 'pixel',
            sdkSnippet: generateSnippets(row.capability_name, category, primaryModelId),
            models: [model],
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      return {
        capabilities,
        status: 'success',
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        capabilities: [],
        status: 'error',
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : 'ClickHouse fetch failed',
      };
    }
  }
}
