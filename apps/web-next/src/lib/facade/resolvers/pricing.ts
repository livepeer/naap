/**
 * Pricing resolver — NAAP Dashboard API backed.
 *
 * GET /v1/dashboard/pricing returns either legacy aggregated rows or OpenAPI v1
 * per-orchestrator rows (`orchAddress`, `priceWeiPerUnit`, …). Rows are merged
 * into DashboardPipelinePricing[] (one row per pipeline+model with aggregated
 * min/max/avg wei when multiple orchestrators quote the same capability).
 *
 * When dashboard/pricing omits rows, merges in merged streaming+requests model
 * rows that carry PriceAvgWeiPerPixel when non-zero (see network-data).
 */

import type { DashboardPipelinePricing, NetworkModel } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { getRawNetModels } from '../network-data.js';
import { resolveNetCapacity } from './net-capacity.js';
import { naapGet } from '../naap-get.js';

const LIVE_VIDEO_PIPELINE = 'live-video-to-video';

interface LegacyAggRow {
  pipeline: string;
  model: string;
  orchCount: number;
  priceMinWeiPerUnit: number;
  priceMaxWeiPerUnit: number;
  priceAvgWeiPerUnit: number;
  pixelsPerUnit: number;
}

interface PerOrchRow {
  orchAddress?: string;
  orchName?: string;
  pipeline: string;
  model: string;
  priceWeiPerUnit: number;
  pixelsPerUnit: number;
  isWarm?: boolean;
}

const PIPELINE_UNIT: Record<string, string> = {
  llm: 'token',
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
  return `${pipeline.trim()}:${model.trim()}`;
}

function isLegacyAgg(r: unknown): r is LegacyAggRow {
  return (
    typeof r === 'object' &&
    r !== null &&
    'priceAvgWeiPerUnit' in r &&
    typeof (r as LegacyAggRow).priceAvgWeiPerUnit === 'number'
  );
}

function isPerOrch(r: unknown): r is PerOrchRow {
  return (
    typeof r === 'object' &&
    r !== null &&
    'priceWeiPerUnit' in r &&
    typeof (r as PerOrchRow).priceWeiPerUnit === 'number' &&
    typeof (r as PerOrchRow).pipeline === 'string' &&
    typeof (r as PerOrchRow).model === 'string'
  );
}

function fromAggregatedRow(
  r: LegacyAggRow,
  netCapacity: Record<string, number>,
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
    outputPerDollar: '',
    capacity,
  };
}

function fromNetModelRow(
  nm: NetworkModel,
  netCapacity: Record<string, number>,
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
    outputPerDollar: '',
    capacity,
  };
}

interface PerPipelineModelAgg {
  pipeline: string;
  model: string;
  minWei: number;
  maxWei: number;
  sumWei: number;
  count: number;
  pixelsPerUnit: number;
  orchCount: number;
  warmOrchCount: number;
}

function aggregatePerOrchRows(rows: PerOrchRow[]): Map<string, PerPipelineModelAgg> {
  const map = new Map<string, PerPipelineModelAgg>();
  for (const r of rows) {
    if (!Number.isFinite(r.priceWeiPerUnit) || r.priceWeiPerUnit <= 0) continue;
    const pipeline = r.pipeline.trim();
    const model = r.model.trim();
    if (!pipeline || !model) continue;
    const key = pricingKey(pipeline, model);
    let slot = map.get(key);
    if (!slot) {
      slot = {
        pipeline,
        model,
        minWei: r.priceWeiPerUnit,
        maxWei: r.priceWeiPerUnit,
        sumWei: 0,
        count: 0,
        pixelsPerUnit: Number(r.pixelsPerUnit ?? 0),
        orchCount: 0,
        warmOrchCount: 0,
      };
      map.set(key, slot);
    }
    slot.minWei = Math.min(slot.minWei, r.priceWeiPerUnit);
    slot.maxWei = Math.max(slot.maxWei, r.priceWeiPerUnit);
    slot.sumWei += r.priceWeiPerUnit;
    slot.count += 1;
    slot.orchCount += 1;
    if (r.isWarm) {
      slot.warmOrchCount += 1;
    }
    if (r.pixelsPerUnit > 0 && slot.pixelsPerUnit <= 0) {
      slot.pixelsPerUnit = r.pixelsPerUnit;
    }
  }
  return map;
}

