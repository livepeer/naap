import { test, expect } from '@playwright/test';

// G-002 regression: the vulnerable /switch-tenant endpoint was deleted.
// Previously: `GET /api/v1/agentbook/switch-tenant?id=<any-uuid>` was unauthenticated
// and would set the `ab-tenant` cookie to ANY value with no allowlist, enabling
// anonymous cross-tenant impersonation. The cookie also had no consumers in app code,
// so the safest fix was to remove the route entirely.
//
// This test guards against accidental re-introduction.

test('GET /switch-tenant route deleted (no longer exists)', async ({ request }) => {
  const r = await request.get('/api/v1/agentbook/switch-tenant?id=any');
  expect(r.status()).toBe(404);
});

test('GET /switch-tenant (no params) route deleted (no longer exists)', async ({ request }) => {
  const r = await request.get('/api/v1/agentbook/switch-tenant');
  expect(r.status()).toBe(404);
});
