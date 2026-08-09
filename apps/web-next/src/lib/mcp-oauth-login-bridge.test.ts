/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildMcpOauthCallbackUrl,
  consumeMcpOauthIdentityCode,
  encodeMcpOauthPendingCookie,
  isAllowedMcpOauthRedirectUri,
  mintMcpOauthIdentityCode,
  tryParseMcpOauthPendingCookie,
} from '@/lib/mcp-oauth-login-bridge';

const ORIGIN = 'https://storyboard.example';
const CALLBACK = `${ORIGIN}/api/mcp/oauth/callback`;

describe('mcp-oauth-login-bridge', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      'MCP_INTERNAL_MINT_ALLOWLIST',
      'MCP_OAUTH_REDIRECT_ALLOWLIST',
      'MCP_OAUTH_BRIDGE_SECRET',
      'NEXTAUTH_SECRET',
      'MCP_INTERNAL_MINT_SECRET',
    ]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    process.env.MCP_INTERNAL_MINT_ALLOWLIST = ORIGIN;
    process.env.NEXTAUTH_SECRET = 'test-bridge-secret-for-hmac';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('allowlists Storyboard callback derived from mint allowlist origins', () => {
    expect(isAllowedMcpOauthRedirectUri(CALLBACK)).toBe(true);
    expect(isAllowedMcpOauthRedirectUri(`${ORIGIN}/evil`)).toBe(false);
    expect(isAllowedMcpOauthRedirectUri(`${CALLBACK}?x=1`)).toBe(false);
  });

  it('round-trips pending cookie and builds callback with identity + code', async () => {
    const cookie = await encodeMcpOauthPendingCookie({
      state: 'st_abc',
      redirectUri: CALLBACK,
    });
    const pending = await tryParseMcpOauthPendingCookie(cookie);
    expect(pending?.state).toBe('st_abc');
    expect(pending?.redirectUri).toBe(CALLBACK);

    const url = new URL(
      await buildMcpOauthCallbackUrl({
        pending: pending!,
        externalUserId: 'user-42',
        email: 'a@b.c',
      }),
    );
    expect(url.origin + url.pathname).toBe(CALLBACK);
    expect(url.searchParams.get('state')).toBe('st_abc');
    expect(url.searchParams.get('external_user_id')).toBe('user-42');
    expect(url.searchParams.get('email')).toBe('a@b.c');
    const code = url.searchParams.get('code');
    expect(code).toMatch(/^mcp_id_/);
    await expect(consumeMcpOauthIdentityCode(code!)).resolves.toEqual({
      externalUserId: 'user-42',
      email: 'a@b.c',
    });
  });

  it('rejects pending cookie when redirect is not allowlisted', async () => {
    await expect(
      encodeMcpOauthPendingCookie({
        state: 'st',
        redirectUri: 'https://evil.example/callback',
      }),
    ).rejects.toThrow(/redirect_not_allowed/);
  });

  it('rejects forged identity codes', async () => {
    const code = await mintMcpOauthIdentityCode({ externalUserId: 'u1' });
    await expect(consumeMcpOauthIdentityCode(code.replace(/.$/, 'x'))).resolves.toBeNull();
  });
});