function fromPerOrchAggregate(
  agg: PerPipelineModelAgg,
  netCapacity: Record<string, number>,
): DashboardPipelinePricing {
  const avgWei = agg.sumWei / Math.max(1, agg.count);
  const unit = PIPELINE_UNIT[agg.pipeline] ?? 'pixel';
  const netKey = pricingKey(agg.pipeline, agg.model);
  const orchLike = agg.warmOrchCount > 0 ? agg.warmOrchCount : agg.orchCount;
  const capacity =
    agg.pipeline === LIVE_VIDEO_PIPELINE
      ? (orchLike > 0 ? orchLike : (netCapacity[netKey] ?? orchLike))
      : (netCapacity[netKey] ?? orchLike);

  return {
    pipeline: agg.pipeline,
    model: agg.model,
    unit,
    price: avgWei / 1e12,
    avgWeiPerUnit: String(Math.round(avgWei)),
    pixelsPerUnit: agg.pixelsPerUnit > 0 ? agg.pixelsPerUnit : null,
    outputPerDollar: '',
    capacity,
  };
}

function finalizePricingEthConversion(
  rows: DashboardPipelinePricing[],
  ethUsd: number,
): DashboardPipelinePricing[] {
  return rows.map((row) => {
    const avgWei = Number(row.avgWeiPerUnit);
    if (!Number.isFinite(avgWei) || avgWei <= 0) {
      return { ...row, outputPerDollar: '' };
    }
    return {
      ...row,
      outputPerDollar: computeOutputPerDollar(avgWei, row.unit, ethUsd),
    };
  });
}

export async function resolvePricing(): Promise<DashboardPipelinePricing[]> {
  const rows = await cachedFetch('facade:pricing', TTL.PRICING, async () => {
    const [rawRows, netCapacity, netModels] = await Promise.all([
      naapGet<unknown[]>('dashboard/pricing', undefined, {
        cache: 'no-store',
        errorLabel: 'pricing',
      }),
      resolveNetCapacity().catch((err) => {
        console.warn('[facade/pricing] net capacity merge skipped:', err);
        return {} as Record<string, number>;
      }),
      getRawNetModels().catch((err) => {
        console.warn('[facade/pricing] model registry pricing merge skipped:', err);
        return [] as NetworkModel[];
      }),
    ]);

    const byKey = new Map<string, DashboardPipelinePricing>();

    if (rawRows.length > 0 && isLegacyAgg(rawRows[0])) {
      for (const r of rawRows) {
        if (!isLegacyAgg(r)) continue;
        if (!Number.isFinite(r.priceAvgWeiPerUnit) || r.priceAvgWeiPerUnit <= 0) continue;
        const pipeline = typeof r.pipeline === 'string' ? r.pipeline.trim() : '';
        const model = typeof r.model === 'string' ? r.model.trim() : '';
        if (!pipeline || !model) continue;
        const row = fromAggregatedRow({ ...r, pipeline, model }, netCapacity);
        byKey.set(pricingKey(row.pipeline, row.model ?? ''), row);
      }
    } else {
      const perOrch: PerOrchRow[] = [];
      for (const r of rawRows) {
        if (isPerOrch(r)) perOrch.push(r);
      }
      const aggs = aggregatePerOrchRows(perOrch);
      for (const agg of aggs.values()) {
        const row = fromPerOrchAggregate(agg, netCapacity);
        byKey.set(pricingKey(row.pipeline, row.model ?? ''), row);
      }
    }

    for (const nm of netModels) {
      const row = fromNetModelRow(nm, netCapacity);
      if (!row) continue;
      const key = pricingKey(row.pipeline, row.model ?? '');
      if (byKey.has(key)) continue;
      byKey.set(key, row);
    }

    return [...byKey.values()].sort((a, b) => b.price - a.price);
  });

  const ethUsd = parseEthUsdReference();
  return finalizePricingEthConversion(rows, ethUsd);
}
