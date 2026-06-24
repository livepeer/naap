/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  MULTI_SUBSCRIPTION_FLAG: 'multi_subscription',
  PLAN_SPEC_SYNC_FLAG: 'plan_spec_sync',
}));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

const prisma = vi.hoisted(() => ({
  providerInstance: { findMany: vi.fn() },
  providerPlan: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

/** Default: multi_subscription ON, plan_spec_sync OFF (so plans stay []). */
function flagState(plan_spec_sync = false): void {
  isFeatureEnabled.mockImplementation(async (flag: string) =>
    flag === 'plan_spec_sync' ? plan_spec_sync : true,
  );
}

function req(headers: Record<string, string> = { cookie: 'naap_auth_token=tok' }): NextRequest {
  return new NextRequest('http://localhost/api/v1/catalog', { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  flagState(false);
  validateSession.mockResolvedValue({ id: 'user-1' });
  prisma.providerInstance.findMany.mockResolvedValue([
    { id: 'inst-1', slug: 'pymthouse-default', displayName: 'PymtHouse', adapterType: 'pymthouse', enabled: true, sortOrder: 0 },
  ]);
  prisma.providerPlan.findMany.mockResolvedValue([]);
});

describe('GET /api/v1/catalog', () => {
  it('INV: 404 no-op when multi_subscription OFF; never reads the DB', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(prisma.providerInstance.findMany).not.toHaveBeenCalled();
  });

  it('401 without a session token', async () => {
    const res = await GET(req({}));
    expect(res.status).toBe(401);
  });

  it('INV: plan_spec_sync OFF → plans empty and ProviderPlan is never read', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.instances).toHaveLength(1);
    expect(json.data.instances[0]).toEqual({
      providerInstanceId: 'inst-1',
      slug: 'pymthouse-default',
      displayName: 'PymtHouse',
      adapterType: 'pymthouse',
      plans: [],
    });
    expect(prisma.providerPlan.findMany).not.toHaveBeenCalled();
    // Catalog only requests enabled instances.
    expect(prisma.providerInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
    expect(JSON.stringify(json.data)).not.toContain('secretRef');
  });

  it('plan_spec_sync ON → joins synced ProviderPlan rows into the catalog', async () => {
    flagState(true);
    prisma.providerPlan.findMany.mockResolvedValue([
      {
        providerInstanceId: 'inst-1',
        providerPlanId: 'plan_basic',
        name: 'Basic',
        capabilities: ['image-to-image/nano-banana'],
        enabled: true,
      },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.instances[0].plans).toEqual([
      { providerPlanId: 'plan_basic', name: 'Basic', capabilities: ['image-to-image/nano-banana'] },
    ]);
    expect(prisma.providerPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerInstanceId: { in: ['inst-1'] }, enabled: true },
      }),
    );
  });
});
