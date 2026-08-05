import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/gateway/authorize', () => ({
  authorize: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/query', () => ({
  fetchLeaderboard: vi.fn(),
}));

vi.mock('@/lib/pymthouse-manifest', () => ({
  ensurePymthouseManifestFresh: vi.fn(async () => ({ revisionChanged: false })),
}));

vi.mock('@/lib/orchestrator-leaderboard/provider-restrictions', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/orchestrator-leaderboard/provider-restrictions')
  >('@/lib/orchestrator-leaderboard/provider-restrictions');
  return {
    ...actual,
    isCapabilityAllowedForProvider: vi.fn(() => true),
  };
});

vi.mock('@/lib/orchestrator-leaderboard/signer-bundle-config', async () => {
  const { SIGNER_BUNDLE_DEFAULTS } = await import(
    '@/lib/orchestrator-leaderboard/signer-bundle-defaults'
  );
  return {
    getSignerBundle: vi.fn(async (slug: keyof typeof SIGNER_BUNDLE_DEFAULTS) => {
      return SIGNER_BUNDLE_DEFAULTS[slug] ?? null;
    }),
  };
});

import { authorize } from '@/lib/gateway/authorize';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import { SIGNER_BUNDLE_DISCOVERY_FLAG } from '@/lib/orchestrator-leaderboard/signer-bundle-types';

const FLAG = SIGNER_BUNDLE_DISCOVERY_FLAG;

function makeRequest(slug: string, qs = '') {
  return new NextRequest(
    `http://localhost/api/v1/orchestrator-leaderboard/bundles/${slug}/python-gateway${qs}`,
    { headers: { Authorization: 'Bearer gw_test' } },
  );
}

function makeContext(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe('GET bundles/:slug/python-gateway', () => {
  const prev = process.env[FLAG];

  beforeEach(() => {
    vi.clearAllMocks();
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
      authenticated: true,
      teamId: 'personal:user-1',
      callerType: 'apiKey',
      callerId: 'user-1',
    });
    (fetchLeaderboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [],
      fromCache: true,
      cachedAt: Date.now(),
    });
  });

  afterEach(() => {
    if (prev === undefined) {
      delete process.env[FLAG];
    } else {
      process.env[FLAG] = prev;
    }
  });

  it('returns 404 when the flag is OFF (default)', async () => {
    delete process.env[FLAG];
    const { GET } = await import('./route');
    const res = await GET(makeRequest('daydream-byoc'), makeContext('daydream-byoc'));
    expect(res.status).toBe(404);
    expect(fetchLeaderboard).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown slug even when flag is ON', async () => {
    process.env[FLAG] = 'true';
    const { GET } = await import('./route');
    const res = await GET(makeRequest('unknown-bundle'), makeContext('unknown-bundle'));
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated with flag ON', async () => {
    process.env[FLAG] = 'true';
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { GET } = await import('./route');
    const res = await GET(makeRequest('daydream-byoc'), makeContext('daydream-byoc'));
    expect(res.status).toBe(401);
  });

  it('daydream-byoc returns BYOC+tool addresses with X-Discovery-Bundle header', async () => {
    process.env[FLAG] = 'true';
    const { GET } = await import('./route');
    const res = await GET(makeRequest('daydream-byoc'), makeContext('daydream-byoc'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Discovery-Bundle')).toBe('daydream-byoc');
    expect(res.headers.get('X-Discovery-Mode')).toBe('signer-bundle');

    const body = (await res.json()) as { address: string }[];
    const addresses = body.map((o) => o.address);
    expect(addresses).toContain('https://byoc-staging-1.daydream.monster:8935');
    expect(addresses).toContain('https://tool-staging-1.daydream.monster:8935');
    expect(addresses).not.toContain('https://liverunner-staging-1.daydream.monster:8935');
  });

  it('pymthouse-live-runner returns LR address and excludes BYOC hosts', async () => {
    process.env[FLAG] = 'true';
    const { GET } = await import('./route');
    const res = await GET(
      makeRequest('pymthouse-live-runner'),
      makeContext('pymthouse-live-runner'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Discovery-Bundle')).toBe('pymthouse-live-runner');

    const body = (await res.json()) as { address: string }[];
    const addresses = body.map((o) => o.address);
    expect(addresses).toContain('https://liverunner-staging-1.daydream.monster:8935');
    expect(addresses).not.toContain('https://byoc-staging-1.daydream.monster:8935');
    expect(addresses).not.toContain('https://tool-staging-1.daydream.monster:8935');
  });
});
