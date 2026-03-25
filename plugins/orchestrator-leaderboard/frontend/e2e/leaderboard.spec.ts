import { test, expect, type Page } from '@playwright/test';

const FIXTURE_CAPABILITIES = {
  success: true,
  data: { capabilities: ['noop', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'] },
};

const FIXTURE_RANK = {
  success: true,
  data: [
    { orchUri: 'https://orch-1.test', gpuName: 'RTX 4090', gpuGb: 24, avail: 3, totalCap: 4, pricePerUnit: 100, bestLatMs: 50, avgLatMs: 80, swapRatio: 0.05, avgAvail: 3.2 },
    { orchUri: 'https://orch-2.test', gpuName: 'A100', gpuGb: 80, avail: 1, totalCap: 2, pricePerUnit: 500, bestLatMs: 200, avgLatMs: 350, swapRatio: 0.3, avgAvail: 1.5 },
    { orchUri: 'https://orch-3.test', gpuName: 'RTX 3090', gpuGb: 24, avail: 2, totalCap: 2, pricePerUnit: 80, bestLatMs: null, avgLatMs: null, swapRatio: null, avgAvail: 2.0 },
  ],
};

const FIXTURE_RANK_WITH_SLA = {
  success: true,
  data: [
    { orchUri: 'https://orch-1.test', gpuName: 'RTX 4090', gpuGb: 24, avail: 3, totalCap: 4, pricePerUnit: 100, bestLatMs: 50, avgLatMs: 80, swapRatio: 0.05, avgAvail: 3.2, slaScore: 0.95 },
    { orchUri: 'https://orch-3.test', gpuName: 'RTX 3090', gpuGb: 24, avail: 2, totalCap: 2, pricePerUnit: 80, bestLatMs: null, avgLatMs: null, swapRatio: null, avgAvail: 2.0, slaScore: 0.65 },
    { orchUri: 'https://orch-2.test', gpuName: 'A100', gpuGb: 80, avail: 1, totalCap: 2, pricePerUnit: 500, bestLatMs: 200, avgLatMs: 350, swapRatio: 0.3, avgAvail: 1.5, slaScore: 0.3 },
  ],
};

async function stubAPIs(page: Page) {
  await page.route('**/api/v1/orchestrator-leaderboard/filters', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_CAPABILITIES) });
  });

  await page.route('**/api/v1/orchestrator-leaderboard/rank', async (route) => {
    const request = route.request();
    const postData = request.postDataJSON?.() ?? JSON.parse(request.postData() || '{}');

    const response = postData.slaWeights ? FIXTURE_RANK_WITH_SLA : FIXTURE_RANK;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
      headers: {
        'X-Cache': 'MISS',
        'X-Cache-Age': '0',
        'X-Data-Freshness': new Date().toISOString(),
        'Cache-Control': 'public, max-age=10',
      },
    });
  });
}

test.describe('Orchestrator Leaderboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await stubAPIs(page);
  });

  test('loads capabilities dropdown and renders table on selection', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');

    const select = page.locator('select').first();
    await expect(select).toBeVisible();

    const options = await select.locator('option').allTextContents();
    expect(options).toContain('streamdiffusion-sdxl');
    expect(options).toContain('noop');

    await select.selectOption('streamdiffusion-sdxl');

    await expect(page.locator('table')).toBeVisible();

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(3);
  });

  test('renders all expected table columns', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await page.locator('select').first().selectOption('noop');

    await expect(page.locator('table')).toBeVisible();

    const headers = await page.locator('thead th').allTextContents();
    expect(headers).toContain('Orchestrator URL');
    expect(headers).toContain('GPU');
    expect(headers).toContain('GPU RAM');
    expect(headers).toContain('Capacity');
    expect(headers).toContain('Price/Unit');
    expect(headers).toContain('Best Lat (ms)');
    expect(headers).toContain('Avg Lat (ms)');
    expect(headers).toContain('Swap Ratio');
    expect(headers).toContain('Avg Avail');
  });

  test('sends correct capability and topN in POST body', async ({ page }) => {
    let capturedBody: any = null;
    await page.route('**/api/v1/orchestrator-leaderboard/rank', async (route) => {
      capturedBody = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_RANK) });
    });

    await page.goto('/orchestrator-leaderboard');
    await page.locator('select').first().selectOption('streamdiffusion-sdxl');

    await page.waitForTimeout(500);
    expect(capturedBody?.capability).toBe('streamdiffusion-sdxl');
    expect(capturedBody?.topN).toBe(10);
  });

  test('SLA toggle adds slaWeights and shows SLA Score column', async ({ page }) => {
    let capturedBody: any = null;
    await page.route('**/api/v1/orchestrator-leaderboard/rank', async (route) => {
      capturedBody = JSON.parse(route.request().postData() || '{}');
      const response = capturedBody.slaWeights ? FIXTURE_RANK_WITH_SLA : FIXTURE_RANK;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });

    await page.goto('/orchestrator-leaderboard');
    await page.locator('select').first().selectOption('noop');
    await expect(page.locator('table')).toBeVisible();

    const headers1 = await page.locator('thead th').allTextContents();
    expect(headers1).not.toContain('SLA Score');

    await page.getByText('SLA Ranking OFF').click();

    await page.waitForTimeout(500);
    expect(capturedBody?.slaWeights).toBeDefined();

    const headers2 = await page.locator('thead th').allTextContents();
    expect(headers2).toContain('SLA Score');
  });

  test('shows empty state message when no results', async ({ page }) => {
    await page.route('**/api/v1/orchestrator-leaderboard/rank', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    });

    await page.goto('/orchestrator-leaderboard');
    await page.locator('select').first().selectOption('noop');

    await expect(page.getByText('No orchestrators found')).toBeVisible();
  });

  test('auto-refresh triggers multiple API calls', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/v1/orchestrator-leaderboard/rank', (route) => {
      callCount++;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_RANK) });
    });

    await page.goto('/orchestrator-leaderboard');
    await page.locator('select').first().selectOption('noop');
    await page.waitForTimeout(500);

    const initialCount = callCount;
    await page.getByText('Auto-refresh (5s)').click();

    await page.waitForTimeout(6000);
    expect(callCount).toBeGreaterThan(initialCount);
  });
});
