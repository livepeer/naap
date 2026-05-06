/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const upsertAppUser = vi.fn().mockResolvedValue(undefined);
  const mintUserAccessToken = vi.fn().mockResolvedValue({
    access_token: 'SUBJECT.JWT.HERE',
    token_type: 'Bearer' as const,
    expires_in: 900,
    scope: 'sign:job',
    refresh_token: 'r',
    subject_type: 'app_user' as const,
  });
  const exchangeForSignerSession = vi.fn().mockResolvedValue({
    access_token: 'pmth_testopaque',
    token_type: 'Bearer' as const,
    expires_in: 7776000,
    scope: 'sign:job',
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  });
  const mintUserSignerSessionToken = vi.fn().mockResolvedValue({
    access_token: 'pmth_testopaque',
    token_type: 'Bearer' as const,
    expires_in: 7776000,
    scope: 'sign:job',
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  });
  return {
    upsertAppUser,
    mintUserAccessToken,
    exchangeForSignerSession,
    mintUserSignerSessionToken,
  };
});

vi.mock('@/lib/pymthouse-client', () => ({
  getPmtHouseServerClient: vi.fn(() => ({
    upsertAppUser: mocks.upsertAppUser,
    mintUserAccessToken: mocks.mintUserAccessToken,
    exchangeForSignerSession: mocks.exchangeForSignerSession,
    mintUserSignerSessionToken: mocks.mintUserSignerSessionToken,
  })),
  resetPmtHouseServerClientForTests: vi.fn(),
}));

import {
  exchangePymthouseUserTokenForSignerSession,
  mintPymthouseSignerSessionForNaapUser,
} from './pymthouse-oidc';

describe('exchangePymthouseUserTokenForSignerSession', () => {
  const env: Record<string, string | undefined> = {};

  beforeEach(() => {
    env.PYMTHOUSE_ISSUER_URL = process.env.PYMTHOUSE_ISSUER_URL;
    env.PYMTHOUSE_PUBLIC_CLIENT_ID = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID;
    env.PYMTHOUSE_M2M_CLIENT_ID = process.env.PYMTHOUSE_M2M_CLIENT_ID;
    env.PYMTHOUSE_M2M_CLIENT_SECRET = process.env.PYMTHOUSE_M2M_CLIENT_SECRET;

    process.env.PYMTHOUSE_ISSUER_URL = 'http://localhost:3001/api/v1/oidc';
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = 'app_pub1';
    process.env.PYMTHOUSE_M2M_CLIENT_ID = 'm2m_sec1';
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET = 'secret';

    mocks.exchangeForSignerSession.mockResolvedValue({
      access_token: 'pmth_testopaque',
      token_type: 'Bearer' as const,
      expires_in: 7776000,
      scope: 'sign:job',
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
    mocks.mintUserSignerSessionToken.mockResolvedValue({
      access_token: 'pmth_testopaque',
      token_type: 'Bearer' as const,
      expires_in: 7776000,
      scope: 'sign:job',
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env.PYMTHOUSE_ISSUER_URL = env.PYMTHOUSE_ISSUER_URL;
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = env.PYMTHOUSE_PUBLIC_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_ID = env.PYMTHOUSE_M2M_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET = env.PYMTHOUSE_M2M_CLIENT_SECRET;
  });

  it('delegates RFC 8693 signer session exchange to the Builder API client', async () => {
    const out = await exchangePymthouseUserTokenForSignerSession('short-lived-jwt');

    expect(out.accessToken).toBe('pmth_testopaque');
    expect(out.expiresIn).toBe(7776000);
    expect(out.scope).toBe('sign:job');
    expect(mocks.exchangeForSignerSession).toHaveBeenCalledWith({
      userJwt: 'short-lived-jwt',
      resource: 'http://localhost:3001/api/v1/oidc',
    });
  });

  it('rejects JWT-shaped access_token from exchange', async () => {
    mocks.exchangeForSignerSession.mockResolvedValue({
      access_token: 'eyJhbGciOiJIUzI1NiJ9.e30.sig',
      token_type: 'Bearer' as const,
      expires_in: 900,
      scope: 'sign:job',
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });

    await expect(
      exchangePymthouseUserTokenForSignerSession('short-lived-jwt'),
    ).rejects.toThrow(/opaque signer session/);
  });

  it('delegates durable signer session mint to the Builder API client', async () => {
    const out = await mintPymthouseSignerSessionForNaapUser('user-1');

    expect(out.accessToken).toBe('pmth_testopaque');
    expect(out.accessToken).not.toContain('SUBJECT');
    expect(mocks.upsertAppUser).toHaveBeenCalledWith({
      externalUserId: 'user-1',
      email: undefined,
      status: 'active',
    });
    expect(mocks.mintUserSignerSessionToken).toHaveBeenCalledWith({
      externalUserId: 'user-1',
      scope: 'sign:job',
      resource: 'http://localhost:3001/api/v1/oidc',
    });
    expect(mocks.mintUserAccessToken).not.toHaveBeenCalled();
    expect(mocks.exchangeForSignerSession).not.toHaveBeenCalled();
  });
});
