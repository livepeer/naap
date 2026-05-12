import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueries = new Map<string, Record<string, unknown>>();

vi.mock('@naap/database', () => {
  const mockPrisma = {
    capabilityQuery: {
      create: vi.fn().mockImplementation(({ data }) => {
        const id = `cq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const now = new Date();
        const row = { id, ...data, createdAt: now, updatedAt: now };
        mockQueries.set(id, row);
        return Promise.resolve(row);
      }),
      findMany: vi.fn().mockImplementation(({ where }) => {
        const results = Array.from(mockQueries.values()).filter((q) => {
          if (where?.ownerUserId && q.ownerUserId !== where.ownerUserId) return false;
          return true;
        });
        return Promise.resolve(results);
      }),
      findFirst: vi.fn().mockImplementation(({ where }) => {
        if (where?.id) {
          return Promise.resolve(mockQueries.get(where.id) || null);
        }
        return Promise.resolve(null);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const existing = mockQueries.get(where.id);
        if (!existing) return Promise.resolve(null);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        mockQueries.set(where.id, updated);
        return Promise.resolve(updated);
      }),
      delete: vi.fn().mockImplementation(({ where }) => {
        const existed = mockQueries.has(where.id);
        mockQueries.delete(where.id);
        return Promise.resolve(existed ? { id: where.id } : null);
      }),
    },
    capabilityMergedView: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'singleton',
        capabilities: [
          { id: 'text-to-image', name: 'Text to Image', category: 't2i', gpuCount: 10, totalCapacity: 40, orchestratorCount: 5, meanPriceUsd: 0.003, minPriceUsd: 0.001, maxPriceUsd: 0.005, avgLatencyMs: 300, description: 'Image gen', models: [], tags: ['t2i'], source: 'livepeer', version: '1.0', modelSourceUrl: '', thumbnail: null, license: null, avgFps: null, priceUnit: 'pixel', sdkSnippet: { curl: '', python: '', javascript: '' }, lastUpdated: new Date().toISOString() },
          { id: 'llm', name: 'LLM', category: 'llm', gpuCount: 6, totalCapacity: 24, orchestratorCount: 4, meanPriceUsd: 0.0001, minPriceUsd: 0.00005, maxPriceUsd: 0.0002, avgLatencyMs: 100, description: 'Chat', models: [], tags: ['llm'], source: 'livepeer', version: '1.0', modelSourceUrl: '', thumbnail: null, license: null, avgFps: null, priceUnit: 'token', sdkSnippet: { curl: '', python: '', javascript: '' }, lastUpdated: new Date().toISOString() },
          { id: 'image-to-video', name: 'Image to Video', category: 'i2v', gpuCount: 3, totalCapacity: 10, orchestratorCount: 2, meanPriceUsd: 0.015, minPriceUsd: 0.01, maxPriceUsd: 0.02, avgLatencyMs: 2000, description: 'Video gen', models: [], tags: ['i2v'], source: 'livepeer', version: '1.0', modelSourceUrl: '', thumbnail: null, license: null, avgFps: null, priceUnit: 'pixel', sdkSnippet: { curl: '', python: '', javascript: '' }, lastUpdated: new Date().toISOString() },
        ],
        stats: null,
        categories: null,
        mergedAt: new Date(),
        sourceIds: ['seed'],
        updatedAt: new Date(),
      }),
    },
  };
  return { prisma: mockPrisma };
});

import { createQuery, listQueries, getQuery, updateQuery, deleteQuery, evaluateQuery } from '../queries.js';
import { clearCache } from '../cache.js';

describe('queries CRUD', () => {
  beforeEach(() => {
    mockQueries.clear();
    clearCache();
    vi.clearAllMocks();
  });

  const scope = { ownerUserId: 'user-123', teamId: 'personal:user-123' };

  it('creates a query', async () => {
    const q = await createQuery({
      name: 'Test Query',
      slug: 'test-query',
      category: 't2i',
      limit: 20,
    }, scope);

    expect(q.name).toBe('Test Query');
    expect(q.slug).toBe('test-query');
    expect(q.category).toBe('t2i');
    expect(q.limit).toBe(20);
    expect(q.ownerUserId).toBe('user-123');
  });

  it('lists queries for scope', async () => {
    await createQuery({ name: 'Q1', slug: 'q1', limit: 10 }, scope);
    await createQuery({ name: 'Q2', slug: 'q2', limit: 10 }, scope);
    const queries = await listQueries(scope);
    expect(queries.length).toBeGreaterThanOrEqual(2);
  });

  it('gets a query by id', async () => {
    const created = await createQuery({ name: 'GetMe', slug: 'get-me', limit: 10 }, scope);
    const found = await getQuery(created.id, scope);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('GetMe');
  });

  it('returns null for nonexistent query', async () => {
    const found = await getQuery('nonexistent', scope);
    expect(found).toBeNull();
  });

  it('updates a query', async () => {
    const created = await createQuery({ name: 'Original', slug: 'orig', limit: 10 }, scope);
    const updated = await updateQuery(created.id, { name: 'Updated' }, scope);
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated');
  });

  it('deletes a query', async () => {
    const created = await createQuery({ name: 'ToDelete', slug: 'del', limit: 10 }, scope);
    const deleted = await deleteQuery(created.id, scope);
    expect(deleted).toBe(true);
  });

  it('returns false deleting nonexistent query', async () => {
    const deleted = await deleteQuery('nonexistent', scope);
    expect(deleted).toBe(false);
  });
});

describe('query evaluation', () => {
  beforeEach(() => {
    mockQueries.clear();
    clearCache();
    vi.clearAllMocks();
  });

  it('evaluates a query with category filter', async () => {
    const q = await createQuery({
      name: 'T2I Only',
      slug: 't2i-only',
      category: 't2i',
      limit: 50,
    }, { ownerUserId: 'user-1' });

    const record = await getQuery(q.id, { ownerUserId: 'user-1' });
    expect(record).not.toBeNull();
    const results = await evaluateQuery(record!);

    expect(results.total).toBe(1);
    expect(results.items[0].category).toBe('t2i');
  });

  it('evaluates a query with no filters returns all', async () => {
    const q = await createQuery({
      name: 'All',
      slug: 'all',
      limit: 50,
    }, { ownerUserId: 'user-1' });

    const record = await getQuery(q.id, { ownerUserId: 'user-1' });
    const results = await evaluateQuery(record!);

    expect(results.total).toBe(3);
  });

  it('evaluates a query with sortBy', async () => {
    const q = await createQuery({
      name: 'By GPU',
      slug: 'by-gpu',
      sortBy: 'gpuCount',
      sortOrder: 'desc',
      limit: 50,
    }, { ownerUserId: 'user-1' });

    const record = await getQuery(q.id, { ownerUserId: 'user-1' });
    const results = await evaluateQuery(record!);

    expect(results.items[0].gpuCount).toBeGreaterThanOrEqual(results.items[1].gpuCount);
  });
});

