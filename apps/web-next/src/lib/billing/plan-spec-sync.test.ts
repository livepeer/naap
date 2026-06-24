/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    providerInstance: { findMany: vi.fn() },
    providerPlan: { findUnique: vi.fn(), upsert: vi.fn() },
    discoveryPlan: { upsert: vi.fn() },
  },
}));

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  PLAN_SPEC_SYNC_FLAG: 'plan_spec_sync',
}));

vi.mock('./pymthouse-adapter', () => ({ PYMTHOUSE_ADAPTER_SLUG: 'pymthouse' }));

const parsePymthouseInstanceConfig = vi.fn();
const getProviderInstanceSecret = vi.fn();
vi.mock('./provider-instance', () => ({
  parsePymthouseInstanceConfig: (...a: unknown[]) => parsePymthouseInstanceConfig(...a),
  getProviderInstanceSecret: (...a: unknown[]) => getProviderInstanceSecret(...a),
}));

const getBuilderApiV1BaseFromIssuerUrl = vi.fn();
vi.mock('@pymthouse/builder-sdk/config', () => ({
  getBuilderApiV1BaseFromIssuerUrl: (...a: unknown[]) => getBuilderApiV1BaseFromIssuerUrl(...a),
}));

vi.mock('@/lib/pymthouse-discovery-plans', () => ({
  fetchPymthouseDiscoveryPlans: vi.fn(),
}));

import { prisma } from '@/lib/db';
import {
  computeProviderPlanRevision,
  planRowToCapabilities,
} from './auto-discovery-plan';
import type { PymthouseDiscoveryPlanRow } from '@/lib/pymthouse-discovery-plans';
import type { ProviderInstanceRecord } from './provider-instance';
import {
  syncAllProviderInstancePlans,
  syncProviderInstancePlans,
} from './plan-spec-sync';

const findManyInstances = prisma.providerInstance.findMany as ReturnType<typeof vi.fn>;
const findUniquePlan = prisma.providerPlan.findUnique as ReturnType<typeof vi.fn>;
const upsertPlan = prisma.providerPlan.upsert as ReturnType<typeof vi.fn>;
const upsertDiscovery = prisma.discoveryPlan.upsert as ReturnType<typeof vi.fn>;

const PYMTHOUSE_INSTANCE: ProviderInstanceRecord = {
  id: 'pi_1',
  adapterType: 'pymthouse',
  slug: 'app-one',
  config: { issuerUrl: 'https://op.example', publicClientId: 'pub', m2mClientId: 'm2m' },
  secretRef: 'vault:pi_1:m2m',
  enabled: true,
};

const PLAN_ROW: PymthouseDiscoveryPlanRow = {
  id: 'plan_basic',
  name: 'Basic',
  status: 'active',
  discoveryPolicy: { topN: 5 },
  capabilities: [
    { pipeline: 'live-video-to-video', modelId: 'scope', discoveryPolicy: null },
    { pipeline: 'image-to-image', modelId: 'nano-banana', discoveryPolicy: null },
  ],
};

function expectedRevision(): string {
  return computeProviderPlanRevision({
    name: PLAN_ROW.name,
    capabilities: planRowToCapabilities(PLAN_ROW),
    discoveryPolicy: PLAN_ROW.discoveryPolicy,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  parsePymthouseInstanceConfig.mockReturnValue({
    issuerUrl: 'https://op.example',
    publicClientId: 'pub',
    m2mClientId: 'm2m',
  });
  getBuilderApiV1BaseFromIssuerUrl.mockReturnValue('https://api.example/api/v1');
  getProviderInstanceSecret.mockResolvedValue('s3cret');
  upsertPlan.mockResolvedValue({});
  upsertDiscovery.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncAllProviderInstancePlans (flag gating)', () => {
  it('INV: flag OFF → no-op, never reads ProviderInstance/ProviderPlan', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await syncAllProviderInstancePlans();
    expect(res).toEqual({ enabled: false, instances: [] });
    expect(findManyInstances).not.toHaveBeenCalled();
    expect(upsertPlan).not.toHaveBeenCalled();
    expect(upsertDiscovery).not.toHaveBeenCalled();
  });

  it('flag ON → iterates enabled instances and aggregates', async () => {
    isFeatureEnabled.mockResolvedValue(true);
    findManyInstances.mockResolvedValue([PYMTHOUSE_INSTANCE]);
    findUniquePlan.mockResolvedValue(null);
    const pull = vi.fn().mockResolvedValue({ plans: [PLAN_ROW] });

    const res = await syncAllProviderInstancePlans({ pull });
    expect(res.enabled).toBe(true);
    expect(res.instances).toHaveLength(1);
    expect(res.instances[0]).toMatchObject({
      providerInstanceId: 'pi_1',
      status: 'synced',
      plansUpserted: 1,
      discoveryPlansUpserted: 1,
    });
  });
});

