/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mintUserSignerToken = vi.fn();

vi.mock('@pymthouse/builder-sdk/signer/server', () => ({
  mintUserSignerToken: (...a: unknown[]) => mintUserSignerToken(...a),
}));

import { mintUserSignerJwtForExternalUser } from './pymthouse-client';

const EXCHANGE = {
  issuerUrl: 'https://pymthouse.com/api/v1/oidc',
  m2mClientId: 'm2m_5ad45661715c8bb7eb30d18f',
  m2mClientSecret: 'pmth_cs_secret',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mintUserSignerJwtForExternalUser (Option A user-scoped signer JWT)', () => {
  it('mints via builder-sdk with issuer + M2M creds + externalUserId, returns the JWT', async () => {
    mintUserSignerToken.mockResolvedValue({
      jwt: 'eyJhbGciOiJSUzI1NiJ9.payload.sig',
      expiresAt: Date.now() + 900_000, // +15 min
      refreshAt: Date.now() + 720_000,
      balanceUsdMicros: '5000000',
      lifetimeGrantedUsdMicros: '10000000',
    });

    const out = await mintUserSignerJwtForExternalUser({
      exchange: EXCHANGE,
      externalUserId: 'acct_user_42',
    });

    // The SDK is the single audience authority: aud = issuer URL (no override).
    expect(mintUserSignerToken).toHaveBeenCalledWith({
      issuerUrl: EXCHANGE.issuerUrl,
      m2mClientId: EXCHANGE.m2mClientId,
      m2mClientSecret: EXCHANGE.m2mClientSecret,
      externalUserId: 'acct_user_42',
      allowInsecureHttp: false,
    });
    expect(out.jwt).toBe('eyJhbGciOiJSUzI1NiJ9.payload.sig');
    expect(out.expiresIn).toBe(900);
    expect(out.scope).toBe('sign:job');
    expect(out.balanceUsdMicros).toBe('5000000');
  });

  it('clamps a near-expiry mint to a >= 1s TTL', async () => {
    mintUserSignerToken.mockResolvedValue({
      jwt: 'eyJ.x.y',
      expiresAt: Date.now() - 5_000, // already expired
      refreshAt: Date.now(),
      balanceUsdMicros: '0',
      lifetimeGrantedUsdMicros: '0',
    });

    const out = await mintUserSignerJwtForExternalUser({
      exchange: EXCHANGE,
      externalUserId: 'acct_user_42',
    });
    expect(out.expiresIn).toBe(1);
  });

  it('honors an explicit scope override', async () => {
    mintUserSignerToken.mockResolvedValue({
      jwt: 'eyJ.x.y',
      expiresAt: Date.now() + 60_000,
      refreshAt: Date.now() + 48_000,
      balanceUsdMicros: '0',
      lifetimeGrantedUsdMicros: '0',
    });

    const out = await mintUserSignerJwtForExternalUser({
      exchange: EXCHANGE,
      externalUserId: 'acct_user_42',
      scope: 'sign:job extra:scope',
    });
    expect(out.scope).toBe('sign:job extra:scope');
  });

  it('passes allowInsecureHttp=true for an http issuer (local/dev)', async () => {
    mintUserSignerToken.mockResolvedValue({
      jwt: 'eyJ.x.y',
      expiresAt: Date.now() + 60_000,
      refreshAt: Date.now() + 48_000,
      balanceUsdMicros: '0',
      lifetimeGrantedUsdMicros: '0',
    });

    await mintUserSignerJwtForExternalUser({
      exchange: { ...EXCHANGE, issuerUrl: 'http://localhost:4000/api/v1/oidc' },
      externalUserId: 'acct_user_42',
    });
    expect(mintUserSignerToken).toHaveBeenCalledWith(
      expect.objectContaining({ allowInsecureHttp: true }),
    );
  });

  it('propagates a mint failure (front door fails safe on this)', async () => {
    mintUserSignerToken.mockRejectedValue(new Error('invalid_target'));
    await expect(
      mintUserSignerJwtForExternalUser({ exchange: EXCHANGE, externalUserId: 'acct_user_42' }),
    ).rejects.toThrow('invalid_target');
  });
});
