import { describe, it, expect, vi, beforeEach } from 'vitest';
// Stub `server-only` so we can import the module under test.
vi.mock('server-only', () => ({}));
import { NextRequest } from 'next/server';

// Mock the auth module
vi.mock('@/lib/api/auth', () => ({
  validateSession: vi.fn(),
}));

import { resolveAgentbookTenant, safeResolveAgentbookTenant } from '../agentbook-tenant';
import { validateSession } from '@/lib/api/auth';

const mockValidateSession = vi.mocked(validateSession);

function makeRequest(opts: { headers?: Record<string, string>; cookie?: string; url?: string } = {}): NextRequest {
  const url = opts.url || 'http://localhost/api/v1/agentbook/test';
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new NextRequest(url, { headers });
}

describe('resolveAgentbookTenant', () => {
  beforeEach(() => {
    mockValidateSession.mockReset();
    delete process.env.CRON_SECRET;
  });

  it('rejects request with no auth (no cookie, no cron)', async () => {
    const req = makeRequest();
    try {
      await resolveAgentbookTenant(req);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(401);
    }
  });

  it('rejects request with x-tenant-id header but no auth', async () => {
    const req = makeRequest({ headers: { 'x-tenant-id': 'attacker-tenant' } });
    try {
      await resolveAgentbookTenant(req);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(401);
    }
  });

  it('rejects request with ab-tenant cookie but no session', async () => {
    const req = makeRequest({ cookie: 'ab-tenant=attacker-tenant' });
    try {
      await resolveAgentbookTenant(req);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(401);
    }
  });

  it('rejects request with invalid session token', async () => {
    mockValidateSession.mockResolvedValue(null);
    const req = makeRequest({ cookie: 'naap_auth_token=bad-token' });
    try {
      await resolveAgentbookTenant(req);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(401);
    }
  });

  it('returns user.id with valid session', async () => {
    mockValidateSession.mockResolvedValue({ id: 'user-A', email: 'maya@x.com' } as any);
    const req = makeRequest({ cookie: 'naap_auth_token=valid' });
    const result = await resolveAgentbookTenant(req);
    expect(result).toBe('user-A');
  });

  it('accepts vercel cron header + x-tenant-id', async () => {
    const req = makeRequest({ headers: { 'x-vercel-cron': '1', 'x-tenant-id': 'tenant-A' } });
    const result = await resolveAgentbookTenant(req);
    expect(result).toBe('tenant-A');
  });

  it('rejects vercel cron header WITHOUT x-tenant-id', async () => {
    const req = makeRequest({ headers: { 'x-vercel-cron': '1' } });
    try {
      await resolveAgentbookTenant(req);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(400);
    }
  });

  it('accepts CRON_SECRET bearer + x-tenant-id', async () => {
    process.env.CRON_SECRET = 'shh';
    const req = makeRequest({ headers: { authorization: 'Bearer shh', 'x-tenant-id': 'tenant-B' } });
    const result = await resolveAgentbookTenant(req);
    expect(result).toBe('tenant-B');
  });

  it('accepts CRON_SECRET via ?secret= query param', async () => {
    process.env.CRON_SECRET = 'shh';
    const req = makeRequest({ url: 'http://localhost/api/foo?secret=shh', headers: { 'x-tenant-id': 'tenant-C' } });
    const result = await resolveAgentbookTenant(req);
    expect(result).toBe('tenant-C');
  });

  it('rejects wrong CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'shh';
    const req = makeRequest({ headers: { authorization: 'Bearer wrong', 'x-tenant-id': 'tenant-A' } });
    try {
      await resolveAgentbookTenant(req);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(401);
    }
  });
});

describe('safeResolveAgentbookTenant', () => {
  beforeEach(() => {
    mockValidateSession.mockReset();
    delete process.env.CRON_SECRET;
  });

  it('returns { tenantId } on success', async () => {
    mockValidateSession.mockResolvedValue({ id: 'user-A' } as any);
    const req = makeRequest({ cookie: 'naap_auth_token=valid' });
    const result = await safeResolveAgentbookTenant(req);
    expect(result).toEqual({ tenantId: 'user-A' });
  });

  it('returns { response } on auth failure', async () => {
    const req = makeRequest();
    const result = await safeResolveAgentbookTenant(req);
    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(401);
    }
  });
});
