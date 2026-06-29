/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prisma = vi.hoisted(() => ({
  team: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

import { GET } from './route';

const ADMIN = { id: 'admin-1', roles: ['system:admin'] };

function req(url: string, token: string | null = 'tok'): NextRequest {
  return new NextRequest(url, {
    method: 'GET',
    headers: token !== null ? { authorization: `Bearer ${token}` } : {},
  });
}

const BASE = 'http://localhost/api/v1/admin/feature-flag-overrides/teams';

beforeEach(() => {
  vi.clearAllMocks();
  validateSession.mockResolvedValue(ADMIN);
  prisma.team.findMany.mockResolvedValue([
    { id: 't1', name: 'Acme', slug: 'acme', _count: { featureFlagOverrides: 2 } },
    { id: 't2', name: 'Globex', slug: 'globex', _count: { featureFlagOverrides: 0 } },
  ]);
});

describe('GET teams list', () => {
  it('401 without a token', async () => {
    expect((await GET(req(BASE, null))).status).toBe(401);
  });

  it('403 for a non-admin', async () => {
    validateSession.mockResolvedValue({ id: 'u', roles: ['user'] });
    expect((await GET(req(BASE))).status).toBe(403);
  });

  it('200 returns teams with override counts', async () => {
    const res = await GET(req(BASE));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.teams).toEqual([
      { id: 't1', name: 'Acme', slug: 'acme', overrideCount: 2 },
      { id: 't2', name: 'Globex', slug: 'globex', overrideCount: 0 },
    ]);
  });

  it('passes a case-insensitive name/slug search filter', async () => {
    await GET(req(`${BASE}?q=acme`));
    expect(prisma.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'acme', mode: 'insensitive' } },
            { slug: { contains: 'acme', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });
});
