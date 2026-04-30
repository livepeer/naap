import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const BASE = 'http://localhost:3000';
const T = `p10-${Date.now()}`;
const H = { 'x-tenant-id': T, 'Content-Type': 'application/json' };

test.describe('Phase 10: Multi-Agent System', () => {
  test('list all 4 agents', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/agents`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const agents = (await res.json()).data;
    expect(agents).toHaveLength(4);
    const ids = agents.map((a: any) => a.id);
    expect(ids).toContain('bookkeeper');
    expect(ids).toContain('tax-strategist');
    expect(ids).toContain('collections');
    expect(ids).toContain('insights');
  });

  test('each agent has default config', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/agents`, { headers: H });
    const agents = (await res.json()).data;
    for (const agent of agents) {
      expect(agent.config).toHaveProperty('aggressiveness');
      expect(agent.config).toHaveProperty('autoApprove');
      expect(agent.config).toHaveProperty('enabled');
      expect(agent.config.enabled).toBe(true);
    }
  });

  test('update agent aggressiveness', async ({ request }) => {
    const res = await request.put(`${CORE}/api/v1/agentbook-core/agents/collections/config`, {
      headers: H, data: { aggressiveness: 0.8 },
    });
    expect(res.ok()).toBeTruthy();
    const config = (await res.json()).data;
    expect(config.aggressiveness).toBe(0.8);
  });

  test('toggle agent auto-approve', async ({ request }) => {
    const res = await request.put(`${CORE}/api/v1/agentbook-core/agents/bookkeeper/config`, {
      headers: H, data: { autoApprove: true },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.autoApprove).toBe(true);
  });

  test('change notification frequency', async ({ request }) => {
    const res = await request.put(`${CORE}/api/v1/agentbook-core/agents/insights/config`, {
      headers: H, data: { notificationFrequency: 'weekly' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.notificationFrequency).toBe('weekly');
  });

  test('disable agent', async ({ request }) => {
    await request.put(`${CORE}/api/v1/agentbook-core/agents/insights/config`, {
      headers: H, data: { enabled: false },
    });
    const agents = (await (await request.get(`${CORE}/api/v1/agentbook-core/agents`, { headers: H })).json()).data;
    const insights = agents.find((a: any) => a.id === 'insights');
    expect(insights.config.enabled).toBe(false);
  });

  test('agents endpoint through proxy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/agentbook-core/agents`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('UI: agents page loads', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const email = page.locator('input[type="email"], input[name="email"]');
    if (await email.isVisible({ timeout: 3000 }).catch(() => false)) {
      await email.fill('admin@a3p.io');
      await page.locator('input[type="password"]').fill('a3p-dev');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(3000);
    }
    await page.goto(`${BASE}/agentbook/agents`);
    await page.waitForTimeout(4000);
    const text = await page.textContent('body') || '';
    expect(text.length).toBeGreaterThan(100);
  });
});
