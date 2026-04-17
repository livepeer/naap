/**
 * Shared raw model rows — OpenAPI GET /v1/streaming/models + GET /v1/requests/models,
 * merged into NetworkModel[] for catalog and pricing fallback.
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

export function getRawNetModels(): Promise<NetworkModel[]> {
  const revalidateSec = Math.floor(TTL.NET_MODELS / 1000);
  return cachedFetch('facade:raw:streaming+requests-models', TTL.NET_MODELS, async () => {
    const [stream, req] = await Promise.all([
      naapGet<StreamingModelRow[]>('streaming/models', undefined, {
        next: { revalidate: revalidateSec },
        errorLabel: 'streaming-models',
      }).catch(() => [] as StreamingModelRow[]),
      naapGet<RequestsModelRow[]>('requests/models', undefined, {
        next: { revalidate: revalidateSec },
        errorLabel: 'requests-models',
      }).catch(() => [] as RequestsModelRow[]),
    ]);
    return mergeModels(stream, req);
  });
}

export async function warmNetworkData(): Promise<{ models: number }> {
  const models = await getRawNetModels();
  return { models: models.length };
}
