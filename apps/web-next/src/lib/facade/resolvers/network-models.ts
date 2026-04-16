/**
 * Network models resolver — NAAP API backed.
 *
 * Combines /v1/streaming/models (live-video pipeline models with capacity + FPS)
 * and /v1/requests/models (AI Batch + BYOC models with job stats) into a unified
 * NetworkModel[] for the developer/network-models page.
 *
 * Source:
 *   GET /v1/streaming/models
 *   GET /v1/requests/models
 */

import type { NetworkModel, StreamingModel, RequestsModel } from '../types.js';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

/** Per-orchestrator pricing row from /v1/dashboard/pricing. */
interface ApiPricingRow {
  pipeline: string;
  model: string;
  priceWeiPerUnit: number;
}

/** Aggregated min/max/avg pricing for a (pipeline, model) pair. */
interface PricingSummary {
  min: number;
  max: number;
  avg: number;
}

/** Fetch pricing rows and aggregate min/max/avg per (pipeline:model). */
async function fetchPricingByKey(): Promise<Map<string, PricingSummary>> {
  const rows = await naapGet<ApiPricingRow[]>('dashboard/pricing', undefined, {
    cache: 'no-store',
    errorLabel: 'pricing-for-network-models',
  });

  const accum = new Map<string, number[]>();
  for (const r of rows) {
    if (!Number.isFinite(r.priceWeiPerUnit) || r.priceWeiPerUnit <= 0) continue;
    const key = `${r.pipeline}:${r.model}`;
    let prices = accum.get(key);
    if (!prices) {
      prices = [];
      accum.set(key, prices);
    }
    prices.push(r.priceWeiPerUnit);
  }

  const result = new Map<string, PricingSummary>();
  for (const [key, prices] of accum) {
    result.set(key, {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: prices.reduce((s, v) => s + v, 0) / prices.length,
    });
  }
  return result;
}

function toNetworkModel(
  pipeline: string,
  model: string,
  warmOrchCount: number,
  totalCapacity: number,
  pricing: PricingSummary | undefined,
): NetworkModel {
  return {
    Pipeline: pipeline,
    Model: model,
    WarmOrchCount: warmOrchCount,
    TotalCapacity: totalCapacity,
    PriceMinWeiPerPixel: pricing?.min ?? 0,
    PriceMaxWeiPerPixel: pricing?.max ?? 0,
    PriceAvgWeiPerPixel: pricing?.avg ?? 0,
  };
}

async function fetchAllNetworkModels(): Promise<NetworkModel[]> {
  const [streamingModels, requestsModels, pricingByKey] = await Promise.all([
    naapGet<StreamingModel[]>('streaming/models', undefined, {
      cache: 'no-store',
      errorLabel: 'streaming-models',
    }).catch((err) => {
      console.warn('[facade/network-models] streaming/models fetch failed:', err);
      return [] as StreamingModel[];
    }),
    naapGet<RequestsModel[]>('requests/models', undefined, {
      cache: 'no-store',
      errorLabel: 'requests-models',
    }).catch((err) => {
      console.warn('[facade/network-models] requests/models fetch failed:', err);
      return [] as RequestsModel[];
    }),
    fetchPricingByKey().catch((err) => {
      console.warn('[facade/network-models] pricing fetch failed:', err);
      return new Map<string, PricingSummary>();
    }),
  ]);

  const seen = new Set<string>();
  const result: NetworkModel[] = [];

  for (const row of streamingModels) {
    const key = `${row.pipeline}:${row.model}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(toNetworkModel(row.pipeline, row.model, row.warm_orch_count, row.gpu_slots, pricingByKey.get(key)));
    }
  }

  for (const row of requestsModels) {
    const key = `${row.pipeline}:${row.model}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(toNetworkModel(row.pipeline, row.model, row.warm_orch_count, row.gpu_slots, pricingByKey.get(key)));
    }
  }

  return result;
}

export async function resolveNetworkModels(opts: {
  limit?: number;
}): Promise<{ models: NetworkModel[]; total: number }> {
  const rows = await cachedFetch('facade:network-models', TTL.NETWORK_MODELS, fetchAllNetworkModels);
  const total = rows.length;
  if (opts.limit === undefined) {
    return { models: rows, total };
  }
  const safeLimit = Math.max(0, Math.floor(opts.limit));
  return { models: rows.slice(0, safeLimit), total };
}
