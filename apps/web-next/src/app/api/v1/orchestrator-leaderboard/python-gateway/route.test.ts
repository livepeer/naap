import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gateway/authorize', () => ({
  authorize: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/query', () => ({
  fetchLeaderboard: vi.fn(),
}));

import { authorize } from '@/lib/gateway/authorize';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';

describe('GET /api/v1/orchestrator-leaderboard/python-gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
      authenticated: true,
      teamId: 'personal:user-1',
      callerType: 'apiKey',
      callerId: 'user-1',
    });
    (fetchLeaderboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        { orch_uri: 'https://orch-a.test', gpu_name: 'x', gpu_gb: 1, avail: 1, total_cap: 1, price_per_unit: 1, best_lat_ms: null, avg_lat_ms: null, swap_ratio: null, avg_avail: null },
        { orch_uri: 'https://orch-a.test', gpu_name: 'x', gpu_gb: 1, avail: 1, total_cap: 1, price_per_unit: 1, best_lat_ms: null, avg_lat_ms: null, swap_ratio: null, avg_avail: null },
        { orch_uri: 'https://orch-b.test', gpu_name: 'x', gpu_gb: 1, avail: 1, total_cap: 1, price_per_unit: 1, best_lat_ms: null, avg_lat_ms: null, swap_ratio: null, avg_avail: null },
      ],
      fromCache: true,
      cachedAt: Date.now(),
    });
  });

  it('uses the model suffix from python-gateway caps and returns a bare address array', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest(
      'http://localhost/api/v1/orchestrator-leaderboard/python-gateway?caps=live-video-to-video/streamdiffusion-sdxl&topN=2',
      { headers: { Authorization: 'Bearer gw_test' } },
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(fetchLeaderboard).toHaveBeenCalledWith(
      'streamdiffusion-sdxl',
      'gw_test',
      req.url,
      null,
    );
    expect(await res.json()).toEqual([
      { address: 'https://orch-a.test' },
      { address: 'https://orch-b.test' },
    ]);
  });

  it('falls back to noop when no caps are supplied', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/v1/orchestrator-leaderboard/python-gateway', {
      headers: { Authorization: 'Bearer gw_test' },
    });

    await GET(req);

    expect(fetchLeaderboard).toHaveBeenCalledWith('noop', 'gw_test', req.url, null);
  });

  it('returns 401 when unauthenticated', async () => {
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/v1/orchestrator-leaderboard/python-gateway');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
