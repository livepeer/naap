/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintUserSignerJwtForExternalUser } from './pymthouse-client';

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
