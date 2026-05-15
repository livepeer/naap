/**
 * Orchestrator Leaderboard API Route Tests
 *
 * Integration tests for the rank and filters endpoints with
 * mocked Prisma DB responses and auth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gateway/authorize', () => ({
  authorize: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    leaderboardDatasetRow: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/orchestrator-leaderboard/global-dataset', () => ({
  getRowsForCapability: vi.fn(),
  getDatasetCapabilities: vi.fn(),
}));

import { authorize } from '@/lib/gateway/authorize';
import { getRowsForCapability, getDatasetCapabilities } from '@/lib/orchestrator-leaderboard/global-dataset';

const FIXTURE_ROWS = [
  { orch_uri: 'https://orch-1.test', gpu_name: 'RTX 4090', gpu_gb: 24, avail: 3, total_cap: 4, price_per_unit: 100, best_lat_ms: 50, avg_lat_ms: 80, swap_ratio: 0.05, avg_avail: 3.2 },
  { orch_uri: 'https://orch-2.test', gpu_name: 'A100', gpu_gb: 80, avail: 1, total_cap: 2, price_per_unit: 500, best_lat_ms: 200, avg_lat_ms: 350, swap_ratio: 0.3, avg_avail: 1.5 },
  { orch_uri: 'https://orch-3.test', gpu_name: 'RTX 3090', gpu_gb: 24, avail: 2, total_cap: 2, price_per_unit: 80, best_lat_ms: null, avg_lat_ms: null, swap_ratio: null, avg_avail: 2.0 },
];

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

    (authorize as any).mockResolvedValue({
      teamId: 'test-team',
      callerType: 'jwt',
      callerId: 'user-1',
    });

    (getRowsForCapability as any).mockResolvedValue(FIXTURE_ROWS);
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

  it('returns empty data when DB has no rows for capability', async () => {
    (getRowsForCapability as any).mockResolvedValue([]);

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

    (getDatasetCapabilities as any).mockResolvedValue(['glm-4.7-flash', 'streamdiffusion-sdxl']);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FIXTURE_FILTERS_RESPONSE),
    });
  });

  it('returns merged capabilities from DB and ClickHouse', async () => {
    const { GET } = await import('@/app/api/v1/orchestrator-leaderboard/filters/route');
    const req = createGetRequest() as any;
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.capabilities).toContain('glm-4.7-flash');
    expect(json.data.capabilities).toContain('streamdiffusion-sdxl');
    expect(json.data.capabilities).toContain('noop');
  });

  it('returns DB capabilities when ClickHouse is unavailable', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('error'),
    });

    const { GET } = await import('@/app/api/v1/orchestrator-leaderboard/filters/route');
    const req = createGetRequest() as any;
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.capabilities).toContain('glm-4.7-flash');
    expect(json.data.capabilities).toContain('streamdiffusion-sdxl');
    expect(json.data.sources.database).toBe(2);
    expect(json.data.sources.clickhouse).toBe(0);
  });
});
