import { test, expect, type BrowserContext, type APIRequestContext } from '@playwright/test';

/**
 * E2E tests for the Capability Explorer plugin on a Vercel preview deployment.
 *
 * Run against a preview deployment:
 *   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
 *   VERCEL_BYPASS=<secret> \
 *   ADMIN_EMAIL=admin@livepeer.org ADMIN_PASSWORD=livepeer \
 *   npx playwright test --config tests/cap-explorer.config.ts
 */

const BYPASS_SECRET = process.env.VERCEL_BYPASS || '';

function bypassUrl(baseURL: string, path: string): string {
  if (!BYPASS_SECRET) return `${baseURL}${path}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${baseURL}${path}${sep}x-vercel-protection-bypass=${BYPASS_SECRET}&x-vercel-set-bypass-cookie=true`;
}

function bypassHeaders(): Record<string, string> {
  if (!BYPASS_SECRET) return {};
  return { 'x-vercel-protection-bypass': BYPASS_SECRET };
}

async function loginAsAdmin(
  context: BrowserContext,
  baseURL: string,
  email: string,
  password: string,
) {
  const page = await context.newPage();
  await page.goto(bypassUrl(baseURL, '/login'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  if (currentUrl.includes('/dashboard') || currentUrl.includes('/admin')) {
    await page.close();
    return;
  }

  await page.getByLabel('Email').fill(email);
  await page.locator('input#password').fill(password);
  await page.getByRole('button', { name: /continue with email/i }).click();
  await page.waitForURL(/\/(dashboard|admin|capability)/, { timeout: 60_000 });
  await page.close();
}

async function authedFetch(
  authedContext: BrowserContext,
  url: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const page = await authedContext.newPage();
  const fullUrl = BYPASS_SECRET
    ? `${url}${url.includes('?') ? '&' : '?'}x-vercel-protection-bypass=${BYPASS_SECRET}`
    : url;

  const response = await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
  const status = response?.status() ?? 0;
  const bodyText = await page.locator('body').innerText();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText };
  }
  await page.close();
  return { status, body };
}

test.describe('Capability Explorer E2E @cap-explorer', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let authedContext: BrowserContext;

  test.beforeAll(async ({ browser, baseURL }) => {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    test.skip(!email || !password, 'ADMIN_EMAIL / ADMIN_PASSWORD required');
    test.skip(!baseURL, 'baseURL required');

    authedContext = await browser.newContext();
    await loginAsAdmin(authedContext, baseURL!, email!, password!);
  });

  test.afterAll(async () => {
    await authedContext?.close();
  });

  test('landing page loads (smoke test)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(bypassUrl(baseURL!, '/'));
    await expect(page.locator('h1')).toContainText(/Network Platform|Dashboard/, {
      timeout: 20_000,
    });
    await ctx.close();
  });

  test('capability explorer page loads and shows heading', async () => {
    const page = await authedContext.newPage();
    await page.goto('/capability-explorer');

    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).not.toBeVisible();

    const heading = page.locator('text=Capability Explorer').first();
    await expect(heading).toBeVisible({ timeout: 30_000 });
    await page.close();
  });

  test('capabilities API returns data', async ({ baseURL }) => {
    const { status, body } = await authedFetch(
      authedContext,
      `${baseURL}/api/v1/capability-explorer/capabilities`,
    );
    expect(status).toBe(200);
    expect(body.success).toBeTruthy();
    expect(body.data).toBeDefined();
    const data = body.data as { items: unknown[]; total: number };
    expect(data.items).toBeInstanceOf(Array);
    console.log(`  capabilities: ${data.items.length} items, total: ${data.total}`);
  });

  test('stats API returns aggregate data', async ({ baseURL }) => {
    const { status, body } = await authedFetch(
      authedContext,
      `${baseURL}/api/v1/capability-explorer/stats`,
    );
    expect(status).toBe(200);
    expect(body.success).toBeTruthy();
    expect(body.data).toBeDefined();
    console.log(`  stats: ${JSON.stringify(body.data)}`);
  });

  test('categories API returns valid categories', async ({ baseURL }) => {
    const { status, body } = await authedFetch(
      authedContext,
      `${baseURL}/api/v1/capability-explorer/categories`,
    );
    expect(status).toBe(200);
    expect(body.success).toBeTruthy();
    expect(body.data).toBeInstanceOf(Array);
    const categories = body.data as { id: string }[];
    console.log(`  categories: ${categories.map((c) => c.id).join(', ')}`);
  });

  test('plugin renders capability grid or content', async () => {
    const page = await authedContext.newPage();
    await page.goto('/capability-explorer');
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });

    const capContent = page
      .locator(
        '[data-testid="capability-grid"], [data-testid="capability-list"], [data-testid="empty-state"], [data-testid="stats-bar"]',
      )
      .first();
    await expect(capContent).toBeVisible({ timeout: 30_000 });
    await page.close();
  });

  test('no critical console errors on capability explorer page', async () => {
    const errors: string[] = [];
    const page = await authedContext.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          text.includes('listener indicated an asynchronous') ||
          text.includes('net::ERR') ||
          text.includes('favicon') ||
          text.includes('Failed to load resource') ||
          text.includes('third-party') ||
          text.includes('vercel.live') ||
          text.includes('Content Security Policy')
        ) {
          return;
        }
        errors.push(text);
      }
    });

    await page.goto('/capability-explorer');
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await page.waitForTimeout(5_000);

    if (errors.length > 0) {
      console.log(`  Console errors found:\n${errors.map((e) => `    - ${e}`).join('\n')}`);
    }
    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0);
    await page.close();
  });

  test('refresh endpoint responds for admin user', async ({ baseURL }) => {
    const { status, body } = await authedFetch(
      authedContext,
      `${baseURL}/api/v1/capability-explorer/refresh`,
    );
    expect(status).toBeLessThan(500);
    console.log(`  refresh: status=${status}, response=${JSON.stringify(body).slice(0, 200)}`);
    expect(body.success).toBeTruthy();
  });
});
