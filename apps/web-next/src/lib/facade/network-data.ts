/**
 * Shared raw model rows — OpenAPI GET /v1/streaming/models + GET /v1/requests/models,
 * merged into NetworkModel[] for catalog and pricing fallback. Per-model min/max/avg
 * pricing is merged in from GET /v1/dashboard/pricing (legacy pre-aggregated shape or
 * per-orchestrator quote rows), so consumers like Developer → Models get prices.
 */

import type { NetworkModel } from './types.js';
import { cachedFetch, TTL } from './cache.js';
import { naapGet } from './naap-get.js';

interface StreamingModelRow {
  pipeline?: string;
  model?: string;
  warm_orch_count?: number;
  gpu_slots?: number;
}

interface RequestsModelRow {
  pipeline?: string;
  model?: string;
  warm_orch_count?: number;
  gpu_slots?: number;
}

function toNetworkModel(
  pipeline: string,
  model: string,
  warm: number,
  slots: number,
): NetworkModel {
  return {
    Pipeline: pipeline,
    Model: model,
    WarmOrchCount: warm,
    TotalCapacity: slots,
    PriceMinWeiPerPixel: 0,
    PriceMaxWeiPerPixel: 0,
    PriceAvgWeiPerPixel: 0,
  };
}

function mergeModels(stream: StreamingModelRow[], req: RequestsModelRow[]): NetworkModel[] {
  const byKey = new Map<string, NetworkModel>();

  const add = (pipeline: string, model: string, warm: number, slots: number) => {
    const p = pipeline.trim();
    const m = model.trim();
    if (!p || !m) return;
    const key = `${p}:${m}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.WarmOrchCount += warm;
      existing.TotalCapacity += slots;
      return;
    }
    byKey.set(key, toNetworkModel(p, m, warm, slots));
  };

  for (const r of stream) {
    const pipeline = r.pipeline?.trim() ?? '';
    const model = r.model?.trim() ?? '';
    if (!pipeline || !model) continue;
    add(pipeline, model, Number(r.warm_orch_count ?? 0), Number(r.gpu_slots ?? 0));
  }
  for (const r of req) {
    const pipeline = r.pipeline?.trim() ?? '';
    const model = r.model?.trim() ?? '';
    if (!pipeline || !model) continue;
    add(pipeline, model, Number(r.warm_orch_count ?? 0), Number(r.gpu_slots ?? 0));
  }

  return [...byKey.values()].sort((a, b) => {
    const c = a.Pipeline.localeCompare(b.Pipeline);
    return c !== 0 ? c : a.Model.localeCompare(b.Model);
  });
}

interface PricingRow {
  pipeline?: string;
  model?: string;
  priceMinWeiPerUnit?: number;
  priceMaxWeiPerUnit?: number;
  priceAvgWeiPerUnit?: number;
  priceWeiPerUnit?: number;
}

function aggregatePricing(rows: PricingRow[]): Map<string, { min: number; max: number; avg: number }> {
  const out = new Map<string, { min: number; max: number; avg: number }>();
  const perOrch = new Map<string, { min: number; max: number; sum: number; count: number }>();
  for (const r of rows) {
    const pipeline = r.pipeline?.trim() ?? '';
    const model = r.model?.trim() ?? '';
    if (!pipeline || !model) continue;
    const key = `${pipeline}:${model}`;

    const legacyAvg = Number(r.priceAvgWeiPerUnit);
    if (Number.isFinite(legacyAvg) && legacyAvg > 0) {
      const min = Number(r.priceMinWeiPerUnit);
      const max = Number(r.priceMaxWeiPerUnit);
      out.set(key, {
        min: Number.isFinite(min) && min > 0 ? min : legacyAvg,
        max: Number.isFinite(max) && max > 0 ? max : legacyAvg,
        avg: legacyAvg,
      });
      continue;
    }

    const w = Number(r.priceWeiPerUnit);
    if (!Number.isFinite(w) || w <= 0) continue;
    const slot = perOrch.get(key);
    if (slot) {
      slot.min = Math.min(slot.min, w);
      slot.max = Math.max(slot.max, w);
      slot.sum += w;
      slot.count += 1;
    } else {
      perOrch.set(key, { min: w, max: w, sum: w, count: 1 });
    }
  }
  for (const [key, a] of perOrch) {
    if (out.has(key)) continue;
    out.set(key, { min: a.min, max: a.max, avg: a.sum / Math.max(1, a.count) });
  }
  return out;
}

export function getRawNetModels(): Promise<NetworkModel[]> {
  const revalidateSec = Math.floor(TTL.NET_MODELS / 1000);
  return cachedFetch('facade:raw:streaming+requests-models', TTL.NET_MODELS, async () => {
    const [stream, req, pricingRows] = await Promise.all([
      naapGet<StreamingModelRow[]>('streaming/models', undefined, {
        next: { revalidate: revalidateSec },
        errorLabel: 'streaming-models',
      }).catch(() => [] as StreamingModelRow[]),
      naapGet<RequestsModelRow[]>('requests/models', undefined, {
        next: { revalidate: revalidateSec },
        errorLabel: 'requests-models',
      }).catch(() => [] as RequestsModelRow[]),
      naapGet<PricingRow[]>('dashboard/pricing', undefined, {
        next: { revalidate: revalidateSec },
        errorLabel: 'dashboard-pricing',
      }).catch(() => [] as PricingRow[]),
    ]);
    const models = mergeModels(stream, req);
    const pricingByKey = aggregatePricing(pricingRows);
    for (const m of models) {
      const p = pricingByKey.get(`${m.Pipeline}:${m.Model}`);
      if (!p) continue;
      m.PriceMinWeiPerPixel = Math.round(p.min);
      m.PriceMaxWeiPerPixel = Math.round(p.max);
      m.PriceAvgWeiPerPixel = Math.round(p.avg);
    }
    return models;
  });
}

export async function warmNetworkData(): Promise<{ models: number }> {
  const models = await getRawNetModels();
  return { models: models.length };
}
