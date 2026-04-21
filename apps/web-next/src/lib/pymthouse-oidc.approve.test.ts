import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { approvePymthouseDeviceCode } from './pymthouse-oidc';

describe('approvePymthouseDeviceCode', () => {
  const env: Record<string, string | undefined> = {};

  beforeEach(() => {
    env.PYMTHOUSE_ISSUER_URL = process.env.PYMTHOUSE_ISSUER_URL;
    env.PMTHOUSE_CLIENT_ID = process.env.PMTHOUSE_CLIENT_ID;
    env.PMTHOUSE_M2M_CLIENT_ID = process.env.PMTHOUSE_M2M_CLIENT_ID;
    env.PMTHOUSE_M2M_CLIENT_SECRET = process.env.PMTHOUSE_M2M_CLIENT_SECRET;
    env.PMTHOUSE_BASE_URL = process.env.PMTHOUSE_BASE_URL;

    process.env.PYMTHOUSE_ISSUER_URL = 'http://localhost:3001/api/v1/oidc';
    process.env.PMTHOUSE_CLIENT_ID = 'app_pub1';
    process.env.PMTHOUSE_M2M_CLIENT_ID = 'm2m_sec1';
    process.env.PMTHOUSE_M2M_CLIENT_SECRET = 'secret';
    process.env.PMTHOUSE_BASE_URL = 'http://localhost:3001';

    vi.stubGlobal(
      'fetch',
      vi.fn(),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.PYMTHOUSE_ISSUER_URL = env.PYMTHOUSE_ISSUER_URL;
    process.env.PMTHOUSE_CLIENT_ID = env.PMTHOUSE_CLIENT_ID;
    process.env.PMTHOUSE_M2M_CLIENT_ID = env.PMTHOUSE_M2M_CLIENT_ID;
    process.env.PMTHOUSE_M2M_CLIENT_SECRET = env.PMTHOUSE_M2M_CLIENT_SECRET;
    process.env.PMTHOUSE_BASE_URL = env.PMTHOUSE_BASE_URL;
  });

  it('mints a user JWT then POSTs token-exchange with urn:pmth:device_code resource', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'SUBJECT.JWT.HERE',
            token_type: 'Bearer',
            expires_in: 900,
            scope: 'sign:job',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'returned' }), { status: 200 }),
      );

    const result = await approvePymthouseDeviceCode({
      publicClientId: 'app_pub1',
      userCode: 'ABCD-EFGH',
      externalUserId: 'user-1',
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const tokenExchangeUrl = fetchMock.mock.calls[2]?.[0];
    expect(tokenExchangeUrl).toBe('http://localhost:3001/api/v1/oidc/token');

    const init = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const body = String(init?.body ?? '');
    expect(body).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange',
    );
    expect(body).toContain('subject_token=SUBJECT.JWT.HERE');
    expect(body).toContain('urn%3Apmth%3Adevice_code%3AABCD-EFGH');
  });
});
