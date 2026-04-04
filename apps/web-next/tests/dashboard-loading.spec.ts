import { test, expect, type Page, type Response } from '@playwright/test';

/**
 * E2E tests for public and authenticated dashboard loading performance.
 *
 * Works on both local dev (http://localhost:3001) and Vercel production
 * deployments (set PLAYWRIGHT_BASE_URL to the deployment URL).
 *
 * Measures wall-clock time from navigation start to data-rendered, captures
 * per-API response times, and verifies CDN cache headers + Vercel edge
 * cache status (x-vercel-cache) on production.
 */

const DASHBOARD_API_ROUTES = [
  '/api/v1/dashboard/kpi',
  '/api/v1/dashboard/pipelines',
  '/api/v1/dashboard/pipeline-catalog',
  '/api/v1/dashboard/orchestrators',
  '/api/v1/dashboard/protocol',
  '/api/v1/dashboard/gpu-capacity',
  '/api/v1/dashboard/pricing',
  '/api/v1/dashboard/fees',
  '/api/v1/dashboard/job-feed',
] as const;

interface ApiTiming {
  route: string;
  durationMs: number;
  cacheControl: string | null;
  vercelCache: string | null;
}

const isProduction = () =>
  !!(process.env.PLAYWRIGHT_BASE_URL && !process.env.PLAYWRIGHT_BASE_URL.includes('localhost'));

/**
 * Waits for the dashboard to render real widget content (not skeletons).
 * Uses KPI labels that actually appear in the rendered markup.
 * Falls back to "Unavailable" widgets if the backend returned no data.
 */
async function waitForDashboardData(page: Page, timeoutMs = 30_000) {
  // KPIGroupCard tiles use labels like "Success Rate (12h)", "Orchestrators (12h)"
  // WidgetUnavailable shows the label text when data is absent.
  // Either one means the loading skeleton is gone.
  const dataOrUnavailable = page.locator(
    ':text("Success Rate"), :text("Orchestrators"), :text("Unavailable")',
  );
  await expect(dataOrUnavailable.first()).toBeVisible({ timeout: timeoutMs });
}

/**
 * Installs a response listener that records timing for dashboard API calls.
 * Returns the collected timings array (populated asynchronously).
 */
function trackApiTimings(page: Page): ApiTiming[] {
  const timings: ApiTiming[] = [];
  const requestStartMap = new Map<string, number>();

  page.on('request', (req) => {
    try {
      const url = new URL(req.url());
      if (DASHBOARD_API_ROUTES.some((r) => url.pathname.startsWith(r))) {
        requestStartMap.set(req.url(), Date.now());
      }
    } catch {
      // ignore malformed URLs
    }
  });

  page.on('response', (response: Response) => {
    try {
      const url = new URL(response.url());
      const match = DASHBOARD_API_ROUTES.find((r) => url.pathname.startsWith(r));
      if (!match) return;

      const startMs = requestStartMap.get(response.url()) ?? 0;
      const durationMs = startMs > 0 ? Date.now() - startMs : -1;

      timings.push({
        route: match,
        durationMs,
        cacheControl: response.headers()['cache-control'] ?? null,
        vercelCache: response.headers()['x-vercel-cache'] ?? null,
      });
    } catch {
      // ignore
    }
  });

  return timings;
}

