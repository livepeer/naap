import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/gateway/authorize', () => ({
  authorize: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/query', () => ({
  fetchLeaderboard: vi.fn(),
}));

import { authorize } from '@/lib/gateway/authorize';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import {
  STORYBOARD_CANARY_ORCHESTRATOR_ENV,
  STORYBOARD_DEFAULT_DISCOVERY_FLAG,
} from '@/lib/orchestrator-leaderboard/storyboard-default-plan';

const FLAG = STORYBOARD_DEFAULT_DISCOVERY_FLAG;
const CANARY = 'https://byoc-canary-1.daydream.monster:8935';

function makeRequest(qs = '') {
  return new NextRequest(
    `http://localhost/api/v1/orchestrator-leaderboard/storyboard-default/python-gateway${qs}`,
    { headers: { Authorization: 'Bearer gw_test' } },
  );
}

describe('GET storyboard-default/python-gateway', () => {
  const prev = process.env[FLAG];

  beforeEach(() => {
    vi.clearAllMocks();
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
      authenticated: true,
      teamId: 'personal:user-1',
      callerType: 'apiKey',
      callerId: 'user-1',
    });
    (fetchLeaderboard as ReturnType<typeof vi.fn>).mockImplementation(async (cap: string) => ({
      rows:
        cap === 'scope'
          ? [
              { orch_uri: 'https://orch-staging-1.daydream.monster:8935' },
              { orch_uri: 'https://orch-staging-2.daydream.monster:8935' },
            ]
          : [{ orch_uri: 'https://byoc-staging-1.daydream.monster:8935' }],
      fromCache: true,
      cachedAt: Date.now(),
    }));
  });

  const prevCanary = {
    byoc: process.env[STORYBOARD_CANARY_ORCHESTRATOR_ENV.byoc],
    tool: process.env[STORYBOARD_CANARY_ORCHESTRATOR_ENV.tool],
    scope: process.env[STORYBOARD_CANARY_ORCHESTRATOR_ENV.scope],
  };

  afterEach(() => {
    if (prev === undefined) {
      delete process.env[FLAG];
    } else {
      process.env[FLAG] = prev;
    }
    for (const key of ['byoc', 'tool', 'scope'] as const) {
      const name = STORYBOARD_CANARY_ORCHESTRATOR_ENV[key];
      if (prevCanary[key] === undefined) delete process.env[name];
      else process.env[name] = prevCanary[key];
    }
  });

  it('returns 404 when the flag is OFF (default) — Daydream path stays authoritative', async () => {
    delete process.env[FLAG];
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    expect(fetchLeaderboard).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated even with the flag ON', async () => {
    process.env[FLAG] = 'true';
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns the bundle with static-fleet scope orchestrators when the flag is ON', async () => {
    process.env[FLAG] = 'true';
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Discovery-Mode')).toBe('storyboard-default');

    const body = (await res.json()) as { address: string }[];
    const addresses = body.map((o) => o.address);
    // orch-staging-3 was NOT returned by ClickHouse but the static fleet adds it.
    expect(addresses).toContain('https://orch-staging-3.daydream.monster:8935');
    expect(addresses).toContain('https://orch-staging-1.daydream.monster:8935');
    expect(addresses).toContain('https://byoc-staging-1.daydream.monster:8935');
  });

  it('surfaces the env-configured canary orchestrator across byoc + tool + scope', async () => {
    process.env[FLAG] = 'true';
    process.env[STORYBOARD_CANARY_ORCHESTRATOR_ENV.byoc] = CANARY;
    process.env[STORYBOARD_CANARY_ORCHESTRATOR_ENV.tool] = CANARY;
    process.env[STORYBOARD_CANARY_ORCHESTRATOR_ENV.scope] = CANARY;
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = (await res.json()) as { address: string }[];
    const addresses = body.map((o) => o.address);
    expect(addresses).toContain(CANARY);
    // De-duplicated even though configured for all three classes.
    expect(addresses.filter((a) => a === CANARY)).toHaveLength(1);
  });
});
