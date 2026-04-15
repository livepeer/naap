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

function categorize(pipelineType: string): CapabilityCategory {
  return PIPELINE_TO_CATEGORY[pipelineType] || 'other';
}

const WEI_PER_ETH = 1e18;

async function fetchEthPriceUsd(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const json = await res.json() as { ethereum?: { usd?: number } };
    const price = json.ethereum?.usd;
    if (typeof price === 'number' && price > 0) return price;
    throw new Error('Unexpected CoinGecko shape');
  } catch {
    return 1800;
  }
}

function weiPerPixelToUsd(weiPerPixel: number, ethPriceUsd: number): number {
  return (weiPerPixel / WEI_PER_ETH) * ethPriceUsd * 1_000_000;
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
      const [summaryRows, latencyRows, ethPriceUsd] = await Promise.all([
        fetchFromClickHouse<ClickHouseCapabilitySummary>(buildCapabilitySummarySQL(), ctx),
        fetchFromClickHouse<LatencyRow>(buildLatencySQL(), ctx).catch(() => [] as LatencyRow[]),
        fetchEthPriceUsd(),
      ]);

      const latencyMap = new Map<string, LatencyRow>();
      for (const row of latencyRows) {
        latencyMap.set(row.capability_name, row);
      }

      const capabilities: PartialCapability[] = summaryRows.map((row) => {
        const pipelineType = String(row.pipeline_type || '');
        const category = categorize(pipelineType);
        const latency = latencyMap.get(row.capability_name);
        const primaryModelId = row.capability_name;

        const avgPriceWei = row.avg_price != null ? Number(row.avg_price) : null;
        const minPriceWei = row.min_price != null ? Number(row.min_price) : null;
        const maxPriceWei = row.max_price != null ? Number(row.max_price) : null;

        const avgPriceUsd = avgPriceWei != null ? weiPerPixelToUsd(avgPriceWei, ethPriceUsd) : null;
        const minPriceUsd = minPriceWei != null ? weiPerPixelToUsd(minPriceWei, ethPriceUsd) : null;
        const maxPriceUsd = maxPriceWei != null ? weiPerPixelToUsd(maxPriceWei, ethPriceUsd) : null;

        const model: EnrichedModel = {
          modelId: primaryModelId,
          name: humanName(primaryModelId),
          warm: true,
          huggingFaceUrl: getHuggingFaceUrl(primaryModelId),
          description: null,
          avgFps: null,
          gpuCount: Number(row.gpu_count) || 0,
          meanPriceUsd: avgPriceUsd,
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
            tags: [category, pipelineType, row.capability_name],
            gpuCount: Number(row.gpu_count) || 0,
            totalCapacity: Number(row.total_capacity) || 0,
            orchestratorCount: Number(row.orch_count) || 0,
            avgLatencyMs: latency?.avg_latency != null ? Number(latency.avg_latency) : null,
            bestLatencyMs: latency?.best_latency != null ? Number(latency.best_latency) : null,
            avgFps: null,
            meanPriceUsd: avgPriceUsd,
            minPriceUsd: minPriceUsd,
            maxPriceUsd: maxPriceUsd,
            priceUnit: category === 'llm' ? 'USD/1M tokens' : 'USD/1M pixels',
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
