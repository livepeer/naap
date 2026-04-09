/**
 * Pricing resolver — NAAP Dashboard API backed.
 *
 * Fetches GET /v1/dashboard/pricing (raw wei-per-unit pricing across active
 * orchestrators) and converts to human-readable DashboardPipelinePricing[].
 *
 * When dashboard/pricing omits rows (or lags), merges in GET /v1/net/models
 * rows that carry PriceAvgWeiPerPixel so the overview table matches Developer
 * API → Network Models pricing.
 *
 * Price conversion: price = priceAvgWeiPerUnit / 1e12
 * outputPerDollar: uses ETH_USD_PRICE (USD per ETH) or defaults to 3000
 *
 * Source:
 *   GET /v1/dashboard/pricing
 *   GET /v1/net/models (fallback rows only)
 */

import type { DashboardPipelinePricing, NetworkModel } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { getRawNetModels } from '../network-data.js';
import { resolveNetCapacity } from './net-capacity.js';
import { naapGet } from '../naap-get.js';

const LIVE_VIDEO_PIPELINE = 'live-video-to-video';

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

function parseEthUsdReference(): number {
  const raw = process.env.ETH_USD_PRICE?.trim();
  if (!raw) return 3000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 3000;
  return n;
}

function computeOutputPerDollar(avgWei: number, unit: string, ethUsd: number): string {
  if (avgWei <= 0 || !Number.isFinite(ethUsd) || ethUsd <= 0) return '';
  const unitsPerDollar = 1e18 / (ethUsd * avgWei);
  if (unitsPerDollar >= 1e9) return `~${(unitsPerDollar / 1e9).toFixed(0)}B ${unit}s`;
  if (unitsPerDollar >= 1e6) return `~${(unitsPerDollar / 1e6).toFixed(0)}M ${unit}s`;
  if (unitsPerDollar >= 1e3) return `~${(unitsPerDollar / 1e3).toFixed(0)}K ${unit}s`;
  return `~${unitsPerDollar.toFixed(0)} ${unit}s`;
}

function pricingKey(pipeline: string, model: string): string {
  return `${pipeline}:${model}`;
}

function fromApiPipelinePricing(
  r: ApiPipelinePricing,
  netCapacity: Record<string, number>,
  ethUsd: number,
): DashboardPipelinePricing {
  const unit = PIPELINE_UNIT[r.pipeline] ?? 'pixel';
  const price = r.priceAvgWeiPerUnit / 1e12;
  const netKey = pricingKey(r.pipeline, r.model);
  const capacity =
    r.pipeline === LIVE_VIDEO_PIPELINE
      ? (r.orchCount > 0 ? r.orchCount : (netCapacity[netKey] ?? r.orchCount))
      : (netCapacity[netKey] ?? r.orchCount);
  return {
    pipeline: r.pipeline,
    model: r.model,
    unit,
    price,
    avgWeiPerUnit: String(Math.round(r.priceAvgWeiPerUnit)),
    pixelsPerUnit: r.pixelsPerUnit > 0 ? r.pixelsPerUnit : null,
    outputPerDollar: computeOutputPerDollar(r.priceAvgWeiPerUnit, unit, ethUsd),
    capacity,
  };
}

function fromNetModelRow(
  nm: NetworkModel,
  netCapacity: Record<string, number>,
  ethUsd: number,
): DashboardPipelinePricing | null {
  const pipeline = nm.Pipeline?.trim() ?? '';
  const model = nm.Model?.trim() ?? '';
  if (!pipeline || !model) return null;
  const avgWei = nm.PriceAvgWeiPerPixel;
  if (!Number.isFinite(avgWei) || avgWei <= 0) return null;

  const unit = PIPELINE_UNIT[pipeline] ?? 'pixel';
  const netKey = pricingKey(pipeline, model);
  const orchLike =
    nm.WarmOrchCount > 0 ? nm.WarmOrchCount : nm.TotalCapacity;
  const capacity =
    pipeline === LIVE_VIDEO_PIPELINE
      ? (nm.WarmOrchCount > 0 ? nm.WarmOrchCount : (netCapacity[netKey] ?? orchLike))
      : (netCapacity[netKey] ?? nm.TotalCapacity ?? nm.WarmOrchCount);

  return {
    pipeline,
    model,
    unit,
    price: avgWei / 1e12,
    avgWeiPerUnit: String(Math.round(avgWei)),
    pixelsPerUnit: null,
    outputPerDollar: computeOutputPerDollar(avgWei, unit, ethUsd),
    capacity,
  };
}

export async function resolvePricing(): Promise<DashboardPipelinePricing[]> {
  return cachedFetch('facade:pricing', TTL.PRICING, async () => {
    const ethUsd = parseEthUsdReference();
    const [rows, netCapacity, netModels] = await Promise.all([
      naapGet<ApiPipelinePricing[]>('dashboard/pricing', undefined, {
        cache: 'no-store',
        errorLabel: 'pricing',
      }),
      resolveNetCapacity().catch((err) => {
        console.warn('[facade/pricing] net/capacity merge skipped:', err);
        return {} as Record<string, number>;
      }),
      getRawNetModels().catch((err) => {
        console.warn('[facade/pricing] net/models pricing merge skipped:', err);
        return [] as NetworkModel[];
      }),
    ]);

    const byKey = new Map<string, DashboardPipelinePricing>();

    for (const r of rows) {
      if (!Number.isFinite(r.priceAvgWeiPerUnit) || r.priceAvgWeiPerUnit <= 0) continue;
      const row = fromApiPipelinePricing(r, netCapacity, ethUsd);
      byKey.set(pricingKey(row.pipeline, row.model ?? ''), row);
    }

    for (const nm of netModels) {
      const row = fromNetModelRow(nm, netCapacity, ethUsd);
      if (!row) continue;
      const key = pricingKey(row.pipeline, row.model ?? '');
      if (byKey.has(key)) continue;
      byKey.set(key, row);
    }

    return [...byKey.values()].sort((a, b) => b.price - a.price);
  });
}
