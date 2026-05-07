/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyDiscoveryPolicyToOrchestrators,
  applyPymthouseDiscoveryToOrchestrators,
  effectiveCapabilityDiscoveryPolicy,
  resolveMergedDiscoveryPolicyForCapability,
} from '@/lib/orchestrators-discovery-policy';
import type { PymthouseDiscoveryPlansResponse } from '@/lib/pymthouse-discovery-plans';
import {
  mergeDiscoveryPolicies,
  resetPymthouseDiscoveryPlansCacheForTests,
} from '@/lib/pymthouse-discovery-plans';
import type { DashboardOrchestrator } from '@naap/plugin-sdk';

const baseRow = (over: Partial<DashboardOrchestrator>): DashboardOrchestrator => ({
  address: '0x1',
  uris: ['https://o.example/'],
  lastSeen: null,
  knownSessions: 10,
  successSessions: 9,
  successRatio: 90,
  effectiveSuccessRate: 90,
  noSwapRatio: 95,
  slaScore: 80,
  pipelines: ['llm'],
  pipelineModels: [{ pipelineId: 'llm', modelIds: ['m1'] }],
  gpuCount: 2,
  ...over,
});

describe('orchestrators-discovery-policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetPymthouseDiscoveryPlansCacheForTests();
  });

  it('wildcard bundle matches concrete modelId', () => {
    const plan = {
      id: 'p1',
      name: 'P',
      status: 'active',
      discoveryPolicy: { topN: 10 } as const,
      capabilities: [{ pipeline: 'llm', modelId: '*', discoveryPolicy: { topN: 3 } }],
    };
    const eff = effectiveCapabilityDiscoveryPolicy(plan, 'llm', 'gpt-4');
    expect(eff?.topN).toBe(3);
  });

  it('resolveMerged intersects policies across plans', () => {
    const response: PymthouseDiscoveryPlansResponse = {
      plans: [
        {
          id: 'a',
          name: 'A',
          status: 'active',
          discoveryPolicy: { filters: { priceMax: 100 } },
          capabilities: [{ pipeline: 'llm', modelId: 'm1', discoveryPolicy: null }],
        },
        {
          id: 'b',
          name: 'B',
          status: 'active',
          discoveryPolicy: { filters: { priceMax: 40 } },
          capabilities: [{ pipeline: 'llm', modelId: 'm1', discoveryPolicy: null }],
        },
      ],
    };
    const merged = resolveMergedDiscoveryPolicyForCapability(response, 'llm', 'm1');
    expect(merged?.filters?.priceMax).toBe(40);
  });

  it('applyDiscoveryPolicyToOrchestrators enforces slaMinScore without filters', () => {
    const rows = [
      baseRow({ address: '0xa', slaScore: 50, noSwapRatio: 99 }),
      baseRow({ address: '0xb', slaScore: 90, noSwapRatio: 98 }),
    ];
    const out = applyDiscoveryPolicyToOrchestrators(rows, { slaMinScore: 0.85 });
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe('0xb');
  });

  it('applyDiscoveryPolicyToOrchestrators enforces slaMinScore with topN and sortBy', () => {
    const rows = [
      baseRow({ address: '0xa', slaScore: 50, noSwapRatio: 99 }),
      baseRow({ address: '0xb', slaScore: 90, noSwapRatio: 98 }),
    ];
    const out = applyDiscoveryPolicyToOrchestrators(rows, {
      slaMinScore: 0.85,
      topN: 1,
      sortBy: 'slaScore',
    });
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe('0xb');
  });

  it('mergeDiscoveryPolicies does not let user widen priceMax', () => {
    const merged = mergeDiscoveryPolicies(
      { filters: { priceMax: 10 } },
      { filters: { priceMax: 100 } },
    );
    expect(merged?.filters?.priceMax).toBe(10);
  });

  it('applyPymthouseDiscoveryToOrchestrators returns [] when no bundle matches scoped pipeline', async () => {
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'http://localhost:9/api/v1/oidc');
    vi.stubEnv('PMTHOUSE_CLIENT_ID', 'pub');
    vi.stubEnv('PMTHOUSE_M2M_CLIENT_ID', 'm2m');
    vi.stubEnv('PMTHOUSE_M2M_CLIENT_SECRET', 'secret');
    const payload: PymthouseDiscoveryPlansResponse = {
      plans: [
        {
          id: 'p1',
          name: 'P',
          status: 'active',
          discoveryPolicy: null,
          capabilities: [{ pipeline: 'video', modelId: '*', discoveryPolicy: null }],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          json: async () => payload,
        } as Response),
      ),
    );
    const rows = [baseRow({ address: '0xa' })];
    const out = await applyPymthouseDiscoveryToOrchestrators(rows, {
      pipeline: 'llm',
      modelId: 'm1',
    });
    expect(out).toEqual([]);
  });

  it('applyPymthouseDiscoveryToOrchestrators applies remote topN when bundle matches', async () => {
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'http://localhost:9/api/v1/oidc');
    vi.stubEnv('PMTHOUSE_CLIENT_ID', 'pub');
    vi.stubEnv('PMTHOUSE_M2M_CLIENT_ID', 'm2m');
    vi.stubEnv('PMTHOUSE_M2M_CLIENT_SECRET', 'secret');
    const payload: PymthouseDiscoveryPlansResponse = {
      plans: [
        {
          id: 'p1',
          name: 'P',
          status: 'active',
          discoveryPolicy: null,
          capabilities: [
            {
              pipeline: 'llm',
              modelId: 'm1',
              discoveryPolicy: { topN: 1, sortBy: 'slaScore' },
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          json: async () => payload,
        } as Response),
      ),
    );
    const rows = [
      baseRow({ address: '0xa', slaScore: 60 }),
      baseRow({ address: '0xb', slaScore: 90 }),
    ];
    const out = await applyPymthouseDiscoveryToOrchestrators(rows, {
      pipeline: 'llm',
      modelId: 'm1',
    });
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe('0xb');
  });
});
