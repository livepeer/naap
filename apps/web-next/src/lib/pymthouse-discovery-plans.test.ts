/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchPymthouseDiscoveryPlans,
  getPymthouseApiV1Base,
  mapPymthousePlansResponse,
  mergeDiscoveryPolicies,
  resetPymthouseDiscoveryPlansCacheForTests,
} from '@/lib/pymthouse-discovery-plans';

describe('pymthouse-discovery-plans', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetPymthouseDiscoveryPlansCacheForTests();
  });

  it('getPymthouseApiV1Base strips /oidc suffix', () => {
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'https://ph.example/api/v1/oidc/');
    expect(getPymthouseApiV1Base()).toBe('https://ph.example/api/v1');
  });

  it('mergeDiscoveryPolicies uses min topN', () => {
    expect(mergeDiscoveryPolicies({ topN: 5 }, { topN: 20 })?.topN).toBe(5);
    expect(mergeDiscoveryPolicies({ topN: 20 }, { topN: 5 })?.topN).toBe(5);
  });

  it('fetchPymthouseDiscoveryPlans returns null without env', async () => {
    expect(await fetchPymthouseDiscoveryPlans({ skipCache: true })).toBeNull();
  });

  it('fetchPymthouseDiscoveryPlans parses JSON on 200', async () => {
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'http://localhost:3001/api/v1/oidc');
    vi.stubEnv('PMTHOUSE_CLIENT_ID', 'app_x');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_ID', 'm2m_x');
    vi.stubEnv('PMTHOUSE_M2M_CLIENT_SECRET', 'secret');

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          plans: [{ id: 'p1', name: 'P', status: 'active', discoveryPolicy: null, capabilities: [] }],
        }),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchPymthouseDiscoveryPlans({ skipCache: true });
    expect(out?.plans).toHaveLength(1);
    expect(out?.plans[0].id).toBe('p1');
    const [firstUrl] = fetchMock.mock.calls[0];
    expect(String(firstUrl)).toContain('/apps/app_x/plans');
    expect(String(firstUrl)).not.toContain('discovery');
  });

  it('P4: per-instance creds pull a SPECIFIC app (env + cache bypassed)', async () => {
    // No PYMTHOUSE_* env set — proves the pull uses the supplied creds, not env.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          plans: [{ id: 'p9', name: 'Inst', status: 'active', discoveryPolicy: null, capabilities: [] }],
        }),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchPymthouseDiscoveryPlans({
      creds: {
        apiV1Base: 'https://inst.example/api/v1',
        publicClientId: 'app_inst',
        m2mClientId: 'm2m_inst',
        m2mClientSecret: 'sek',
      },
    });
    expect(out?.plans[0].id).toBe('p9');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://inst.example/api/v1/apps/app_inst/plans');
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe(
      `Basic ${Buffer.from('m2m_inst:sek', 'utf8').toString('base64')}`,
    );
  });

  it('P4: per-instance creds never read the global-env cache', async () => {
    // Seed the global-env cache via the env path.
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'http://localhost:3001/api/v1/oidc');
    vi.stubEnv('PMTHOUSE_CLIENT_ID', 'app_x');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_ID', 'm2m_x');
    vi.stubEnv('PMTHOUSE_M2M_CLIENT_SECRET', 'secret');
    const envFetch = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ plans: [{ id: 'env', name: 'E', status: 'active', discoveryPolicy: null, capabilities: [] }] }),
      } as Response),
    );
    vi.stubGlobal('fetch', envFetch);
    await fetchPymthouseDiscoveryPlans();

    // A per-instance pull must NOT return the cached env plan; it fetches fresh.
    const instFetch = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ plans: [{ id: 'inst', name: 'I', status: 'active', discoveryPolicy: null, capabilities: [] }] }),
      } as Response),
    );
    vi.stubGlobal('fetch', instFetch);
    const out = await fetchPymthouseDiscoveryPlans({
      creds: {
        apiV1Base: 'https://inst.example/api/v1',
        publicClientId: 'app_inst',
        m2mClientId: 'm2m_inst',
        m2mClientSecret: 'sek',
      },
    });
    expect(out?.plans[0].id).toBe('inst');
    expect(instFetch).toHaveBeenCalledTimes(1);
  });

  it('mapPymthousePlansResponse drops network default and inactive', () => {
    const raw = {
      plans: [
        {
          id: 'net',
          name: '__pymthouse_network_default__',
          status: 'active',
          isNetworkDefault: true,
          discoveryPolicy: null,
          capabilities: [],
        },
        { id: 'p1', name: 'Custom', status: 'draft', discoveryPolicy: null, capabilities: [] },
        {
          id: 'p2',
          name: 'Live',
          status: 'active',
          isNetworkDefault: false,
          discoveryPolicy: { topN: 3 },
          capabilities: [{ pipeline: 'llm', modelId: 'm1', discoveryPolicy: null }],
        },
      ],
    };
    const out = mapPymthousePlansResponse(raw);
    expect(out?.plans).toHaveLength(1);
    expect(out?.plans[0].id).toBe('p2');
    expect(out?.plans[0].capabilities[0]).toEqual({
      pipeline: 'llm',
      modelId: 'm1',
      discoveryPolicy: null,
    });
  });
});
