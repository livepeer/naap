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
  const completeDeviceApproval = vi.fn().mockResolvedValue({
    access_token: 'exchanged',
    token_type: 'Bearer' as const,
    expires_in: 900,
    scope: 'sign:job',
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  });
  return { upsertAppUser, mintUserAccessToken, completeDeviceApproval };
});

vi.mock('@/lib/pymthouse-client', () => ({
  getPmtHouseServerClient: vi.fn(() => ({
    upsertAppUser: mocks.upsertAppUser,
    mintUserAccessToken: mocks.mintUserAccessToken,
    completeDeviceApproval: mocks.completeDeviceApproval,
  })),
  resetPmtHouseServerClientForTests: vi.fn(),
}));

import { approvePymthouseDeviceCode } from './pymthouse-oidc';

describe('approvePymthouseDeviceCode', () => {
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

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.PYMTHOUSE_ISSUER_URL = env.PYMTHOUSE_ISSUER_URL;
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = env.PYMTHOUSE_PUBLIC_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_ID = env.PYMTHOUSE_M2M_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET = env.PYMTHOUSE_M2M_CLIENT_SECRET;
  });

  it('upserts user, mints sign:job JWT, then completes device approval via SDK client', async () => {
    const result = await approvePymthouseDeviceCode({
      publicClientId: 'app_pub1',
      userCode: 'ABCD-EFGH',
      externalUserId: 'user-1',
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.upsertAppUser).toHaveBeenCalledWith({
      externalUserId: 'user-1',
      email: undefined,
      status: 'active',
    });
    expect(mocks.mintUserAccessToken).toHaveBeenCalledWith({
      externalUserId: 'user-1',
      scope: 'sign:job',
    });
    expect(mocks.completeDeviceApproval).toHaveBeenCalledWith({
      userJwt: 'SUBJECT.JWT.HERE',
      userCode: 'ABCD-EFGH',
    });
  });

  it('returns 400 when cookie public client id does not match configured public id', async () => {
    const result = await approvePymthouseDeviceCode({
      publicClientId: 'app_other',
      userCode: 'ABCD-EFGH',
      externalUserId: 'user-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.message).toContain('PYMTHOUSE_PUBLIC_CLIENT_ID');
    expect(mocks.completeDeviceApproval).not.toHaveBeenCalled();
  });
});
