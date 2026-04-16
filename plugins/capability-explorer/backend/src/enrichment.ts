import type { HFModelCard, EnrichedCapability, HandlerContext } from './types.js';
import { getCached, setCached } from './cache.js';
import { resolveHuggingFaceModelId, getHuggingFaceUrl } from './hf-model-map.js';

const HF_CACHE_TTL_MS = 3_600_000; // 1 hour
const HF_GW_PATH = '/api/v1/gw/huggingface/models';

function resolveHuggingFaceGatewayUrl(requestUrl?: string): string {
  const origin =
    (requestUrl ? new URL(requestUrl).origin : undefined) ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    'http://localhost:3000';
  return new URL(HF_GW_PATH, origin).toString();
}

export async function fetchModelCard(
  modelId: string,
  ctx: HandlerContext,
): Promise<HFModelCard | null> {
  const hfModelId = resolveHuggingFaceModelId(modelId);
  if (!hfModelId) return null;

  const cacheKey = `hf:model:${hfModelId}`;
  const cached = getCached<HFModelCard>(cacheKey);
  if (cached) return cached;

  try {
    const baseUrl = resolveHuggingFaceGatewayUrl(ctx.requestUrl);
    const encodedId = encodeURIComponent(hfModelId);
    const url = `${baseUrl}/${encodedId}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${ctx.authToken}`,
    };
    if (ctx.cookieHeader) {
      headers['cookie'] = ctx.cookieHeader;
    }

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const card = (await res.json()) as HFModelCard;
    setCached(cacheKey, card, HF_CACHE_TTL_MS);
    return card;
  } catch {
    return null;
  }
}

export async function enrichWithHuggingFace(
  capabilities: EnrichedCapability[],
  ctx: HandlerContext,
): Promise<EnrichedCapability[]> {
  const enrichmentPromises = capabilities.map(async (cap) => {
    const primaryModel = cap.models[0];
    if (!primaryModel) return cap;

    const card = await fetchModelCard(primaryModel.modelId, ctx);
    if (!card) return cap;

    return {
      ...cap,
      description: cap.description || card.description || '',
      thumbnail: cap.thumbnail || card.cardData?.thumbnail || null,
      license: cap.license || card.cardData?.license || null,
      tags: [...new Set([...cap.tags, ...(card.tags || [])])],
      modelSourceUrl: cap.modelSourceUrl || getHuggingFaceUrl(primaryModel.modelId),
      models: cap.models.map((m) => ({
        ...m,
        huggingFaceUrl: m.huggingFaceUrl || getHuggingFaceUrl(m.modelId),
      })),
    };
  });

  const results = await Promise.allSettled(enrichmentPromises);
  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : capabilities[i],
  );
}
