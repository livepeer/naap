/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchPymthouseDiscoveryPlans,
  getPymthouseApiV1Base,
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

    const payload = { plans: [{ id: 'p1', name: 'P', status: 'active', discoveryPolicy: null, capabilities: [] }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          json: async () => payload,
        } as Response),
      ),
    );

    const out = await fetchPymthouseDiscoveryPlans({ skipCache: true });
    expect(out?.plans).toHaveLength(1);
    expect(out?.plans[0].id).toBe('p1');
  });
});
