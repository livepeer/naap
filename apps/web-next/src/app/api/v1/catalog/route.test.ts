/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  MULTI_SUBSCRIPTION_FLAG: 'multi_subscription',
}));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

const prisma = vi.hoisted(() => ({ providerInstance: { findMany: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma }));

function req(headers: Record<string, string> = { cookie: 'naap_auth_token=tok' }): NextRequest {
  return new NextRequest('http://localhost/api/v1/catalog', { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  validateSession.mockResolvedValue({ id: 'user-1' });
  prisma.providerInstance.findMany.mockResolvedValue([
    { id: 'inst-1', slug: 'pymthouse-default', displayName: 'PymtHouse', adapterType: 'pymthouse', enabled: true, sortOrder: 0 },
  ]);
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

  it('lists enabled provider instances (no secrets), plans stubbed empty', async () => {
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
    // Catalog only requests enabled instances.
    expect(prisma.providerInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
    expect(JSON.stringify(json.data)).not.toContain('secretRef');
  });
});
