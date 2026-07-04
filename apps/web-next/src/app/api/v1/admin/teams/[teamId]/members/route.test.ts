/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  ADMIN_TEAM_ACCESS_FLAG: 'admin_team_access',
}));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

const validateCSRF = vi.fn();
vi.mock('@/lib/api/csrf', () => ({ validateCSRF: (...a: unknown[]) => validateCSRF(...a) }));

const adminAddMember = vi.fn();
const listMembers = vi.fn();
vi.mock('@/lib/api/teams', () => ({
  adminAddMember: (...a: unknown[]) => adminAddMember(...a),
  listMembers: (...a: unknown[]) => listMembers(...a),
}));

const prisma = vi.hoisted(() => ({
  team: { findUnique: vi.fn() },
  teamPluginInstall: { findMany: vi.fn() },
  teamMemberPluginAccess: { createMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

import { GET, POST } from './route';

const ADMIN = { id: 'admin-1', roles: ['system:admin'] };
const TEAM = 'team-1';
const BASE = `http://localhost/api/v1/admin/teams/${TEAM}/members`;

function req(init?: { method?: string; body?: unknown; token?: string | null }): NextRequest {
  const token = init?.token === undefined ? 'tok' : init.token;
  return new NextRequest(BASE, {
    method: init?.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const params = { params: Promise.resolve({ teamId: TEAM }) };

const CREATED_MEMBER = {
  id: 'm-1',
  userId: 'u-target',
  role: 'member',
  user: { id: 'u-target', email: 'new@x.io', displayName: null, avatarUrl: null },
  joinedAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true); // flag ON by default
  validateSession.mockResolvedValue(ADMIN);
  validateCSRF.mockReturnValue(null);
  prisma.team.findUnique.mockResolvedValue({ id: TEAM });
  prisma.teamPluginInstall.findMany.mockResolvedValue([]);
  prisma.teamMemberPluginAccess.createMany.mockResolvedValue({ count: 0 });
  prisma.auditLog.create.mockResolvedValue({});
  adminAddMember.mockResolvedValue(CREATED_MEMBER);
  listMembers.mockResolvedValue([CREATED_MEMBER]);
});

describe('authorization (independent of the flag)', () => {
  it('POST 401 without a token', async () => {
    const res = await POST(req({ method: 'POST', token: null, body: { email: 'a@x.io', role: 'member' } }), params);
    expect(res.status).toBe(401);
    expect(adminAddMember).not.toHaveBeenCalled();
  });

  it('POST 403 for a non-admin — even when the flag is ON', async () => {
    validateSession.mockResolvedValue({ id: 'u', roles: ['user'] });
    const res = await POST(req({ method: 'POST', body: { email: 'a@x.io', role: 'member' } }), params);
    expect(res.status).toBe(403);
    expect(adminAddMember).not.toHaveBeenCalled();
  });

  it('GET 403 for a non-admin', async () => {
    validateSession.mockResolvedValue({ id: 'u', roles: ['user'] });
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
    expect(listMembers).not.toHaveBeenCalled();
  });
});

describe('flag OFF — zero-regression no-op (blocked)', () => {
  beforeEach(() => isFeatureEnabled.mockResolvedValue(false));

  it('admin POST is blocked with 404 and never creates', async () => {
    const res = await POST(req({ method: 'POST', body: { email: 'a@x.io', role: 'member' } }), params);
    expect(res.status).toBe(404);
    expect(adminAddMember).not.toHaveBeenCalled();
  });

  it('admin GET is blocked with 404 and never lists', async () => {
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
    expect(listMembers).not.toHaveBeenCalled();
  });

  it('non-admin still gets 403 (auth precedes the flag)', async () => {
    validateSession.mockResolvedValue({ id: 'u', roles: ['user'] });
    const res = await POST(req({ method: 'POST', body: { email: 'a@x.io', role: 'member' } }), params);
    expect(res.status).toBe(403);
  });
});

describe('flag ON — admin path succeeds', () => {
  it('adds a member with the exact inviteMember row shape and audits', async () => {
    const res = await POST(req({ method: 'POST', body: { email: 'new@x.io', role: 'member' } }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.member.id).toBe('m-1');

    expect(adminAddMember).toHaveBeenCalledWith(TEAM, { email: 'new@x.io', role: 'member' }, ADMIN.id);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArg = prisma.auditLog.create.mock.calls[0][0].data;
    expect(auditArg.action).toBe('admin_team_member.add');
    expect(auditArg.resourceId).toBe(TEAM);
    expect(auditArg.userId).toBe(ADMIN.id);
    expect(auditArg.details).toMatchObject({ email: 'new@x.io', role: 'member', memberId: 'm-1' });
  });

  it('lists members for an admin', async () => {
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.members).toHaveLength(1);
    expect(listMembers).toHaveBeenCalledWith(TEAM, { skip: 0, take: 50 });
  });

  it('400 when email is missing', async () => {
    const res = await POST(req({ method: 'POST', body: { role: 'member' } }), params);
    expect(res.status).toBe(400);
    expect(adminAddMember).not.toHaveBeenCalled();
  });

  it('400 for an invalid role', async () => {
    const res = await POST(req({ method: 'POST', body: { email: 'a@x.io', role: 'owner' } }), params);
    expect(res.status).toBe(400);
    expect(adminAddMember).not.toHaveBeenCalled();
  });

  it('404 when the team does not exist', async () => {
    prisma.team.findUnique.mockResolvedValue(null);
    const res = await POST(req({ method: 'POST', body: { email: 'a@x.io', role: 'member' } }), params);
    expect(res.status).toBe(404);
  });

  it('409 when the user is already a member', async () => {
    adminAddMember.mockRejectedValue(new Error('User is already a member of this team'));
    const res = await POST(req({ method: 'POST', body: { email: 'a@x.io', role: 'member' } }), params);
    expect(res.status).toBe(409);
  });

  it('404 when the target user does not exist', async () => {
    adminAddMember.mockRejectedValue(new Error('User not found. They must register first.'));
    const res = await POST(req({ method: 'POST', body: { email: 'ghost@x.io', role: 'member' } }), params);
    expect(res.status).toBe(404);
  });
});

describe('CSRF', () => {
  it('POST is rejected when CSRF validation fails (before any mutation)', async () => {
    const { errors } = await import('@/lib/api/response');
    validateCSRF.mockReturnValue(errors.forbidden('CSRF token required'));
    const res = await POST(req({ method: 'POST', body: { email: 'a@x.io', role: 'member' } }), params);
    expect(res.status).toBe(403);
    expect(adminAddMember).not.toHaveBeenCalled();
  });
});