describe('syncProviderInstancePlans (per-instance pull → persistence)', () => {
  it('pulls with the instance creds (not global env) and upserts ProviderPlan keyed [instance, plan]', async () => {
    findUniquePlan.mockResolvedValue(null);
    const pull = vi.fn().mockResolvedValue({ plans: [PLAN_ROW] });

    const res = await syncProviderInstancePlans(PYMTHOUSE_INSTANCE, { pull });

    expect(pull).toHaveBeenCalledWith(
      {
        apiV1Base: 'https://api.example/api/v1',
        publicClientId: 'pub',
        m2mClientId: 'm2m',
        m2mClientSecret: 's3cret',
      },
      undefined,
    );
    expect(upsertPlan).toHaveBeenCalledTimes(1);
    const upsertArg = upsertPlan.mock.calls[0][0];
    expect(upsertArg.where).toEqual({
      providerInstanceId_providerPlanId: { providerInstanceId: 'pi_1', providerPlanId: 'plan_basic' },
    });
    expect(upsertArg.create.capabilities).toEqual([
      'image-to-image/nano-banana',
      'live-video-to-video/scope',
    ]);
    expect(upsertArg.create.revision).toBe(expectedRevision());
    expect(res).toMatchObject({ status: 'synced', plansUpserted: 1, discoveryPlansUpserted: 1 });
  });

  it('auto-generates a per-app DiscoveryPlan keyed "${instance}:${plan}" with public visibility', async () => {
    findUniquePlan.mockResolvedValue(null);
    const pull = vi.fn().mockResolvedValue({ plans: [PLAN_ROW] });

    await syncProviderInstancePlans(PYMTHOUSE_INSTANCE, { pull });

    expect(upsertDiscovery).toHaveBeenCalledTimes(1);
    const arg = upsertDiscovery.mock.calls[0][0];
    expect(arg.where).toEqual({ billingPlanId: 'pi_1:plan_basic' });
    expect(arg.create).toMatchObject({
      billingPlanId: 'pi_1:plan_basic',
      billingProviderSlug: 'pymthouse',
      name: 'Basic',
      visibility: 'public',
      topN: 5,
      enabled: true,
    });
    expect(arg.create.capabilities).toEqual([
      'image-to-image/nano-banana',
      'live-video-to-video/scope',
    ]);
  });

  it('IDEMPOTENT: unchanged revision re-touches ProviderPlan but does NOT regenerate DiscoveryPlan', async () => {
    findUniquePlan.mockResolvedValue({ revision: expectedRevision() });
    const pull = vi.fn().mockResolvedValue({ plans: [PLAN_ROW] });

    const res = await syncProviderInstancePlans(PYMTHOUSE_INSTANCE, { pull });

    expect(upsertPlan).toHaveBeenCalledTimes(1);
    expect(upsertDiscovery).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: 'synced', plansUpserted: 1, discoveryPlansUpserted: 0 });
  });

  it('changed revision regenerates the DiscoveryPlan', async () => {
    findUniquePlan.mockResolvedValue({ revision: 'stale-revision' });
    const pull = vi.fn().mockResolvedValue({ plans: [PLAN_ROW] });

    const res = await syncProviderInstancePlans(PYMTHOUSE_INSTANCE, { pull });

    expect(upsertDiscovery).toHaveBeenCalledTimes(1);
    expect(res.discoveryPlansUpserted).toBe(1);
  });

  describe('graceful degradation (never hard-fail)', () => {
    it('missing M2M secret → unavailable, no upserts', async () => {
      getProviderInstanceSecret.mockResolvedValue(null);
      const pull = vi.fn();
      const res = await syncProviderInstancePlans(PYMTHOUSE_INSTANCE, { pull });
      expect(res.status).toBe('unavailable');
      expect(pull).not.toHaveBeenCalled();
      expect(upsertPlan).not.toHaveBeenCalled();
    });

    it('provider plan API unavailable (null pull) → unavailable, no upserts', async () => {
      findUniquePlan.mockResolvedValue(null);
      const pull = vi.fn().mockResolvedValue(null);
      const res = await syncProviderInstancePlans(PYMTHOUSE_INSTANCE, { pull });
      expect(res.status).toBe('unavailable');
      expect(upsertPlan).not.toHaveBeenCalled();
    });

    it('pull throws → unavailable, never throws', async () => {
      const pull = vi.fn().mockRejectedValue(new Error('network'));
      const res = await syncProviderInstancePlans(PYMTHOUSE_INSTANCE, { pull });
      expect(res.status).toBe('unavailable');
    });

    it('non-pymthouse adapterType → unsupported (no plan-spec pull yet)', async () => {
      const pull = vi.fn();
      const res = await syncProviderInstancePlans(
        { ...PYMTHOUSE_INSTANCE, adapterType: 'stub' },
        { pull },
      );
      expect(res.status).toBe('unsupported');
      expect(pull).not.toHaveBeenCalled();
    });
  });
});
