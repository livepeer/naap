/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  APP_REGISTRY_FLAG: 'app_registry',
}));

const getAdminContext = vi.fn();
vi.mock('@/lib/gateway/admin/team-guard', () => ({
  getAdminContext: (...a: unknown[]) => getAdminContext(...a),
  isErrorResponse: (r: unknown) => r instanceof Response,
}));

const create = vi.fn();
const findUnique = vi.fn();
const findMany = vi.fn();
const count = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    application: {
      create: (...a: unknown[]) => create(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
    },
  },
}));

function req(body?: unknown): NextRequest {
  return new NextRequest('https://naap.test/api/v1/apps', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-team-id': 'team-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const teamCtx = { userId: 'user-1', teamId: 'team-1', token: 't', isPersonal: false };

beforeEach(() => {
  vi.clearAllMocks();
  getAdminContext.mockResolvedValue(teamCtx);
});

describe('app_registry flag OFF → no-op', () => {
  it('GET returns 404 when the flag is off', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(getAdminContext).not.toHaveBeenCalled();
  });

  it('POST returns 404 when the flag is off', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await POST(req({ slug: 'x', name: 'X' }));
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('app_registry flag ON', () => {
  beforeEach(() => isFeatureEnabled.mockResolvedValue(true));

  it('registers an app scoped to the caller team', async () => {
    findUnique.mockResolvedValue(null);
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'app-new',
      ...data,
    }));

    const res = await POST(
      req({ slug: 'naap-cli', name: 'NaaP CLI', type: 'cli', allowedScopes: ['discovery'] }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.slug).toBe('naap-cli');

    const arg = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.teamId).toBe('team-1');
    expect(arg.data.ownerUserId).toBeUndefined();
    expect(arg.data.allowedScopes).toEqual(['discovery']);
  });

  it('rejects a duplicate slug with 409', async () => {
    findUnique.mockResolvedValue({ id: 'existing' });
    const res = await POST(req({ slug: 'storyboard', name: 'Storyboard' }));
    expect(res.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unknown scope with a validation error', async () => {
    const res = await POST(req({ slug: 'x-app', name: 'X', allowedScopes: ['bogus'] }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('lists apps in the caller scope', async () => {
    findMany.mockResolvedValue([{ id: 'app-1', slug: 'storyboard' }]);
    count.mockResolvedValue(1);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: 'team-1' } }),
    );
  });
});
