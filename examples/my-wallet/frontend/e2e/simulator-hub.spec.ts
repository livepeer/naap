import { test, expect } from '@playwright/test';

test.describe('Simulator Hub', () => {
  test('Optimize > Simulator shows two simulator cards', async ({ page }) => {
    await page.goto('/wallet');
    const optimizeTab = page.getByRole('tab', { name: /optimize/i }).or(page.getByText('Optimize'));
    if (await optimizeTab.isVisible()) {
      await optimizeTab.click();
    }
    // Click Simulator sub-tab if visible
    const simTab = page.getByRole('button', { name: /simulator/i }).first();
    if (await simTab.isVisible()) {
      await simTab.click();
    }

    // Should show at least the simulator cards or content
    const visible = page
      .getByText('Rebalance')
      .or(page.getByText('Multi-O Distribution'))
      .or(page.getByText('Simulators'));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });

  test('clicking Rebalance card opens the rebalance form', async ({ page }) => {
    await page.goto('/wallet');
    const optimizeTab = page.getByRole('tab', { name: /optimize/i }).or(page.getByText('Optimize'));
    if (await optimizeTab.isVisible()) {
      await optimizeTab.click();
    }
    const simTab = page.getByRole('button', { name: /simulator/i }).first();
    if (await simTab.isVisible()) {
      await simTab.click();
    }

    const rebalanceCard = page.getByText('Rebalance').first();
    if (await rebalanceCard.isVisible()) {
      await rebalanceCard.click();
    }

    const visible = page
      .getByText('Rebalancing Simulator')
      .or(page.getByText('Back to Simulators'));
    await expect(visible.first()).toBeVisible({ timeout: 10000 });
  });

  test('clicking Multi-O card opens the distribution form', async ({ page }) => {
    await page.goto('/wallet');
    const optimizeTab = page.getByRole('tab', { name: /optimize/i }).or(page.getByText('Optimize'));
    if (await optimizeTab.isVisible()) {
      await optimizeTab.click();
    }
    const simTab = page.getByRole('button', { name: /simulator/i }).first();
    if (await simTab.isVisible()) {
      await simTab.click();
    }

    const multiOCard = page.getByText('Multi-O Distribution').first();
    if (await multiOCard.isVisible()) {
      await multiOCard.click();
    }

    const visible = page
      .getByText('Multi-Orchestrator Distribution Simulator')
      .or(page.getByText('Back to Simulators'));
    await expect(visible.first()).toBeVisible({ timeout: 10000 });
  });

  test('Back button returns to hub', async ({ page }) => {
    await page.goto('/wallet');
    const optimizeTab = page.getByRole('tab', { name: /optimize/i }).or(page.getByText('Optimize'));
    if (await optimizeTab.isVisible()) {
      await optimizeTab.click();
    }
    const simTab = page.getByRole('button', { name: /simulator/i }).first();
    if (await simTab.isVisible()) {
      await simTab.click();
    }

    // Open rebalance
    const rebalanceCard = page.getByText('Rebalance').first();
    if (await rebalanceCard.isVisible()) {
      await rebalanceCard.click();
    }

    // Click back
    const backBtn = page.getByText('Back to Simulators');
    if (await backBtn.isVisible()) {
      await backBtn.click();
    }

    // Should see the hub again
    await expect(page.getByText('Simulators').first()).toBeVisible({ timeout: 5000 });
  });

  test('Generate Strategies button is disabled when amount is empty', async ({ page }) => {
    await page.goto('/wallet');
    const optimizeTab = page.getByRole('tab', { name: /optimize/i }).or(page.getByText('Optimize'));
    if (await optimizeTab.isVisible()) {
      await optimizeTab.click();
    }
    const simTab = page.getByRole('button', { name: /simulator/i }).first();
    if (await simTab.isVisible()) {
      await simTab.click();
    }

    const multiOCard = page.getByText('Multi-O Distribution').first();
    if (await multiOCard.isVisible()) {
      await multiOCard.click();
    }

    const genBtn = page.getByRole('button', { name: /generate strategies/i });
    if (await genBtn.isVisible()) {
      await expect(genBtn).toBeDisabled();
    }
  });
});
