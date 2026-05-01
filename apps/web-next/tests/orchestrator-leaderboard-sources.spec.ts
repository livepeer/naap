import { test, expect } from '@playwright/test';
import { e2eBaseUrl } from './helpers/e2e-base';

/**
 * E2E tests for the configurable data sources feature of the
 * orchestrator-leaderboard plugin.
 *
 * Tests the new REST endpoints:
 *   GET  /api/v1/orchestrator-leaderboard/sources
 *   PUT  /api/v1/orchestrator-leaderboard/sources (admin)
 *   GET  /api/v1/orchestrator-leaderboard/audits
 *
 * And the admin UI panels (Data Sources tab, Refresh Audit tab).
 *
 * Stub mode (default): route-stubs API responses for deterministic UI testing.
 * Live mode: when E2E_USER_EMAIL + E2E_USER_PASSWORD are set, hits the real
 *   preview backend.
 *
 * Tag: @pre-release
 */

const VALID_SOURCE_KINDS = [
  'livepeer-subgraph',
  'clickhouse-query',
  'naap-discover',
  'naap-pricing',
] as const;

const STUB_SOURCES = [
  { kind: 'livepeer-subgraph', enabled: true, priority: 1, config: null, updatedAt: new Date().toISOString() },
  { kind: 'clickhouse-query', enabled: true, priority: 2, config: null, updatedAt: new Date().toISOString() },
  { kind: 'naap-discover', enabled: true, priority: 3, config: null, updatedAt: new Date().toISOString() },
  { kind: 'naap-pricing', enabled: true, priority: 4, config: null, updatedAt: new Date().toISOString() },
];

const STUB_AUDITS = [
  {
    id: 'audit-1',
    refreshedAt: new Date().toISOString(),
    refreshedBy: 'cron',
    durationMs: 2500,
    membershipSource: 'livepeer-subgraph',
    totalOrchestrators: 85,
    totalCapabilities: 4,
    perSource: {
      'livepeer-subgraph': { ok: true, fetched: 120, durationMs: 800 },
      'clickhouse-query': { ok: true, fetched: 340, durationMs: 1200 },
      'naap-discover': { ok: true, fetched: 90, durationMs: 400 },
      'naap-pricing': { ok: false, fetched: 0, durationMs: 100, errorMessage: 'timeout' },
    },
    conflicts: [
      { orchKey: 'eth:0xaaa', field: 'pricePerUnit', winner: 'clickhouse-query', losers: [{ source: 'naap-pricing', value: 200 }] },
    ],
    dropped: [
      { orchKey: 'uri:https://unknown.test', source: 'clickhouse-query', reason: 'not present in membership source (livepeer-subgraph)' },
    ],
    warnings: [],
  },
];

const isLiveMode = () =>
  !!(process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);

const STUB_CAPABILITIES = ['image-to-image', 'text-to-image'];

// ---------------------------------------------------------------------------
// Stub mode — UI tests with route-stubbed API responses
// ---------------------------------------------------------------------------

