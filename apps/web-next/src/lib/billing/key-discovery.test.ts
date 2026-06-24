/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    discoveryPlan: { findUnique: vi.fn() },
  },
}));

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  PLAN_SPEC_SYNC_FLAG: 'plan_spec_sync',
}));

import { prisma } from '@/lib/db';
import { buildDiscoveryUrl, resolveKeyDiscovery } from './key-discovery';

const findUnique = prisma.discoveryPlan.findUnique as ReturnType<typeof vi.fn>;

const SUB = { providerInstanceId: 'pi_1', providerPlanId: 'plan_basic' };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildDiscoveryUrl', () => {
  it('targets the per-app python-gateway route', () => {
    expect(buildDiscoveryUrl('dp_1')).toBe(
      '/api/v1/orchestrator-leaderboard/plans/dp_1/python-gateway',
    );
  });
});

describe('resolveKeyDiscovery', () => {
  describe('INV: returns null (no discovery field) without reading DB', () => {
    it('flag OFF → null and NEVER reads DiscoveryPlan (today\'s response)', async () => {
      isFeatureEnabled.mockResolvedValue(false);
      expect(await resolveKeyDiscovery(SUB)).toBeNull();
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('subscription without providerPlanId → null, no flag check, no DB read', async () => {
      const res = await resolveKeyDiscovery({ providerInstanceId: 'pi_1', providerPlanId: null });
      expect(res).toBeNull();
      expect(isFeatureEnabled).not.toHaveBeenCalled();
      expect(findUnique).not.toHaveBeenCalled();
    });
  });

  describe('flag ON', () => {
    beforeEach(() => isFeatureEnabled.mockResolvedValue(true));

    it('selects the auto DiscoveryPlan by "${instance}:${plan}" and returns its id + URL', async () => {
      findUnique.mockResolvedValue({ id: 'dp_42', enabled: true });
      const res = await resolveKeyDiscovery(SUB);
      expect(findUnique).toHaveBeenCalledWith({
        where: { billingPlanId: 'pi_1:plan_basic' },
        select: { id: true, enabled: true },
      });
      expect(res).toEqual({
        discoveryPlanId: 'dp_42',
        url: '/api/v1/orchestrator-leaderboard/plans/dp_42/python-gateway',
      });
    });

    it('no matching plan → null (graceful, e.g. sync has not run yet)', async () => {
      findUnique.mockResolvedValue(null);
      expect(await resolveKeyDiscovery(SUB)).toBeNull();
    });

    it('disabled plan → null', async () => {
      findUnique.mockResolvedValue({ id: 'dp_42', enabled: false });
      expect(await resolveKeyDiscovery(SUB)).toBeNull();
    });

    it('DB error → null, never throws', async () => {
      findUnique.mockRejectedValue(new Error('db down'));
      expect(await resolveKeyDiscovery(SUB)).toBeNull();
    });
  });
});
