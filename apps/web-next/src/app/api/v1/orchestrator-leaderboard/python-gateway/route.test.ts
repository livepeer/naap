import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gateway/authorize', () => ({
  authorize: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/query', () => ({
  fetchLeaderboard: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/discovery-order', () => ({
  tieredShuffleDiscoveryAddresses: (addresses: string[]) => [...addresses],
}));

vi.mock('@/lib/orchestrator-leaderboard/provider-restrictions', () => ({
  isCapabilityAllowedForProvider: vi.fn().mockReturnValue(true),
  normalizeBillingProviderSlug: vi.fn((slug?: string | null) => slug?.trim().toLowerCase() || null),
}));

vi.mock('@/lib/orchestrator-leaderboard/storyboard-default-plan', () => ({
  STORYBOARD_DEFAULT_PLAN_ID: 'storyboard-default',
  isStoryboardDefaultDiscoveryEnabled: vi.fn().mockReturnValue(false),
  resolveAllCanaryStaticOrchestrators: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/orchestrator-leaderboard/storyboard-default-discovery', () => ({
  buildStoryboardDefaultDiscovery: vi.fn(),
}));

vi.mock('@/lib/pymthouse-manifest', () => ({
  DISCOVERY_RESPONSE_CACHE_CONTROL: 'no-store',
  ensurePymthouseManifestFresh: vi.fn(),
}));

import { authorize } from '@/lib/gateway/authorize';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import { isCapabilityAllowedForProvider } from '@/lib/orchestrator-leaderboard/provider-restrictions';
import { isStoryboardDefaultDiscoveryEnabled } from '@/lib/orchestrator-leaderboard/storyboard-default-plan';
import { buildStoryboardDefaultDiscovery } from '@/lib/orchestrator-leaderboard/storyboard-default-discovery';

describe('GET /api/v1/orchestrator-leaderboard/python-gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isCapabilityAllowedForProvider as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (isStoryboardDefaultDiscoveryEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (buildStoryboardDefaultDiscovery as ReturnType<typeof vi.fn>).mockResolvedValue({
      addresses: ['https://orch-a.test'],
      byKind: { scope: ['https://orch-a.test'], byoc: [], tool: [] },
      meta: { staticFleetInjected: 0, fromCache: true, cacheAgeMs: 0 },
    });
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

  it('skips disallowed capabilities when billing provider restrictions deny them', async () => {
    (isCapabilityAllowedForProvider as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { GET } = await import('./route');
    const req = new NextRequest(
      'http://localhost/api/v1/orchestrator-leaderboard/python-gateway?caps=live-video-to-video/streamdiffusion-sdxl&billingProvider=pymthouse',
      { headers: { Authorization: 'Bearer gw_test' } },
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(fetchLeaderboard).not.toHaveBeenCalled();
    expect(await res.json()).toEqual([]);
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

  it('delegates to storyboard-default discovery when plan=storyboard-default and the flag is enabled', async () => {
    (isStoryboardDefaultDiscoveryEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const { GET } = await import('./route');
    const req = new NextRequest(
      'http://localhost/api/v1/orchestrator-leaderboard/python-gateway?plan=storyboard-default&billingProvider=pymthouse',
      { headers: { Authorization: 'Bearer gw_test' } },
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(buildStoryboardDefaultDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        billingProviderSlug: 'pymthouse',
        fetchCapabilityAddresses: expect.any(Function),
      }),
    );
    // Delegation path does not run the per-capability leaderboard loop directly.
    expect(fetchLeaderboard).not.toHaveBeenCalled();
    expect(await res.json()).toEqual([{ address: 'https://orch-a.test' }]);
  });

  it('sets the X-Discovery-Mode: storyboard-default header on the delegated response', async () => {
    (isStoryboardDefaultDiscoveryEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const { GET } = await import('./route');
    const req = new NextRequest(
      'http://localhost/api/v1/orchestrator-leaderboard/python-gateway?plan=storyboard-default',
      { headers: { Authorization: 'Bearer gw_test' } },
    );

    const res = await GET(req);

    expect(res.headers.get('X-Discovery-Mode')).toBe('storyboard-default');
  });

  it('falls through to per-capability behavior when the storyboard-default flag is disabled', async () => {
    (isStoryboardDefaultDiscoveryEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { GET } = await import('./route');
    const req = new NextRequest(
      'http://localhost/api/v1/orchestrator-leaderboard/python-gateway?plan=storyboard-default&caps=live-video-to-video/streamdiffusion-sdxl',
      { headers: { Authorization: 'Bearer gw_test' } },
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(buildStoryboardDefaultDiscovery).not.toHaveBeenCalled();
    expect(fetchLeaderboard).toHaveBeenCalledWith(
      'streamdiffusion-sdxl',
      'gw_test',
      req.url,
      null,
    );
    expect(res.headers.get('X-Discovery-Mode')).not.toBe('storyboard-default');
  });
});
