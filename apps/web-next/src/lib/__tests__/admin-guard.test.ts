import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/auth', () => ({
  validateSession: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { requireAdmin, redactApiKey } from '../admin-guard';
import { validateSession } from '@/lib/api/auth';

const mockValidateSession = vi.mocked(validateSession);

function makeReq(opts: { cookie?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new NextRequest('http://localhost/admin/anything', { headers });
}

describe('redactApiKey', () => {
  it('returns **** for null/undefined/empty', () => {
    expect(redactApiKey(null)).toBe('****');
    expect(redactApiKey(undefined)).toBe('****');
    expect(redactApiKey('')).toBe('****');
  });

  it('returns **** for very short keys (<=4 chars)', () => {
    expect(redactApiKey('abc')).toBe('****');
    expect(redactApiKey('abcd')).toBe('****');
  });

  it('redacts to last 4 chars', () => {
    expect(redactApiKey('sk-1234567890ABCDEF')).toBe('****CDEF');
    expect(redactApiKey('long-key-here-XYZW')).toBe('****XYZW');
  });
});

describe('requireAdmin', () => {
  beforeEach(() => {
    mockValidateSession.mockReset();
    process.env.ADMIN_EMAILS = 'admin@a3p.io,owner@a3p.io';
  });

  it('rejects unauthenticated request (401)', async () => {
    const result = await requireAdmin(makeReq());
    expect('response' in result).toBe(true);
    if ('response' in result) expect(result.response.status).toBe(401);
  });

  it('rejects authenticated non-admin user (403)', async () => {
    mockValidateSession.mockResolvedValue({ id: 'user-A', email: 'maya@x.com', roles: ['user'] } as never);
    const result = await requireAdmin(makeReq({ cookie: 'naap_auth_token=valid' }));
    expect('response' in result).toBe(true);
    if ('response' in result) expect(result.response.status).toBe(403);
  });

  it('rejects when session is invalid (returns null)', async () => {
    mockValidateSession.mockResolvedValue(null);
    const result = await requireAdmin(makeReq({ cookie: 'naap_auth_token=garbage' }));
    expect('response' in result).toBe(true);
    if ('response' in result) expect(result.response.status).toBe(401);
  });

  it('accepts admin by email allowlist', async () => {
    mockValidateSession.mockResolvedValue({ id: 'admin-user', email: 'admin@a3p.io', roles: [] } as never);
    const result = await requireAdmin(makeReq({ cookie: 'naap_auth_token=valid' }));
    expect('user' in result).toBe(true);
    if ('user' in result) {
      expect(result.user.email).toBe('admin@a3p.io');
      expect(result.tenantId).toBe('admin-user');
    }
  });

  it("accepts admin by AuthUser.roles 'admin'", async () => {
    mockValidateSession.mockResolvedValue({ id: 'role-admin', email: 'other@x.com', roles: ['admin'] } as never);
    const result = await requireAdmin(makeReq({ cookie: 'naap_auth_token=valid' }));
    expect('user' in result).toBe(true);
  });

  it("accepts admin by AuthUser.roles 'system:admin'", async () => {
    mockValidateSession.mockResolvedValue({ id: 'sys-admin', email: 'other@x.com', roles: ['system:admin'] } as never);
    const result = await requireAdmin(makeReq({ cookie: 'naap_auth_token=valid' }));
    expect('user' in result).toBe(true);
  });

  it('case-insensitive email allowlist', async () => {
    mockValidateSession.mockResolvedValue({ id: 'admin-user', email: 'ADMIN@A3P.IO', roles: [] } as never);
    const result = await requireAdmin(makeReq({ cookie: 'naap_auth_token=valid' }));
    expect('user' in result).toBe(true);
  });

  it('rejects when ADMIN_EMAILS is unset and roles lack admin', async () => {
    process.env.ADMIN_EMAILS = '';
    mockValidateSession.mockResolvedValue({ id: 'user-A', email: 'maya@x.com', roles: ['user'] } as never);
    const result = await requireAdmin(makeReq({ cookie: 'naap_auth_token=valid' }));
    expect('response' in result).toBe(true);
    if ('response' in result) expect(result.response.status).toBe(403);
  });
});
