/**
 * Pricing resolver — NAAP Dashboard API backed.
 *
 * Fetches GET /v1/dashboard/pricing which returns per-orchestrator pricing rows
 * with orchAddress, orchName, pipeline, model, priceWeiPerUnit, pixelsPerUnit, isWarm.
 *
 * Aggregates into per (pipeline, model) summary rows with min/max/avg pricing
 * and orchestrator counts for the UI pricing table.
 *
 * Source:
 *   GET /v1/dashboard/pricing
 */

import type { DashboardPipelinePricing } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

interface ApiPricingRow {
  orchAddress: string;
  orchName: string;
  pipeline: string;
  model: string;
  priceWeiPerUnit: number;
  pixelsPerUnit: number;
  isWarm: boolean;
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

interface Accumulator {
  pipeline: string;
  model: string;
  prices: number[];
  pixelsPerUnit: number;
  warmCount: number;
  totalCount: number;
}

export async function resolvePricing(): Promise<DashboardPipelinePricing[]> {
  return cachedFetch('facade:pricing', TTL.PRICING, async () => {
    const ethUsd = parseEthUsdReference();
    const rows = await naapGet<ApiPricingRow[]>('dashboard/pricing', undefined, {
      cache: 'no-store',
      errorLabel: 'pricing',
    });

    // Aggregate per-orchestrator rows into per (pipeline, model) summaries
    const accByKey = new Map<string, Accumulator>();

    for (const r of rows) {
      if (!Number.isFinite(r.priceWeiPerUnit) || r.priceWeiPerUnit <= 0) continue;
      const key = pricingKey(r.pipeline, r.model);
      let acc = accByKey.get(key);
      if (!acc) {
        acc = {
          pipeline: r.pipeline,
          model: r.model,
          prices: [],
          pixelsPerUnit: r.pixelsPerUnit,
          warmCount: 0,
          totalCount: 0,
        };
        accByKey.set(key, acc);
      }
      acc.prices.push(r.priceWeiPerUnit);
      acc.totalCount++;
      if (r.isWarm) acc.warmCount++;
      if (r.pixelsPerUnit > 0) acc.pixelsPerUnit = r.pixelsPerUnit;
    }

    const results: DashboardPipelinePricing[] = [];

    for (const acc of accByKey.values()) {
      const avgWei = acc.prices.reduce((s, v) => s + v, 0) / acc.prices.length;
      const unit = PIPELINE_UNIT[acc.pipeline] ?? 'pixel';
      const price = avgWei / 1e12;

      results.push({
        pipeline: acc.pipeline,
        model: acc.model,
        unit,
        price,
        avgWeiPerUnit: String(Math.round(avgWei)),
        pixelsPerUnit: acc.pixelsPerUnit > 0 ? acc.pixelsPerUnit : null,
        outputPerDollar: computeOutputPerDollar(avgWei, unit, ethUsd),
        capacity: acc.warmCount > 0 ? acc.warmCount : acc.totalCount,
      });
    }

    return results.sort((a, b) => b.price - a.price);
  });
}
