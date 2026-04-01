/**
 * Pricing resolver — NAAP Dashboard API backed.
 *
 * Fetches GET /v1/dashboard/pricing (raw wei-per-unit pricing across active
 * orchestrators) and converts to human-readable DashboardPipelinePricing[].
 *
 * Price conversion: price = priceAvgWeiPerUnit / 1e12
 * outputPerDollar: assumes ETH reference price of $3000
 *
 * Source:
 *   GET /v1/dashboard/pricing
 */

import type { DashboardPipelinePricing } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

interface ApiPipelinePricing {
  pipeline: string;
  model: string;
  orchCount: number;
  priceMinWeiPerUnit: number;
  priceMaxWeiPerUnit: number;
  priceAvgWeiPerUnit: number;
  pixelsPerUnit: number;
}

const PIPELINE_UNIT: Record<string, string> = {
  'llm': 'token',
  'audio-to-text': 'second',
  'text-to-speech': 'second',
};

function computeOutputPerDollar(avgWei: number, unit: string): string {
  if (avgWei <= 0) return '';
  const unitsPerDollar = 1e18 / (3000 * avgWei);
  if (unitsPerDollar >= 1e9) return `~${(unitsPerDollar / 1e9).toFixed(0)}B ${unit}s`;
  if (unitsPerDollar >= 1e6) return `~${(unitsPerDollar / 1e6).toFixed(0)}M ${unit}s`;
  if (unitsPerDollar >= 1e3) return `~${(unitsPerDollar / 1e3).toFixed(0)}K ${unit}s`;
  return `~${unitsPerDollar.toFixed(0)} ${unit}s`;
}

async function naapGet<T>(path: string): Promise<T> {
  const res = await fetch(naapApiUpstreamUrl(path), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/pricing] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function resolvePricing(): Promise<DashboardPipelinePricing[]> {
  return cachedFetch('facade:pricing', TTL.PRICING * 1000, async () => {
    const rows = await naapGet<ApiPipelinePricing[]>('dashboard/pricing');
    return rows
      .filter((r) => r.priceAvgWeiPerUnit > 0)
      .map((r): DashboardPipelinePricing => {
        const unit = PIPELINE_UNIT[r.pipeline] ?? 'pixel';
        const price = r.priceAvgWeiPerUnit / 1e12;
        return {
          pipeline: r.pipeline,
          model: r.model,
          unit,
          price,
          pixelsPerUnit: r.pixelsPerUnit > 0 ? r.pixelsPerUnit : null,
          outputPerDollar: computeOutputPerDollar(r.priceAvgWeiPerUnit, unit),
          capacity: r.orchCount,
        };
      })
      .sort((a, b) => b.price - a.price);
  });
}
