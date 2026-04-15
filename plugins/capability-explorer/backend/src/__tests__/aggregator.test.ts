import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterCapabilities } from '../aggregator.js';
import { clearCache } from '../cache.js';
import type { EnrichedCapability, ListCapabilitiesParams } from '../types.js';

function makeCap(overrides: Partial<EnrichedCapability>): EnrichedCapability {
  return {
    id: 'test',
    name: 'Test',
    category: 't2i',
    source: 'livepeer-network',
    version: '1.0',
    description: '',
    modelSourceUrl: '',
    thumbnail: null,
    license: null,
    tags: [],
    gpuCount: 2,
    totalCapacity: 10,
    orchestratorCount: 3,
    avgLatencyMs: 100,
    bestLatencyMs: 50,
    avgFps: null,
    meanPriceUsd: 0.01,
    minPriceUsd: 0.005,
    maxPriceUsd: 0.02,
    priceUnit: 'pixel',
    sdkSnippet: { curl: '', python: '', javascript: '' },
    models: [],
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe('filterCapabilities', () => {
  beforeEach(() => clearCache());

  const caps: EnrichedCapability[] = [
    makeCap({ id: 'text-to-image', name: 'Text to Image', category: 't2i', gpuCount: 5, meanPriceUsd: 0.01, totalCapacity: 20 }),
    makeCap({ id: 'llm', name: 'LLM', category: 'llm', gpuCount: 10, meanPriceUsd: 0.005, totalCapacity: 50 }),
    makeCap({ id: 'image-to-video', name: 'Image to Video', category: 'i2v', gpuCount: 2, meanPriceUsd: 0.05, totalCapacity: 5 }),
  ];

  it('returns all when no filters', () => {
    const result = filterCapabilities(caps, { limit: 50, offset: 0 });
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
  });

  it('filters by category', () => {
    const result = filterCapabilities(caps, { category: 'llm', limit: 50, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe('llm');
  });

  it('filters by search', () => {
    const result = filterCapabilities(caps, { search: 'image', limit: 50, offset: 0 });
    expect(result.total).toBe(2);
  });

  it('filters by minGpuCount', () => {
    const result = filterCapabilities(caps, { minGpuCount: 5, limit: 50, offset: 0 });
    expect(result.total).toBe(2);
  });

  it('filters by maxPriceUsd', () => {
    const result = filterCapabilities(caps, { maxPriceUsd: 0.01, limit: 50, offset: 0 });
    expect(result.total).toBe(2);
  });

  it('sorts by gpuCount descending', () => {
    const result = filterCapabilities(caps, { sortBy: 'gpuCount', sortOrder: 'desc', limit: 50, offset: 0 });
    expect(result.items[0].id).toBe('llm');
    expect(result.items[2].id).toBe('image-to-video');
  });

  it('paginates with offset and limit', () => {
    const result = filterCapabilities(caps, { limit: 1, offset: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  it('hasMore is false when at end', () => {
    const result = filterCapabilities(caps, { limit: 50, offset: 0 });
    expect(result.hasMore).toBe(false);
  });
});
