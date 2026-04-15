import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchModelCard, enrichWithHuggingFace } from '../enrichment.js';
import { clearCache } from '../cache.js';
import type { EnrichedCapability, HandlerContext } from '../types.js';

const mockCtx: HandlerContext = {
  authToken: 'test-token',
  requestUrl: 'http://localhost:3000/api/test',
};

describe('enrichment', () => {
  beforeEach(() => {
    clearCache();
    vi.restoreAllMocks();
  });

  it('returns null for empty model IDs', async () => {
    const card = await fetchModelCard('noop', mockCtx);
    expect(card).toBeNull();
  });

  it('returns null when HuggingFace API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );
    const card = await fetchModelCard('stabilityai/sd-turbo', mockCtx);
    expect(card).toBeNull();
  });

  it('returns model card on success', async () => {
    const mockCard = {
      _id: 'test',
      modelId: 'stabilityai/sd-turbo',
      author: 'stabilityai',
      sha: 'abc',
      lastModified: '2024-01-01',
      tags: ['text-to-image'],
      pipeline_tag: 'text-to-image',
      library_name: 'diffusers',
      downloads: 1000,
      likes: 100,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockCard), { status: 200 }),
    );

    const card = await fetchModelCard('stabilityai/sd-turbo', mockCtx);
    expect(card).toBeTruthy();
    expect(card?.modelId).toBe('stabilityai/sd-turbo');
  });

  it('enrichWithHuggingFace preserves capabilities on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    const caps: EnrichedCapability[] = [
      {
        id: 'test',
        name: 'Test',
        category: 't2i',
        source: 'livepeer-network',
        version: '1.0',
        description: 'original',
        modelSourceUrl: '',
        thumbnail: null,
        license: null,
        tags: [],
        gpuCount: 1,
        totalCapacity: 1,
        orchestratorCount: 1,
        avgLatencyMs: null,
        bestLatencyMs: null,
        avgFps: null,
        meanPriceUsd: null,
        minPriceUsd: null,
        maxPriceUsd: null,
        priceUnit: 'pixel',
        sdkSnippet: { curl: '', python: '', javascript: '' },
        models: [{ modelId: 'test-model', name: 'Test', warm: true, huggingFaceUrl: null, description: null, avgFps: null, gpuCount: 1, meanPriceUsd: null }],
        lastUpdated: new Date().toISOString(),
      },
    ];

    const result = await enrichWithHuggingFace(caps, mockCtx);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('original');
  });
});
