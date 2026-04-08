import { test, expect } from '@playwright/test';
import { isNonLocalBaseUrl } from './helpers/production';

test.describe('Security smoke @pre-release', () => {
  test('HTTPS and baseline headers on landing', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.ok()).toBeTruthy();
    const url = res?.url() || page.url();
    if (isNonLocalBaseUrl()) {
      expect(url.startsWith('https://')).toBeTruthy();
      const headers = res?.headers() ?? {};
      expect(
        headers['strict-transport-security'] || headers['Strict-Transport-Security'],
        'HSTS expected on production deployment',
      ).toBeTruthy();
    }
  });

  test('login page returns CSP or X-Frame-Options style protection', async ({ page }) => {
    const res = await page.goto('/login');
    expect(res?.ok()).toBeTruthy();
    const headers = res?.headers() ?? {};
    const csp = headers['content-security-policy'] || headers['Content-Security-Policy'];
    const xfo = headers['x-frame-options'] || headers['X-Frame-Options'];
    expect(csp || xfo, 'CSP or X-Frame-Options on /login').toBeTruthy();
  });

  test('session cookies use Secure and HttpOnly on HTTPS', async ({ context }) => {
    test.skip(!isNonLocalBaseUrl(), 'HTTPS cookie flags checked on non-local base URL only');

    const cookies = await context.cookies();
    test.skip(cookies.length === 0, 'No cookies present — auth setup likely skipped (set E2E_USER_EMAIL/E2E_USER_PASSWORD)');

    const httpOnlyCookies = cookies.filter((c) => c.httpOnly);
    expect(httpOnlyCookies.length, 'expected at least one HttpOnly cookie from setup login').toBeGreaterThan(0);
    for (const c of httpOnlyCookies) {
      expect(c.secure, `cookie ${c.name} should be Secure on HTTPS`).toBeTruthy();
    }
  });
});
