/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthUser } from '@naap/types';

import { GET, POST } from './route';
import { AdapterNotImplementedError } from '@/lib/billing/adapter';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
}));

// NAAP-A-db: the route resolves adapters via the DB-driven resolver, which
// falls back to the static registry when the flag is OFF. Mock the resolver and
// return the static-source shape so these tests stay registry-agnostic.
const resolveBillingProviderAdapterDetailed = vi.fn();
vi.mock('@/lib/billing/registry-db', () => ({
  resolveBillingProviderAdapterDetailed: (...a: unknown[]) =>
    resolveBillingProviderAdapterDetailed(...a),
}));

function setResolvedAdapter(adapter: unknown): void {
  resolveBillingProviderAdapterDetailed.mockResolvedValue({
    adapter,
    source: 'static',
    adapterType: null,
  });
}

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  validateSession: (...a: unknown[]) => validateSession(...a),
}));

vi.mock('@/lib/api/csrf', () => ({ validateCSRF: vi.fn(() => null) }));
vi.mock('@/lib/api/rate-limit', () => ({ enforceRateLimit: vi.fn(() => null) }));

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'u@example.com',
    displayName: null,
    avatarUrl: null,
    address: null,
    roles: [],
    permissions: [],
    ...overrides,
  };
}

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'pymthouse',
    isConfigured: vi.fn(() => true),
    validate: vi.fn(),
    getPlans: vi.fn(),
    getUsageForExternalUser: vi.fn(async () => ({ requestCount: 1 })),
    getAppUsage: vi.fn(async () => ({ totals: { requestCount: 0 } })),
    mintSignerSession: vi.fn(async () => ({
      accessToken: 'tok-abc',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'sign:job',
    })),
    receiveCuratedOrchestrators: vi.fn(),
    getCapabilityManifest: vi.fn(),
    ...overrides,
  };
}

function req(
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    headers: { cookie: 'naap_auth_token=tok', ...(init?.headers ?? {}) },
  });
}

function params(provider: string, path: string[]) {
  return { params: Promise.resolve({ provider, path }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  validateSession.mockResolvedValue(authUser());
  setResolvedAdapter(makeAdapter());
});

describe('generic /api/v1/billing/{provider}/* — flag OFF (zero regression)', () => {
  it('is a no-op 404 when provider_adapters is OFF', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(
      req('http://localhost/api/v1/billing/pymthouse/usage'),
      params('pymthouse', ['usage']),
    );
    expect(res.status).toBe(404);
    expect(resolveBillingProviderAdapterDetailed).not.toHaveBeenCalled();
    expect(validateSession).not.toHaveBeenCalled();
  });
});

describe('generic billing route — flag ON', () => {
  it('404s for an unknown provider', async () => {
    setResolvedAdapter(undefined);
    const res = await GET(
      req('http://localhost/api/v1/billing/nope/usage'),
      params('nope', ['usage']),
    );
    expect(res.status).toBe(404);
  });

  it('404s for an invalid provider slug', async () => {
    const res = await GET(
      req('http://localhost/api/v1/billing/Bad_Slug/usage'),
      params('Bad_Slug', ['usage']),
    );
    expect(res.status).toBe(404);
    expect(resolveBillingProviderAdapterDetailed).not.toHaveBeenCalled();
  });

  it('401 without an auth token', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/v1/billing/pymthouse/usage'),
      params('pymthouse', ['usage']),
    );
    expect(res.status).toBe(401);
  });

  it('delegates usage scope=me to the adapter', async () => {
    const adapter = makeAdapter();
    setResolvedAdapter(adapter);
    const res = await GET(
      req('http://localhost/api/v1/billing/pymthouse/usage?scope=me'),
      params('pymthouse', ['usage']),
    );
    expect(res.status).toBe(200);
    expect(adapter.getUsageForExternalUser).toHaveBeenCalledWith(
      expect.objectContaining({ externalUserId: 'user-1' }),
    );
  });

  it('403 for app scope when not system:admin', async () => {
    const res = await GET(
      req('http://localhost/api/v1/billing/pymthouse/usage?scope=app'),
      params('pymthouse', ['usage']),
    );
    expect(res.status).toBe(403);
  });

  it('delegates token mint to the adapter and returns the session', async () => {
    const adapter = makeAdapter();
    setResolvedAdapter(adapter);
    const res = await POST(
      req('http://localhost/api/v1/billing/pymthouse/token', { method: 'POST' }),
      params('pymthouse', ['token']),
    );
    expect(res.status).toBe(200);
    expect(adapter.mintSignerSession).toHaveBeenCalledWith(
      expect.objectContaining({ externalUserId: 'user-1' }),
    );
    const json = await res.json();
    expect(json.data.access_token).toBe('tok-abc');
  });

  it('maps AdapterNotImplementedError to 501', async () => {
    const adapter = makeAdapter({
      mintSignerSession: vi.fn(async () => {
        throw new AdapterNotImplementedError('pymthouse', 'mintSignerSession');
      }),
    });
    setResolvedAdapter(adapter);
    const res = await POST(
      req('http://localhost/api/v1/billing/pymthouse/token', { method: 'POST' }),
      params('pymthouse', ['token']),
    );
    expect(res.status).toBe(501);
  });

  it('404s for an unsupported operation', async () => {
    const res = await GET(
      req('http://localhost/api/v1/billing/pymthouse/unknown-op'),
      params('pymthouse', ['unknown-op']),
    );
    expect(res.status).toBe(404);
  });

  it('400 when the provider is not configured', async () => {
    setResolvedAdapter(makeAdapter({ isConfigured: vi.fn(() => false) }));
    const res = await GET(
      req('http://localhost/api/v1/billing/pymthouse/usage'),
      params('pymthouse', ['usage']),
    );
    expect(res.status).toBe(400);
  });
});
