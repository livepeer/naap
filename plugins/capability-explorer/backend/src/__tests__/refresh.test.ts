import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@naap/database', () => {
  const mockPrisma = {
    capabilityExplorerConfig: {
      upsert: vi.fn().mockResolvedValue({
        id: 'default',
        refreshIntervalHours: 4,
        enabledSources: { clickhouse: true, huggingface: true },
        lastRefreshAt: null,
        lastRefreshStatus: null,
        updatedAt: new Date(),
      }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    capabilitySnapshot: {
      create: vi.fn().mockResolvedValue({}),
    },
    capabilityMergedView: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  return { prisma: mockPrisma };
});

vi.mock('../sources/index.js', () => {
  const mockCoreFetch = vi.fn().mockResolvedValue({
    capabilities: [
      {
        id: 'text-to-image',
        fields: {
          id: 'text-to-image',
          name: 'Text to Image',
          category: 't2i',
          source: 'livepeer-network',
          version: '1.0',
          gpuCount: 5,
          totalCapacity: 20,
          orchestratorCount: 3,
          meanPriceUsd: 0.003,
        },
      },
    ],
    status: 'success',
    durationMs: 150,
  });

  const mockEnrichFetch = vi.fn().mockResolvedValue({
    capabilities: [
      {
        id: 'text-to-image',
        fields: {
          description: 'Generate images from text',
          license: 'openrail++',
        },
      },
    ],
    status: 'success',
    durationMs: 200,
  });

  return {
    ensureDefaultSources: vi.fn(),
    getCoreSources: vi.fn().mockReturnValue([
      { id: 'clickhouse', name: 'ClickHouse', type: 'core', fetch: mockCoreFetch },
    ]),
    getEnrichmentSources: vi.fn().mockReturnValue([
      { id: 'huggingface', name: 'HuggingFace', type: 'enrichment', fetch: mockEnrichFetch },
    ]),
    HuggingFaceSource: class { setCapabilitiesToEnrich() {} },
  };
});

import { refreshCapabilities } from '../refresh.js';
import { prisma } from '@naap/database';

describe('refresh engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs enabled sources and merges results', async () => {
    const ctx = { authToken: 'test', requestUrl: 'http://localhost:3000' };
    const result = await refreshCapabilities(ctx);

    expect(result.refreshedAt).toBeDefined();
    expect(result.totalCapabilities).toBe(1);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].id).toBe('clickhouse');
    expect(result.sources[0].status).toBe('success');
    expect(result.sources[1].id).toBe('huggingface');
    expect(result.sources[1].status).toBe('success');
  });

  it('writes merged view to Postgres', async () => {
    const ctx = { authToken: 'test', requestUrl: 'http://localhost:3000' };
    await refreshCapabilities(ctx);

    expect(prisma.capabilityMergedView.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (prisma.capabilityMergedView.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsertCall.where.id).toBe('singleton');
  });

  it('creates snapshots per source', async () => {
    const ctx = { authToken: 'test', requestUrl: 'http://localhost:3000' };
    await refreshCapabilities(ctx);

    expect(prisma.capabilitySnapshot.create).toHaveBeenCalledTimes(2);
  });

  it('updates config with refresh status', async () => {
    const ctx = { authToken: 'test', requestUrl: 'http://localhost:3000' };
    await refreshCapabilities(ctx);

    expect(prisma.capabilityExplorerConfig.update).toHaveBeenCalledTimes(1);
    const updateCall = (prisma.capabilityExplorerConfig.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateCall.data.lastRefreshStatus).toBe('success');
  });

  it('merges enrichment fields onto core capabilities', async () => {
    const ctx = { authToken: 'test', requestUrl: 'http://localhost:3000' };
    const result = await refreshCapabilities(ctx);

    expect(result.totalCapabilities).toBe(1);
    const upsertCall = (prisma.capabilityMergedView.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const caps = upsertCall.update.capabilities as Array<Record<string, unknown>>;
    expect(caps[0].description).toBe('Generate images from text');
    expect(caps[0].license).toBe('openrail++');
    expect(caps[0].name).toBe('Text to Image');
  });
});
