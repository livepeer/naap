import { test, expect } from '@playwright/test';

/**
 * Smoke test for the auth verification email pipeline.
 *
 * What this protects: if RESEND_API_KEY / EMAIL_FROM are missing or
 * misconfigured against a deployed environment, `/api/health` will fail
 * closed (503). This catches the regression that hid Steph's missing
 * verification email for weeks (silent send failure on register).
 *
 * Tagged @pre-release so the nightly e2e-ga workflow picks it up against
 * production / preview deployments. Skipped locally (no email config
 * expected on developer machines).
 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function isLocalBaseURL(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return LOCAL_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

test.describe('Auth email config smoke @pre-release', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/api/health reports email as configured in production-like envs', async ({
    request,
    baseURL,
  }) => {
    test.skip(!baseURL, 'baseURL required');
    test.skip(
      isLocalBaseURL(baseURL),
      'local dev expected to lack Resend config; skipping email config assertion',
    );

    const res = await request.get('/api/health');
    expect(
      [200, 503].includes(res.status()),
      'health endpoint must respond with a structured status',
    ).toBe(true);

    const body = await res.json();
    expect(body, 'health payload includes email section').toHaveProperty('email');
    expect(
      body.email,
      'email section reports configured fields',
    ).toMatchObject({
      configured: expect.any(Boolean),
      warnings: expect.any(Array),
      criticalInThisEnv: expect.any(Boolean),
    });

    expect(
      body.email.configured,
      `email service must be configured in a deployed env; warnings=${JSON.stringify(body.email.warnings)}`,
    ).toBe(true);
    expect(res.status(), 'health endpoint must return 200 when email is configured').toBe(200);
  });

  test('register endpoint accepts a fresh signup attempt', async ({ request, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    test.skip(
      isLocalBaseURL(baseURL),
      'register requires DB + email; skipping for local dev',
    );

    const unique = `e2e-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
    const res = await request.post('/api/v1/auth/register', {
      data: {
        email: unique,
        password: 'CorrectHorseBatteryStaple1!',
        displayName: 'E2E Smoke Test',
      },
    });

    // The endpoint returns a uniform 200 regardless of whether the email is
    // new (created + email sent) or already exists (cooldown-throttled resend).
    // It must NOT return 5xx — that would indicate the email pipeline crashed.
    expect(res.status(), `register must not 5xx; got status ${res.status()}`).toBeLessThan(500);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('success', true);
    }
  });

  test('resend-verification endpoint is callable without 5xx', async ({ request, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    test.skip(
      isLocalBaseURL(baseURL),
      'requires deployed env with Resend configured',
    );

    const res = await request.post('/api/v1/auth/resend-verification', {
      data: { email: `nonexistent-${Date.now()}@example.invalid` },
    });
    // Returns 200 for non-existent users by design (anti-enumeration);
    // any 5xx means the email send code path threw.
    expect(res.status()).toBeLessThan(500);
  });
});
