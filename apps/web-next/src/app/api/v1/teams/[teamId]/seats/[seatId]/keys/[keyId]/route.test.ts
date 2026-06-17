/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { DELETE } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a) }));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

const validateTeamAccess = vi.fn();
vi.mock('@/lib/api/teams', () => ({ validateTeamAccess: (...a: unknown[]) => validateTeamAccess(...a) }));

vi.mock('@/lib/api/csrf', () => ({ validateCSRF: vi.fn(() => null) }));

const prisma = vi.hoisted(() => ({
  seat: { findFirst: vi.fn() },
  devApiKey: { findFirst: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

function req(): NextRequest {
  return new NextRequest('http://localhost/x', {
    method: 'DELETE',
    headers: { cookie: 'naap_auth_token=tok' },
  });
}

const params = (teamId: string, seatId: string, keyId: string) => ({
  params: Promise.resolve({ teamId, seatId, keyId }),
});

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  validateSession.mockResolvedValue({ id: 'user-1', roles: [] });
  validateTeamAccess.mockResolvedValue({ team: { id: 'team-1' }, member: { role: 'admin' } });
  prisma.seat.findFirst.mockResolvedValue({ id: 'seat-1', userId: 'user-1' });
  prisma.devApiKey.findFirst.mockResolvedValue({ id: 'key-1', status: 'ACTIVE' });
  prisma.devApiKey.update.mockResolvedValue({ id: 'key-1', status: 'REVOKED' });
});

describe('DELETE revoke native key', () => {
  it('404 no-op when flag OFF', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await DELETE(req(), params('team-1', 'seat-1', 'key-1'));
    expect(res.status).toBe(404);
    expect(prisma.devApiKey.update).not.toHaveBeenCalled();
  });

  it('revokes an active key (status → REVOKED)', async () => {
    const res = await DELETE(req(), params('team-1', 'seat-1', 'key-1'));
    expect(res.status).toBe(200);
    expect(prisma.devApiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVOKED' }) }),
    );
  });

  it('is idempotent for an already-revoked key', async () => {
    prisma.devApiKey.findFirst.mockResolvedValue({ id: 'key-1', status: 'REVOKED' });
    const res = await DELETE(req(), params('team-1', 'seat-1', 'key-1'));
    expect(res.status).toBe(200);
    expect(prisma.devApiKey.update).not.toHaveBeenCalled();
  });

  it('404 for an unknown key', async () => {
    prisma.devApiKey.findFirst.mockResolvedValue(null);
    const res = await DELETE(req(), params('team-1', 'seat-1', 'nope'));
    expect(res.status).toBe(404);
  });

  it('404 for an unknown seat', async () => {
    prisma.seat.findFirst.mockResolvedValue(null);
    const res = await DELETE(req(), params('team-1', 'nope', 'key-1'));
    expect(res.status).toBe(404);
  });
});
