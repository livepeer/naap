/**
 * Pricing resolver — NAAP API backed.
 *
 * Returns one entry per Pipeline+Model from the shared net/models cache.
 * Each entry represents the avg price for that specific model.
 *
 * Price conversion: raw value is in Wei per pixel-equivalent unit.
 * We normalize to a human-readable scale: price = WeiPerUnit / 1e12
 *
 * Source:
 *   facade/network-data → GET /v1/net/models?limit=200
 */

import type { DashboardPipelinePricing } from '@naap/plugin-sdk';
import { PIPELINE_DISPLAY } from '@/lib/dashboard/pipeline-config';
import { cachedFetch, TTL } from '../cache.js';
import { getRawNetModels } from '../network-data.js';

// ---------------------------------------------------------------------------
// Pipeline unit metadata (for non-pixel pipelines)
// ---------------------------------------------------------------------------

const PIPELINE_UNIT: Record<string, string> = {
  'llm': 'token',
  'audio-to-text': 'second',
  'text-to-speech': 'second',
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolvePricing(): Promise<DashboardPipelinePricing[]> {
  return cachedFetch('facade:pricing:v2', TTL.PRICING * 1000, async () => {
    const rows = await getRawNetModels();

    return rows
      .filter((row) => row.Pipeline && PIPELINE_DISPLAY[row.Pipeline] !== null && row.Model)
      .filter((row) => row.PriceAvgWeiPerPixel > 0)
      .map((row): DashboardPipelinePricing => {
        const avgWei = row.PriceAvgWeiPerPixel;
        const unit = PIPELINE_UNIT[row.Pipeline] ?? 'pixel';
        const price = avgWei / 1e12;

        // outputPerDollar: approximate at a fixed ETH reference price of $3000
        // 1 USD = (1/3000) ETH = 1e18/3000 Wei → unitsPerDollar = 1e18/(3000*avgWei)
        let outputPerDollar = '';
        if (avgWei > 0) {
          const unitsPerDollar = 1e18 / (3000 * avgWei);
          if (unitsPerDollar >= 1e9) {
            outputPerDollar = `~${(unitsPerDollar / 1e9).toFixed(0)}B ${unit}s`;
          } else if (unitsPerDollar >= 1e6) {
            outputPerDollar = `~${(unitsPerDollar / 1e6).toFixed(0)}M ${unit}s`;
          } else if (unitsPerDollar >= 1e3) {
            outputPerDollar = `~${(unitsPerDollar / 1e3).toFixed(0)}K ${unit}s`;
          } else {
            outputPerDollar = `~${unitsPerDollar.toFixed(0)} ${unit}s`;
          }
        }

        return {
          pipeline: row.Pipeline,
          model: row.Model,
          unit,
          price,
          pixelsPerUnit: unit === 'pixel' ? 1 : null,
          outputPerDollar,
          capacity: row.TotalCapacity,
        };
      })
      .sort((a, b) => b.price - a.price);
  });
}
