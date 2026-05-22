import { test, expect } from '@playwright/test';
import { e2eBaseUrl } from './helpers/e2e-base';

/**
 * Security-focused E2E tests for authentication APIs.
 *
 * Covers: login response shape, cookie-based session validation,
 * CSRF shadow-mode behaviour, invalid-token rejection, and health
 * endpoint info-leak prevention.
 *
 * Requires E2E_USER_EMAIL / E2E_USER_PASSWORD for authenticated tests.
 */

const base = () => e2eBaseUrl();

function skipWithoutCreds(email?: string, password?: string) {
  test.skip(
    !email || !password,
    'E2E_USER_EMAIL and E2E_USER_PASSWORD required',
  );
}

// ── Authenticated API tests ──

test.describe('Auth security API @pre-release', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.describe.configure({ mode: 'serial' });

  let authToken: string;
  let authCookieHeader: string;

  test('login returns token in response body and sets httpOnly cookie', async ({
    browser,
  }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    skipWithoutCreds(email, password);

    const context = await browser.newContext({
      baseURL: base(),
      storageState: { cookies: [], origins: [] },
    });

    const res = await context.request.post('/api/v1/auth/login', {
      data: { email, password },
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();

    const json = await res.json();
    expect(json.success).toBe(true);

    const { data } = json;
    expect(data).toHaveProperty('user');
    expect(data).toHaveProperty('token');
    expect(data).toHaveProperty('expiresAt');
    expect(typeof data.token).toBe('string');
    expect(data.token.length).toBeGreaterThan(0);

    const cookies = await context.cookies();
    const authCookie = cookies.find((c) => c.name === 'naap_auth_token');
    expect(authCookie, 'naap_auth_token cookie should be set').toBeTruthy();
    expect(authCookie!.httpOnly).toBe(true);

    authToken = data.token;
    authCookieHeader = `naap_auth_token=${authCookie!.value}`;

    await context.close();
  });

  test('session validates via cookie (/auth/me)', async ({ request }) => {
    test.skip(!authToken, 'depends on login test');

    const res = await request.get(`${base()}/api/v1/auth/me`, {
      headers: { Cookie: authCookieHeader },
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('user');
    expect(json.data).toHaveProperty('expiresAt');
    expect(json.data).toHaveProperty('csrfToken');
  });

  test('CSRF enforcement on logout (shadow mode — still succeeds)', async ({
    request,
  }) => {
    test.skip(!authToken, 'depends on login test');

    const res = await request.post(`${base()}/api/v1/auth/logout`, {
      headers: {
        Cookie: authCookieHeader,
        // Deliberately omitting X-CSRF-Token — shadow mode should still allow
      },
    });

    expect(res.status()).toBeLessThan(400);
  });
});

// ── Unauthenticated / negative tests ──

test.describe('Auth security – negative cases @pre-release', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('invalid token is rejected by /auth/me', async ({ request }) => {
    const res = await request.get(`${base()}/api/v1/auth/me`, {
      headers: {
        Cookie: 'naap_auth_token=invalid-garbage-token-00000000',
      },
    });

    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test('random Bearer token is rejected by /auth/profile', async ({
    request,
  }) => {
    const res = await request.get(`${base()}/api/v1/auth/profile`, {
      headers: {
        Authorization: 'Bearer totally-random-not-a-real-token',
      },
    });

    expect(res.status()).toBe(401);
  });
});

// ── Health endpoint info-leak check ──

test.describe('Health endpoint security @pre-release', () => {
  test('does not leak env info or connection strings', async ({ request }) => {
    const res = await request.get(`${base()}/api/health`);
    const json = await res.json();

    expect(json).toHaveProperty('status');
    expect(json).toHaveProperty('timestamp');
    expect(json).toHaveProperty('database');

    expect(json).not.toHaveProperty('env');

    const body = JSON.stringify(json);
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('DATABASE_URL');
    expect(body).not.toContain('SECRET');
  });
});
