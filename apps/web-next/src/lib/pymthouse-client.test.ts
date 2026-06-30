/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exchangeApiKeyForSignerSession, mintUserSignerJwtForExternalUser } from './pymthouse-client';

/** Minimal `PmtHouseClient` stub exposing only what the mint helper touches. */
function makeClient(
  overrides: Partial<{
    upsertAppUser: ReturnType<typeof vi.fn>;
    mintUserAccessToken: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    upsertAppUser: vi.fn().mockResolvedValue({ id: 'app-user-1' }),
    mintUserAccessToken: vi.fn().mockResolvedValue({
      access_token: 'eyJhbGciOiJSUzI1NiJ9.payload.sig',
      refresh_token: 'r',
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'sign:job',
      subject_type: 'app_user',
    }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mintUserSignerJwtForExternalUser (Builder user-token JWT for the remote signer DMZ)', () => {
  it('upserts the user then mints the Builder user-token, returning the JWT', async () => {
    const client = makeClient();

    const out = await mintUserSignerJwtForExternalUser({
      client: client as never,
      externalUserId: 'acct_user_42',
    });

    // Idempotent provision first so the mint never 404s on an unprovisioned user.
    expect(client.upsertAppUser).toHaveBeenCalledWith({
      externalUserId: 'acct_user_42',
      status: 'active',
    });
    // Builder user-token mint: POST /users/{id}/token with scope sign:job.
    expect(client.mintUserAccessToken).toHaveBeenCalledWith({
      externalUserId: 'acct_user_42',
      scope: 'sign:job',
    });
    expect(out.jwt).toBe('eyJhbGciOiJSUzI1NiJ9.payload.sig');
    expect(out.expiresIn).toBe(900);
    expect(out.scope).toBe('sign:job');
  });

  it('passes an email through to the upsert when provided', async () => {
    const client = makeClient();

    await mintUserSignerJwtForExternalUser({
      client: client as never,
      externalUserId: 'acct_user_42',
      email: 'user@example.com',
    });

    expect(client.upsertAppUser).toHaveBeenCalledWith({
      externalUserId: 'acct_user_42',
      email: 'user@example.com',
      status: 'active',
    });
  });

  it('honors an explicit scope override (and falls back to it when the response omits scope)', async () => {
    const client = makeClient({
      mintUserAccessToken: vi.fn().mockResolvedValue({
        access_token: 'eyJ.x.y',
        expires_in: 60,
        scope: '',
      }),
    });

    const out = await mintUserSignerJwtForExternalUser({
      client: client as never,
      externalUserId: 'acct_user_42',
      scope: 'sign:job extra:scope',
    });

    expect(client.mintUserAccessToken).toHaveBeenCalledWith({
      externalUserId: 'acct_user_42',
      scope: 'sign:job extra:scope',
    });
    expect(out.scope).toBe('sign:job extra:scope');
  });

  it('clamps a non-positive / invalid expires_in to a safe default TTL', async () => {
    const client = makeClient({
      mintUserAccessToken: vi.fn().mockResolvedValue({
        access_token: 'eyJ.x.y',
        expires_in: 0,
        scope: 'sign:job',
      }),
    });

    const out = await mintUserSignerJwtForExternalUser({
      client: client as never,
      externalUserId: 'acct_user_42',
    });
    expect(out.expiresIn).toBe(300);
  });

  it('propagates a mint failure (front door fails safe on this)', async () => {
    const client = makeClient({
      mintUserAccessToken: vi.fn().mockRejectedValue(new Error('mint boom')),
    });

    await expect(
      mintUserSignerJwtForExternalUser({ client: client as never, externalUserId: 'acct_user_42' }),
    ).rejects.toThrow('mint boom');
  });

  it('propagates an upsert failure (no mint attempted)', async () => {
    const client = makeClient({
      upsertAppUser: vi.fn().mockRejectedValue(new Error('upsert boom')),
    });

    await expect(
      mintUserSignerJwtForExternalUser({ client: client as never, externalUserId: 'acct_user_42' }),
    ).rejects.toThrow('upsert boom');
    expect(client.mintUserAccessToken).not.toHaveBeenCalled();
  });
});

describe('exchangeApiKeyForSignerSession (POST /api/v1/apps/{clientId}/auth/api-key/signer-session)', () => {
  function mockFetch(
    response: { ok?: boolean; status?: number; json: () => Promise<unknown> },
  ): ReturnType<typeof vi.fn> {
    const fn = vi.fn().mockResolvedValue({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: response.json,
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the api key as Bearer with scope body and parses the nested token envelope', async () => {
    // Canonical example-client envelope: { token: { accessToken }, signerUrl }.
    const fetchMock = mockFetch({
      json: async () => ({
        token: { accessToken: 'eyJhbGciOiJSUzI1NiJ9.signer.sig' },
        signerUrl: 'https://signer-dmz.pymthouse.com',
        expires_in: 900,
        scope: 'sign:job',
      }),
    });

    const out = await exchangeApiKeyForSignerSession({
      billingUrl: 'https://pymthouse.com',
      clientId: 'app_973064',
      apiKey: 'pmth_test_key',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://pymthouse.com/api/v1/apps/app_973064/auth/api-key/signer-session');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer pmth_test_key',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({ scope: 'sign:job' });

    expect(out).toEqual({
      accessToken: 'eyJhbGciOiJSUzI1NiJ9.signer.sig',
      signerUrl: 'https://signer-dmz.pymthouse.com',
      expiresIn: 900,
      scope: 'sign:job',
      tokenType: 'Bearer',
    });
  });

  it('accepts a flat top-level accessToken + signer_url and honors a custom scope', async () => {
    const fetchMock = mockFetch({
      json: async () => ({ accessToken: 'flat.jwt.sig', signer_url: 'https://dmz.example' }),
    });

    const out = await exchangeApiKeyForSignerSession({
      billingUrl: 'https://pymthouse.com/',
      clientId: 'app_x',
      apiKey: 'pmth_x',
      scope: 'sign:job extra',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ scope: 'sign:job extra' });
    expect(out.accessToken).toBe('flat.jwt.sig');
    expect(out.signerUrl).toBe('https://dmz.example');
    // No expires_in in the response → conservative default TTL.
    expect(out.expiresIn).toBe(300);
    expect(out.scope).toBe('sign:job extra');
  });

  it('url-encodes the clientId into the path', async () => {
    const fetchMock = mockFetch({ json: async () => ({ accessToken: 't' }) });
    await exchangeApiKeyForSignerSession({
      billingUrl: 'https://pymthouse.com',
      clientId: 'app/with space',
      apiKey: 'pmth_x',
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      'https://pymthouse.com/api/v1/apps/app%2Fwith%20space/auth/api-key/signer-session',
    );
  });

  it('rejects an empty api key before any network call', async () => {
    const fetchMock = mockFetch({ json: async () => ({}) });
    await expect(
      exchangeApiKeyForSignerSession({ billingUrl: 'https://p.com', clientId: 'app_x', apiKey: '  ' }),
    ).rejects.toThrow(/non-empty API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty clientId before any network call', async () => {
    const fetchMock = mockFetch({ json: async () => ({}) });
    await expect(
      exchangeApiKeyForSignerSession({ billingUrl: 'https://p.com', clientId: ' ', apiKey: 'pmth_x' }),
    ).rejects.toThrow(/non-empty clientId/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the response carries no signer access token', async () => {
    mockFetch({ json: async () => ({ signerUrl: 'https://dmz.example' }) });
    await expect(
      exchangeApiKeyForSignerSession({ billingUrl: 'https://p.com', clientId: 'app_x', apiKey: 'pmth_x' }),
    ).rejects.toThrow(/missing signer access token/);
  });

  it('surfaces a non-2xx error_description from the provider', async () => {
    mockFetch({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized', error_description: 'invalid api key' }),
    });
    await expect(
      exchangeApiKeyForSignerSession({ billingUrl: 'https://p.com', clientId: 'app_x', apiKey: 'pmth_bad' }),
    ).rejects.toThrow(/invalid api key/);
  });

  it('throws on invalid JSON in the response body', async () => {
    mockFetch({
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(
      exchangeApiKeyForSignerSession({ billingUrl: 'https://p.com', clientId: 'app_x', apiKey: 'pmth_x' }),
    ).rejects.toThrow(/invalid JSON/);
  });
});
