/**
 * Orchestrator Leaderboard API Route Tests
 *
 * Integration tests for the rank and filters endpoints with
 * mocked gateway/ClickHouse responses and auth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gateway/authorize', () => ({
  authorize: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {},
}));

import { authorize } from '@/lib/gateway/authorize';
import { clearCache } from '@/lib/orchestrator-leaderboard/cache';

const FIXTURE_CH_RESPONSE = {
  success: true,
  data: {
    meta: [],
    data: [
      { orch_uri: 'https://orch-1.test', gpu_name: 'RTX 4090', gpu_gb: 24, avail: 3, total_cap: 4, price_per_unit: 100, best_lat_ms: 50, avg_lat_ms: 80, swap_ratio: 0.05, avg_avail: 3.2 },
      { orch_uri: 'https://orch-2.test', gpu_name: 'A100', gpu_gb: 80, avail: 1, total_cap: 2, price_per_unit: 500, best_lat_ms: 200, avg_lat_ms: 350, swap_ratio: 0.3, avg_avail: 1.5 },
      { orch_uri: 'https://orch-3.test', gpu_name: 'RTX 3090', gpu_gb: 24, avail: 2, total_cap: 2, price_per_unit: 80, best_lat_ms: null, avg_lat_ms: null, swap_ratio: null, avg_avail: 2.0 },
    ],
    rows: 3,
    statistics: { elapsed: 0.1, rows_read: 100, bytes_read: 5000 },
  },
};

const FIXTURE_FILTERS_RESPONSE = {
  success: true,
  data: {
    data: [
      { capability_name: 'noop' },
      { capability_name: 'streamdiffusion-sdxl' },
      { capability_name: 'streamdiffusion-sdxl-v2v' },
    ],
  },
};

function createRequest(body: object): Request {
  return new Request('http://localhost:3000/api/v1/orchestrator-leaderboard/rank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

function createGetRequest(): Request {
  return new Request('http://localhost:3000/api/v1/orchestrator-leaderboard/filters', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer test-jwt' },
  });
}

describe('POST /api/v1/orchestrator-leaderboard/rank', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearCache();

    (authorize as any).mockResolvedValue({
      teamId: 'test-team',
      callerType: 'jwt',
      callerId: 'user-1',
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FIXTURE_CH_RESPONSE),
      text: () => Promise.resolve(JSON.stringify(FIXTURE_CH_RESPONSE)),
    });
  });

  it('returns ranked orchestrators for valid request', async () => {
    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');
    const req = createRequest({ capability: 'streamdiffusion-sdxl', topN: 5 }) as any;
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(3);
    expect(json.data[0]).toHaveProperty('orchUri');
    expect(json.data[0]).toHaveProperty('gpuName');
    expect(json.data[0]).toHaveProperty('pricePerUnit');
  });

  it('returns 400 when capability is missing', async () => {
    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');
    const req = createRequest({ topN: 5 }) as any;
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid capability characters', async () => {
    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');
    const req = createRequest({ capability: "'; DROP TABLE --" }) as any;
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    (authorize as any).mockResolvedValue(null);
    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');
    const req = createRequest({ capability: 'noop' }) as any;
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('applies post-filters and reduces result count', async () => {
    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');
    const req = createRequest({
      capability: 'noop',
      topN: 10,
      filters: { gpuRamGbMin: 48 },
    }) as any;
    const res = await POST(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].gpuGb).toBe(80);
  });

  it('includes slaScore when slaWeights provided', async () => {
    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');
    const req = createRequest({
      capability: 'noop',
      slaWeights: { latency: 0.5, swapRate: 0.3, price: 0.2 },
    }) as any;
    const res = await POST(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.every((r: any) => typeof r.slaScore === 'number')).toBe(true);
  });

  it('returns 502 on gateway error', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve('upstream error'),
    });
    clearCache();

    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');
    const req = createRequest({ capability: 'noop' }) as any;
    const res = await POST(req);

    expect(res.status).toBe(502);
  });

  it('returns empty data when ClickHouse returns no rows', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { data: [], rows: 0, meta: [], statistics: {} } }),
    });
    clearCache();

    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');
    const req = createRequest({ capability: 'nonexistent' }) as any;
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(0);
  });

  it('sets cache headers on response', async () => {
    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');
    const req = createRequest({ capability: 'noop' }) as any;
    const res = await POST(req);

    expect(res.headers.get('Cache-Control')).toBe('private, max-age=10');
    expect(res.headers.get('X-Cache')).toBe('MISS');
    expect(res.headers.get('X-Cache-Age')).toBeDefined();
    expect(res.headers.get('X-Data-Freshness')).toBeDefined();
  });

  it('serves from cache on second call with X-Cache: HIT', async () => {
    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');

    const req1 = createRequest({ capability: 'cached-test' }) as any;
    const res1 = await POST(req1);
    expect(res1.headers.get('X-Cache')).toBe('MISS');

    const req2 = createRequest({ capability: 'cached-test' }) as any;
    const res2 = await POST(req2);
    expect(res2.headers.get('X-Cache')).toBe('HIT');
  });

  it('shares cache across different filter requests for same capability', async () => {
    const { POST } = await import('@/app/api/v1/orchestrator-leaderboard/rank/route');

    const req1 = createRequest({ capability: 'shared-test', topN: 5 }) as any;
    await POST(req1);

    const req2 = createRequest({ capability: 'shared-test', topN: 10, filters: { priceMax: 200 } }) as any;
    const res2 = await POST(req2);
    expect(res2.headers.get('X-Cache')).toBe('HIT');
  });
});

describe('GET /api/v1/orchestrator-leaderboard/filters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    (authorize as any).mockResolvedValue({
      teamId: 'test-team',
      callerType: 'jwt',
      callerId: 'user-1',
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FIXTURE_FILTERS_RESPONSE),
    });
  });

  it('returns list of capabilities', async () => {
    const { GET } = await import('@/app/api/v1/orchestrator-leaderboard/filters/route');
    const req = createGetRequest() as any;
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.capabilities).toEqual(['noop', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v']);
  });

  it('returns fallback capabilities on ClickHouse error', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('error'),
    });

    const { GET } = await import('@/app/api/v1/orchestrator-leaderboard/filters/route');
    const req = createGetRequest() as any;
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.fromFallback).toBe(true);
    expect(json.data.capabilities.length).toBeGreaterThan(0);
  });
});
