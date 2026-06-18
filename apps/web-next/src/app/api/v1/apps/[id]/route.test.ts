/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, PATCH, DELETE } from './route';

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

const findFirst = vi.fn();
const update = vi.fn();
const del = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    application: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
      delete: (...a: unknown[]) => del(...a),
    },
  },
}));

function req(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown): NextRequest {
  return new NextRequest('https://naap.test/api/v1/apps/app-1', {
    method,
    headers: { 'content-type': 'application/json', 'x-team-id': 'team-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const teamCtx = { userId: 'user-1', teamId: 'team-1', token: 't', isPersonal: false };

beforeEach(() => {
  vi.clearAllMocks();
  getAdminContext.mockResolvedValue(teamCtx);
});

describe('app_registry flag OFF → no-op (zero regression)', () => {
  beforeEach(() => isFeatureEnabled.mockResolvedValue(false));

  it('GET returns 404 and never touches auth/DB', async () => {
    const res = await GET(req('GET'), params('app-1'));
    expect(res.status).toBe(404);
    expect(getAdminContext).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('PATCH returns 404 when off', async () => {
    const res = await PATCH(req('PATCH', { name: 'X' }), params('app-1'));
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it('DELETE returns 404 when off', async () => {
    const res = await DELETE(req('DELETE'), params('app-1'));
    expect(res.status).toBe(404);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('app_registry flag ON', () => {
  beforeEach(() => isFeatureEnabled.mockResolvedValue(true));

  it('GET returns an app in the caller scope', async () => {
    findFirst.mockResolvedValue({ id: 'app-1', slug: 'storyboard', teamId: 'team-1' });
    const res = await GET(req('GET'), params('app-1'));
    expect(res.status).toBe(200);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'app-1', teamId: 'team-1' } }),
    );
  });

  it("GET returns 404 (not 403) for another scope's app — no enumeration", async () => {
    findFirst.mockResolvedValue(null);
    const res = await GET(req('GET'), params('app-other'));
    expect(res.status).toBe(404);
  });

  it('PATCH updates an owned app', async () => {
    findFirst.mockResolvedValue({ id: 'app-1' });
    update.mockResolvedValue({ id: 'app-1', name: 'Renamed' });
    const res = await PATCH(req('PATCH', { name: 'Renamed' }), params('app-1'));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'app-1' } }));
  });

  it('PATCH returns 400 when no fields are provided', async () => {
    const res = await PATCH(req('PATCH', {}), params('app-1'));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('PATCH returns 400 for an invalid scope', async () => {
    const res = await PATCH(req('PATCH', { allowedScopes: ['bogus'] }), params('app-1'));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('PATCH returns 404 for an app outside the caller scope', async () => {
    findFirst.mockResolvedValue(null);
    const res = await PATCH(req('PATCH', { name: 'X' }), params('app-other'));
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it('DELETE removes an owned app', async () => {
    findFirst.mockResolvedValue({ id: 'app-1' });
    del.mockResolvedValue({ id: 'app-1' });
    const res = await DELETE(req('DELETE'), params('app-1'));
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({ where: { id: 'app-1' } });
  });

  it('DELETE returns 404 for an app outside the caller scope', async () => {
    findFirst.mockResolvedValue(null);
    const res = await DELETE(req('DELETE'), params('app-other'));
    expect(res.status).toBe(404);
    expect(del).not.toHaveBeenCalled();
  });
});
