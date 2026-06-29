/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prisma = vi.hoisted(() => ({
  team: { findUnique: vi.fn() },
  featureFlag: { findMany: vi.fn(), upsert: vi.fn() },
  featureFlagOverride: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

// CSRF is enforced separately; treat it as passing here.
vi.mock('@/lib/api/csrf', () => ({ validateCSRF: () => null }));

import { GET, PUT, DELETE } from './route';

const ADMIN = { id: 'admin-1', roles: ['system:admin'] };
const NON_ADMIN = { id: 'user-2', roles: ['user'] };

function req(
  method: string,
  opts: { url?: string; token?: string | null; body?: unknown } = {},
): NextRequest {
  const url = opts.url ?? 'http://localhost/api/v1/admin/feature-flag-overrides';
  return new NextRequest(url, {
    method,
    headers: {
      ...(opts.token !== null ? { authorization: `Bearer ${opts.token ?? 'tok'}` } : {}),
      'content-type': 'application/json',
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  validateSession.mockResolvedValue(ADMIN);
  prisma.featureFlag.upsert.mockResolvedValue({});
  prisma.featureFlag.findMany.mockResolvedValue([]);
  prisma.featureFlagOverride.findMany.mockResolvedValue([]);
  prisma.team.findUnique.mockResolvedValue({ id: 'team-1', name: 'Acme', slug: 'acme' });
});

describe('authz (all verbs require system:admin)', () => {
  it('GET 401 without a token', async () => {
    expect((await GET(req('GET', { url: 'http://localhost/api/v1/admin/feature-flag-overrides?teamId=team-1', token: null }))).status).toBe(401);
  });
  it('GET 401 for an invalid session', async () => {
    validateSession.mockResolvedValue(null);
    expect((await GET(req('GET', { url: 'http://localhost/api/v1/admin/feature-flag-overrides?teamId=team-1' }))).status).toBe(401);
  });
  it('GET 403 for a non-admin', async () => {
    validateSession.mockResolvedValue(NON_ADMIN);
    expect((await GET(req('GET', { url: 'http://localhost/api/v1/admin/feature-flag-overrides?teamId=team-1' }))).status).toBe(403);
  });
  it('PUT 403 for a non-admin', async () => {
    validateSession.mockResolvedValue(NON_ADMIN);
    const res = await PUT(req('PUT', { body: { teamId: 'team-1', key: 'capability_gate', enabled: true } }));
    expect(res.status).toBe(403);
    expect(prisma.featureFlagOverride.upsert).not.toHaveBeenCalled();
  });
  it('DELETE 403 for a non-admin', async () => {
    validateSession.mockResolvedValue(NON_ADMIN);
    const res = await DELETE(req('DELETE', { body: { teamId: 'team-1', key: 'capability_gate' } }));
    expect(res.status).toBe(403);
    expect(prisma.featureFlagOverride.deleteMany).not.toHaveBeenCalled();
  });
});

describe('GET — effective values + provenance', () => {
  it('400 without teamId', async () => {
    expect((await GET(req('GET'))).status).toBe(400);
  });

  it('404 for an unknown team', async () => {
    prisma.team.findUnique.mockResolvedValue(null);
    expect((await GET(req('GET', { url: 'http://localhost/api/v1/admin/feature-flag-overrides?teamId=nope' }))).status).toBe(404);
  });

  it('merges global defaults with the team override and marks provenance', async () => {
    prisma.featureFlag.findMany.mockResolvedValue([
      { key: 'capability_gate', enabled: false, description: 'gate' },
      { key: 'usage_pull', enabled: false, description: 'pull' },
    ]);
    prisma.featureFlagOverride.findMany.mockResolvedValue([
      { flagKey: 'capability_gate', enabled: true, updatedBy: 'admin-1', updatedAt: new Date() },
    ]);

    const res = await GET(req('GET', { url: 'http://localhost/api/v1/admin/feature-flag-overrides?teamId=team-1' }));
    expect(res.status).toBe(200);
    const { data } = await res.json();

    const gate = data.flags.find((f: { key: string }) => f.key === 'capability_gate');
    expect(gate).toMatchObject({
      globalEnabled: false,
      override: true,
      effective: true,
      source: 'override',
    });

    const pull = data.flags.find((f: { key: string }) => f.key === 'usage_pull');
    expect(pull).toMatchObject({
      globalEnabled: false,
      override: null,
      effective: false,
      source: 'inherited',
    });
  });
});

describe('PUT — set an override', () => {
  it('400 on missing/invalid fields', async () => {
    expect((await PUT(req('PUT', { body: { key: 'x', enabled: true } }))).status).toBe(400); // no teamId
    expect((await PUT(req('PUT', { body: { teamId: 't', enabled: true } }))).status).toBe(400); // no key
    expect((await PUT(req('PUT', { body: { teamId: 't', key: 'x' } }))).status).toBe(400); // enabled not bool
  });

  it('404 for an unknown team', async () => {
    prisma.team.findUnique.mockResolvedValue(null);
    expect((await PUT(req('PUT', { body: { teamId: 'nope', key: 'capability_gate', enabled: true } }))).status).toBe(404);
  });

  it('200 upserts the override, audits, and records updatedBy', async () => {
    prisma.featureFlagOverride.upsert.mockResolvedValue({ id: 'o1', teamId: 'team-1', flagKey: 'capability_gate', enabled: true });
    const res = await PUT(req('PUT', { body: { teamId: 'team-1', key: 'capability_gate', enabled: true } }));
    expect(res.status).toBe(200);
    expect(prisma.featureFlagOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId_flagKey: { teamId: 'team-1', flagKey: 'capability_gate' } },
        update: { enabled: true, updatedBy: 'admin-1' },
        create: { teamId: 'team-1', flagKey: 'capability_gate', enabled: true, updatedBy: 'admin-1' },
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE — clear an override (inherit)', () => {
  it('400 on missing fields', async () => {
    expect((await DELETE(req('DELETE', { body: { teamId: 't' } }))).status).toBe(400);
    expect((await DELETE(req('DELETE', { body: { key: 'x' } }))).status).toBe(400);
  });

  it('200 idempotent clear, audits', async () => {
    prisma.featureFlagOverride.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(req('DELETE', { body: { teamId: 'team-1', key: 'capability_gate' } }));
    expect(res.status).toBe(200);
    expect(prisma.featureFlagOverride.deleteMany).toHaveBeenCalledWith({
      where: { teamId: 'team-1', flagKey: 'capability_gate' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
