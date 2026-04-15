import type { CapabilityDataSource, SourceContext, SourceResult, PartialCapability } from './interface.js';
import type { ClickHouseCapabilitySummary, CapabilityCategory, EnrichedModel } from '../types.js';
import { PIPELINE_TO_CATEGORY } from '../types.js';
import { buildCapabilitySummarySQL, fetchFromClickHouse } from '../query.js';
import { generateSnippets } from '../snippets.js';
import { getHuggingFaceUrl } from '../hf-model-map.js';

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

/** Convert wei-per-pixel to USD per minute of 1024×1024 video at 30 fps (1.8 B pixels). */
function weiPerPixelToUsdPerMin(weiPerPixel: number, ethPriceUsd: number): number {
  const PIXELS_PER_MIN = 1024 * 1024 * 30 * 60; // ~1.8 B
  return (weiPerPixel / WEI_PER_ETH) * ethPriceUsd * PIXELS_PER_MIN;
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
      const [rows, ethPriceUsd] = await Promise.all([
        fetchFromClickHouse<ClickHouseCapabilitySummary>(buildCapabilitySummarySQL(), ctx),
        fetchEthPriceUsd(),
      ]);

      const capabilities: PartialCapability[] = rows.map((row) => {
        const pipelineType = String(row.pipeline_type || '');
        const category = categorize(pipelineType);
        const primaryModelId = row.capability_name;

        const gpuCount = Number(row.gpus) || 0;
        const orchCount = Number(row.orchestrators) || 0;
        const totalSlots = Number(row.total_slots) || 0;
        const freeSlots = Number(row.free_slots) || 0;

        const avgPriceWei = row.mean_price_per_pixel_wei != null ? Number(row.mean_price_per_pixel_wei) : null;
        const minPriceWei = row.min_price_per_pixel_wei != null ? Number(row.min_price_per_pixel_wei) : null;
        const maxPriceWei = row.max_price_per_pixel_wei != null ? Number(row.max_price_per_pixel_wei) : null;

        const avgPriceUsd = avgPriceWei != null ? weiPerPixelToUsdPerMin(avgPriceWei, ethPriceUsd) : null;
        const minPriceUsd = minPriceWei != null ? weiPerPixelToUsdPerMin(minPriceWei, ethPriceUsd) : null;
        const maxPriceUsd = maxPriceWei != null ? weiPerPixelToUsdPerMin(maxPriceWei, ethPriceUsd) : null;

        const avgLatencyMs = row.avg_latency_ms != null ? Number(row.avg_latency_ms) : null;

        const model: EnrichedModel = {
          modelId: primaryModelId,
          name: humanName(primaryModelId),
          warm: true,
          huggingFaceUrl: getHuggingFaceUrl(primaryModelId),
          description: null,
          avgFps: null,
          gpuCount,
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
            gpuCount,
            totalCapacity: freeSlots > 0 ? freeSlots : totalSlots,
            orchestratorCount: orchCount,
            avgLatencyMs,
            bestLatencyMs: null,
            avgFps: null,
            meanPriceUsd: avgPriceUsd,
            minPriceUsd,
            maxPriceUsd,
            priceUnit: category === 'llm' ? 'USD/1M tokens' : 'USD/min',
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
