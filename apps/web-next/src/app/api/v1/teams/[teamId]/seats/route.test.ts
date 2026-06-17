/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
}));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

const validateTeamAccess = vi.fn();
vi.mock('@/lib/api/teams', () => ({
  validateTeamAccess: (...a: unknown[]) => validateTeamAccess(...a),
}));

vi.mock('@/lib/api/csrf', () => ({ validateCSRF: vi.fn(() => null) }));

const prisma = vi.hoisted(() => ({
  seat: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

function req(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    headers: { cookie: 'naap_auth_token=tok', 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const params = (teamId: string) => ({ params: Promise.resolve({ teamId }) });

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  validateSession.mockResolvedValue({ id: 'user-1', email: 'u@example.com', roles: [] });
  validateTeamAccess.mockResolvedValue({ team: { id: 'team-1' }, member: { role: 'admin' } });
  prisma.seat.findMany.mockResolvedValue([]);
  prisma.seat.findUnique.mockResolvedValue(null);
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.seat.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'seat-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  }));
});

describe('flag OFF (zero regression)', () => {
  it('GET is a no-op 404 and never touches DB/auth', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(req('http://localhost/api/v1/teams/team-1/seats'), params('team-1'));
    expect(res.status).toBe(404);
    expect(validateSession).not.toHaveBeenCalled();
    expect(prisma.seat.findMany).not.toHaveBeenCalled();
  });
  it('POST is a no-op 404 when OFF', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await POST(
      req('http://localhost/api/v1/teams/team-1/seats', { method: 'POST', body: { email: 'a@b.co' } }),
      params('team-1'),
    );
    expect(res.status).toBe(404);
    expect(prisma.seat.create).not.toHaveBeenCalled();
  });
});

describe('GET seats (flag ON)', () => {
  it('401 without a token', async () => {
    const res = await GET(new NextRequest('http://localhost/api/v1/teams/team-1/seats'), params('team-1'));
    expect(res.status).toBe(401);
  });
  it('403 when not a team member', async () => {
    validateTeamAccess.mockRejectedValue(new Error('Not a member of this team'));
    const res = await GET(req('http://localhost/api/v1/teams/team-1/seats'), params('team-1'));
    expect(res.status).toBe(403);
  });
  it('lists seats for a member', async () => {
    prisma.seat.findMany.mockResolvedValue([{ id: 'seat-1', teamId: 'team-1', role: 'member' }]);
    const res = await GET(req('http://localhost/api/v1/teams/team-1/seats'), params('team-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.seats).toHaveLength(1);
    expect(validateTeamAccess).toHaveBeenCalledWith('user-1', 'team-1', 'viewer');
  });
});

describe('POST seats (flag ON)', () => {
  it('requires admin role', async () => {
    validateTeamAccess.mockRejectedValue(new Error('Requires admin role or higher'));
    const res = await POST(
      req('http://localhost/api/v1/teams/team-1/seats', { method: 'POST', body: { email: 'a@b.co' } }),
      params('team-1'),
    );
    expect(res.status).toBe(403);
  });
  it('400 when neither email nor userId provided', async () => {
    const res = await POST(
      req('http://localhost/api/v1/teams/team-1/seats', { method: 'POST', body: { role: 'member' } }),
      params('team-1'),
    );
    expect(res.status).toBe(400);
  });
  it('400 for an invalid role', async () => {
    const res = await POST(
      req('http://localhost/api/v1/teams/team-1/seats', { method: 'POST', body: { email: 'a@b.co', role: 'owner' } }),
      params('team-1'),
    );
    expect(res.status).toBe(400);
  });
  it('creates a PENDING invite seat when the email is unknown', async () => {
    const res = await POST(
      req('http://localhost/api/v1/teams/team-1/seats', { method: 'POST', body: { email: 'new@b.co', role: 'member' } }),
      params('team-1'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.seat.status).toBe('pending');
    const createArg = prisma.seat.create.mock.calls[0][0].data;
    expect(createArg.userId).toBeNull();
    expect(createArg.inviteToken).toBeTruthy();
  });
  it('creates an ACTIVE seat for an existing user and rejects duplicates', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    const res = await POST(
      req('http://localhost/api/v1/teams/team-1/seats', { method: 'POST', body: { email: 'known@b.co' } }),
      params('team-1'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.seat.status).toBe('active');

    // duplicate
    prisma.seat.findUnique.mockResolvedValue({ id: 'seat-existing' });
    const dup = await POST(
      req('http://localhost/api/v1/teams/team-1/seats', { method: 'POST', body: { email: 'known@b.co' } }),
      params('team-1'),
    );
    expect(dup.status).toBe(409);
  });
});
