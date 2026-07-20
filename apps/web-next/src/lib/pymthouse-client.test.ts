/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exchangeApiKeyForSignerSession } from './pymthouse-client';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('exchangeApiKeyForSignerSession (POST /api/v1/apps/{clientId}/oidc/token)', () => {
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

  it('POSTs RFC 8693 form body and parses the nested token envelope', async () => {
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
    expect(url).toBe('https://pymthouse.com/api/v1/apps/app_973064/oidc/token');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    });
    expect(init.headers).not.toHaveProperty('Authorization');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(form.get('subject_token')).toBe('pmth_test_key');
    expect(form.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(form.get('scope')).toBe('sign:job');

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
    const form = new URLSearchParams(init.body as string);
    expect(form.get('scope')).toBe('sign:job extra');
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
      'https://pymthouse.com/api/v1/apps/app%2Fwith%20space/oidc/token',
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