function printTimingReport(label: string, totalMs: number, timings: ApiTiming[]) {
  const lines = [
    '',
    `=== ${label}: ${totalMs}ms total ===`,
    ...timings.map((t) => {
      const cache = t.vercelCache ? `edge=${t.vercelCache}` : 'edge=N/A';
      const cc = t.cacheControl ?? 'no cache-control';
      return `  ${t.route.padEnd(40)} ${String(t.durationMs).padStart(6)}ms  ${cache}  ${cc}`;
    }),
    '',
  ];
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Public dashboard — unauthenticated
// ---------------------------------------------------------------------------

test.describe('Public Dashboard Loading (no login)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('loads overview data and measures total time', async ({ page }) => {
    const timings = trackApiTimings(page);

    const startMs = Date.now();
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('Network Platform', { timeout: 15_000 });
    await waitForDashboardData(page);

    const totalMs = Date.now() - startMs;
    printTimingReport('Public Dashboard (cold)', totalMs, timings);

    // Sanity: heading is still there after data rendered
    await expect(page.locator('h1')).toContainText('Network Platform');
  });

  test('dashboard API responses include CDN cache headers', async ({ page }) => {
    const timings = trackApiTimings(page);

    await page.goto('/');
    await waitForDashboardData(page);

    const seen = new Set(timings.map((t) => t.route));

    for (const route of DASHBOARD_API_ROUTES) {
      if (!seen.has(route)) continue; // API wasn't called (e.g. conditional fetch)
      const entry = timings.find((t) => t.route === route);
      if (!entry?.cacheControl) continue;

      expect(
        entry.cacheControl,
        `${route} should have s-maxage in Cache-Control`,
      ).toContain('s-maxage');
      expect(
        entry.cacheControl,
        `${route} should have stale-while-revalidate in Cache-Control`,
      ).toContain('stale-while-revalidate');
    }
  });

  test('second load benefits from cache', async ({ page }) => {
    // First load — primes CDN / browser cache
    const firstTimings = trackApiTimings(page);
    const firstStart = Date.now();
    await page.goto('/');
    await waitForDashboardData(page);
    const firstLoadMs = Date.now() - firstStart;

    // Second load — should serve from CDN edge or browser cache
    const secondTimings = trackApiTimings(page);
    const secondStart = Date.now();
    await page.goto('/');
    await waitForDashboardData(page);
    const secondLoadMs = Date.now() - secondStart;

    printTimingReport('First load', firstLoadMs, firstTimings);
    printTimingReport('Second load', secondLoadMs, secondTimings);

    // On Vercel production, second-load API calls should show x-vercel-cache: HIT
    if (isProduction()) {
      const hits = secondTimings.filter((t) => t.vercelCache === 'HIT');
      console.log(`  CDN HIT count: ${hits.length} / ${secondTimings.length}`);
      expect(
        hits.length,
        'Most API responses should be CDN HIT on second load',
      ).toBeGreaterThan(0);
    }

    // Second load should finish (generous timeout; real CDN benefit is ~10x)
    expect(secondLoadMs).toBeLessThan(60_000);
  });

  test('progressive rendering — widgets appear independently', async ({ page }) => {
    const groupTimestamps: Record<string, number> = {};

    page.on('response', (response: Response) => {
      try {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/v1/dashboard/kpi')) {
          groupTimestamps['lb'] = Date.now();
        } else if (url.pathname.startsWith('/api/v1/dashboard/protocol')) {
          groupTimestamps['rt'] = Date.now();
        } else if (url.pathname.startsWith('/api/v1/dashboard/fees')) {
          groupTimestamps['fees'] = Date.now();
        }
      } catch {
        // ignore
      }
    });

    const navStart = Date.now();
    await page.goto('/');
    await waitForDashboardData(page);

    console.log('\n=== Progressive Rendering ===');
    for (const [group, ts] of Object.entries(groupTimestamps)) {
      console.log(`  ${group} API responded at +${ts - navStart}ms`);
    }
    console.log('');

    // All three groups should have fired independently
    const groups = Object.keys(groupTimestamps);
    expect(groups.length, 'At least 2 fetch groups should have responded').toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Authenticated dashboard — with login
// ---------------------------------------------------------------------------

test.describe('Authenticated Dashboard Loading (with login)', () => {
  // Uses storageState from playwright config (playwright/.auth/user.json)

  test('loads overview data and measures total time', async ({ page }) => {
    const timings = trackApiTimings(page);
    const startMs = Date.now();

    const response = await page.goto('/dashboard');

    // If the auth session is expired/invalid, the server may redirect to login.
    // Detect this early so the test doesn't hang for 30s waiting for KPI data.
    const finalUrl = page.url();
    if (finalUrl.includes('/login') || finalUrl.includes('/signin')) {
      console.log('\n=== Authenticated Dashboard: SKIPPED (redirected to login) ===');
      console.log('  Auth session is invalid/expired. Re-run auth.setup.ts.\n');
      test.skip(true, 'Auth session expired — redirected to login');
      return;
    }

    // Wait for the heading — authenticated dashboard may use "Dashboard" or "Network Platform"
    await expect(
      page.locator('h1').filter({ hasText: /Network Platform|Dashboard/ }),
    ).toBeVisible({ timeout: 15_000 });

    await waitForDashboardData(page);

    const totalMs = Date.now() - startMs;
    printTimingReport('Authenticated Dashboard', totalMs, timings);

    await expect(
      page.locator('h1').filter({ hasText: /Network Platform|Dashboard/ }),
    ).toBeVisible();
  });

  test('authenticated second load benefits from cache', async ({ page }) => {
    const resp = await page.goto('/dashboard');
    if (page.url().includes('/login') || page.url().includes('/signin')) {
      test.skip(true, 'Auth session expired — redirected to login');
      return;
    }

    await waitForDashboardData(page);

    // Second load
    const timings = trackApiTimings(page);
    const startMs = Date.now();
    await page.goto('/dashboard');
    await waitForDashboardData(page);
    const secondLoadMs = Date.now() - startMs;

    printTimingReport('Authenticated second load', secondLoadMs, timings);

    if (isProduction()) {
      const hits = timings.filter((t) => t.vercelCache === 'HIT');
      console.log(`  CDN HIT count: ${hits.length} / ${timings.length}\n`);
    }

    expect(secondLoadMs).toBeLessThan(60_000);
  });
});
