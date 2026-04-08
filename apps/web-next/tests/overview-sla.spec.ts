import { test, expect } from '@playwright/test';
import { waitForDashboardData, percentile75 } from './helpers/dashboard-e2e';

const COLD_SLA_MS = 2000;
const WARM_SLA_MS = 1000;

function sampleCount(): number {
  const n = Number(process.env.E2E_SLA_SAMPLES || '5');
  return Number.isFinite(n) && n >= 1 ? Math.min(20, Math.floor(n)) : 5;
}

/**
 * Serial sampling of overview "time to data-ready" for release SLA tracking.
 *
 * Set `E2E_ENFORCE_OVERVIEW_SLA=1` to hard-fail when p75 exceeds targets (cold 2s, warm 1s).
 * Without it, values are logged only (recommended for local dev and flaky networks).
 *
 * `E2E_SLA_SAMPLES` — number of cold (fresh context) and warm pairs (default 5).
 */
test.describe('Public overview SLA sampling @sla @pre-release', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('cold and warm p75 vs targets (widgets visible)', async ({ browser, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');

    const n = sampleCount();
    const coldMs: number[] = [];
    const warmMs: number[] = [];

    for (let i = 0; i < n; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();

      const coldStart = Date.now();
      await page.goto('/');
      await expect(page.locator('h1')).toContainText('Network Platform', { timeout: 15_000 });
      await waitForDashboardData(page);
      coldMs.push(Date.now() - coldStart);

      const warmStart = Date.now();
      await page.goto('/');
      await waitForDashboardData(page);
      warmMs.push(Date.now() - warmStart);

      await context.close();
    }

    const p75Cold = percentile75(coldMs);
    const p75Warm = percentile75(warmMs);

    console.log('\n=== Overview SLA samples ===');
    console.log(`  samples: ${n}`);
    console.log(`  cold ms (each): ${coldMs.join(', ')}`);
    console.log(`  warm ms (each): ${warmMs.join(', ')}`);
    console.log(`  p75 cold: ${p75Cold}ms (target <${COLD_SLA_MS}ms)`);
    console.log(`  p75 warm: ${p75Warm}ms (target <${WARM_SLA_MS}ms)\n`);

    if (process.env.E2E_ENFORCE_OVERVIEW_SLA === '1') {
      expect(
        p75Cold,
        `p75 cold load should be < ${COLD_SLA_MS}ms (set E2E_ENFORCE_OVERVIEW_SLA=0 to log-only)`,
      ).toBeLessThan(COLD_SLA_MS);
      expect(
        p75Warm,
        `p75 warm load should be < ${WARM_SLA_MS}ms (set E2E_ENFORCE_OVERVIEW_SLA=0 to log-only)`,
      ).toBeLessThan(WARM_SLA_MS);
    }
  });
});