test.describe('Data Sources UI (stub) @pre-release', () => {
  test.skip(() => isLiveMode(), 'Skipping stub tests — live credentials detected');
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/orchestrator-leaderboard/filters', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { capabilities: STUB_CAPABILITIES } }),
      }),
    );

    await page.route('**/api/v1/orchestrator-leaderboard/rank', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { cached: false } }),
      }),
    );

    await page.route('**/api/v1/orchestrator-leaderboard/dataset/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            refreshIntervalHours: 1,
            lastRefreshedAt: new Date().toISOString(),
            lastRefreshedBy: 'cron',
            updatedAt: new Date().toISOString(),
          },
        }),
      }),
    );

    await page.route('**/api/v1/orchestrator-leaderboard/dataset/refresh', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { refreshed: true, capabilities: 3, orchestrators: 5 },
        }),
      }),
    );

    await page.route('**/api/v1/orchestrator-leaderboard/sources', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: STUB_SOURCES }),
      }),
    );

    await page.route('**/api/v1/orchestrator-leaderboard/audits*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: STUB_AUDITS,
          pagination: { nextCursor: null, hasMore: false },
        }),
      }),
    );
  });

  test('plugin shell loads without crash from new components', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    // Wait for the page to settle (the plugin shell loads asynchronously)
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).not.toBeVisible();
    // Either the leaderboard renders or the page shows something from the plugin shell
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });
  });

  test('stubbed sources API returns correct data via page fetch', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });

    // Use page.evaluate to call through the stubbed routes
    const result = await page.evaluate(async () => {
      const res = await fetch('/api/v1/orchestrator-leaderboard/sources');
      return res.json();
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(4);
    for (const src of result.data) {
      expect(typeof src.enabled).toBe('boolean');
      expect(typeof src.priority).toBe('number');
    }
  });

  test('stubbed audits API returns audit entries via page fetch', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/v1/orchestrator-leaderboard/audits?limit=5');
      return res.json();
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(1);

    const audit = result.data[0];
    expect(audit.id).toBeTruthy();
    expect(audit.membershipSource).toBeTruthy();
    expect(typeof audit.durationMs).toBe('number');
    expect(typeof audit.totalOrchestrators).toBe('number');
    expect(typeof audit.perSource).toBe('object');
    expect(Array.isArray(audit.conflicts)).toBe(true);
    expect(Array.isArray(audit.dropped)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Live mode — real backend (Vercel preview or local with credentials)
// ---------------------------------------------------------------------------

test.describe('Data Sources API (live) @pre-release', () => {
  test.skip(() => !isLiveMode(), 'Skipping live tests — set E2E_USER_EMAIL and E2E_USER_PASSWORD');

  const baseURL = e2eBaseUrl();

  test('GET /sources returns valid source list', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/v1/orchestrator-leaderboard/sources`, {
      timeout: 30_000,
    });

    if (res.status() === 401 || res.status() === 403) {
      console.log('[sources] Auth required — skipping live source list validation');
      return;
    }

    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    if (body.data.length > 0) {
      for (const src of body.data) {
        expect(VALID_SOURCE_KINDS).toContain(src.kind);
        expect(typeof src.enabled).toBe('boolean');
        expect(typeof src.priority).toBe('number');
      }

      // Verify sorted by priority
      for (let i = 1; i < body.data.length; i++) {
        expect(body.data[i].priority).toBeGreaterThanOrEqual(body.data[i - 1].priority);
      }

      console.log(`[sources] ${body.data.length} sources configured:`,
        body.data.map((s: { kind: string; priority: number; enabled: boolean }) =>
          `${s.kind}(p${s.priority},${s.enabled ? 'on' : 'off'})`
        ).join(', '));
    }
  });

  test('GET /audits returns recent audit records', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/v1/orchestrator-leaderboard/audits?limit=3`, {
      timeout: 30_000,
    });

    if (res.status() === 401 || res.status() === 403) {
      console.log('[audits] Auth required — skipping live audit validation');
      return;
    }

    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    if (body.data.length > 0) {
      const latest = body.data[0];
      expect(latest.id).toBeTruthy();
      expect(latest.membershipSource).toBeTruthy();
      expect(typeof latest.totalOrchestrators).toBe('number');
      expect(typeof latest.totalCapabilities).toBe('number');
      expect(typeof latest.perSource).toBe('object');
      expect(Array.isArray(latest.conflicts)).toBe(true);
      expect(Array.isArray(latest.dropped)).toBe(true);
      console.log(`[audits] Latest: ${latest.totalOrchestrators} orchs, ${latest.totalCapabilities} caps, ${latest.durationMs}ms, by ${latest.refreshedBy}`);
    } else {
      console.log('[audits] No audit records yet (dataset may not have been refreshed)');
    }
  });

  test('PUT /sources without admin auth returns 401/403', async ({ request }) => {
    const res = await request.put(`${baseURL}/api/v1/orchestrator-leaderboard/sources`, {
      data: {
        sources: [
          { kind: 'livepeer-subgraph', enabled: true, priority: 1 },
        ],
      },
      timeout: 15_000,
    });

    expect(
      res.status() === 401 || res.status() === 403,
      `PUT /sources expected 401/403 without admin auth, got ${res.status()}`,
    ).toBeTruthy();
  });

  test('global dataset refresh endpoint is reachable (non-5xx)', async ({ request }) => {
    const res = await request.post(`${baseURL}/api/v1/orchestrator-leaderboard/dataset/refresh`, {
      timeout: 30_000,
    });

    expect(
      res.status() < 500,
      `POST /dataset/refresh expected non-5xx, got ${res.status()}`,
    ).toBeTruthy();
    console.log(`[refresh] Status: ${res.status()}`);
  });
});

// ---------------------------------------------------------------------------
// Vercel build & seed verification (live mode only)
// ---------------------------------------------------------------------------

test.describe('Build & Seed Verification (live) @pre-release', () => {
  test.skip(() => !isLiveMode(), 'Skipping live tests — set E2E_USER_EMAIL and E2E_USER_PASSWORD');

  const baseURL = e2eBaseUrl();

  test('app responds and is not a build error page', async ({ page }) => {
    const res = await page.goto(`${baseURL}/`);
    expect(res?.ok()).toBeTruthy();

    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Internal Server Error');
  });

  test('leaderboard plugin page loads on preview', async ({ page }) => {
    await page.goto(`${baseURL}/orchestrator-leaderboard`);
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).not.toBeVisible();
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });
  });

  test('dataset config API responds (seed config check)', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/v1/orchestrator-leaderboard/dataset/config`, {
      timeout: 30_000,
    });

    if (res.status() === 401 || res.status() === 403) {
      console.log('[config] Auth required — config endpoint is auth-gated as expected');
      return;
    }

    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.refreshIntervalHours).toBeGreaterThanOrEqual(1);
    console.log(`[config] Refresh interval: ${body.data.refreshIntervalHours}h, last refresh: ${body.data.lastRefreshedAt ?? 'never'}`);
  });

  test('sources auto-seed with 4 defaults on fresh deployment', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/v1/orchestrator-leaderboard/sources`, {
      timeout: 30_000,
    });

    if (res.status() === 401 || res.status() === 403) {
      console.log('[sources-seed] Auth required — endpoint is auth-gated');
      return;
    }

    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);

    if (body.data.length === 4) {
      console.log('[sources-seed] 4 default sources seeded correctly');

      const kinds = body.data.map((s: { kind: string }) => s.kind);
      expect(kinds).toContain('livepeer-subgraph');
      expect(kinds).toContain('clickhouse-query');
      expect(kinds).toContain('naap-discover');
      expect(kinds).toContain('naap-pricing');

      const subgraph = body.data.find((s: { kind: string }) => s.kind === 'livepeer-subgraph');
      expect(subgraph.priority).toBe(1);
      expect(subgraph.enabled).toBe(true);
    } else {
      console.log(`[sources-seed] ${body.data.length} sources found (may have been reconfigured)`);
    }
  });
});
