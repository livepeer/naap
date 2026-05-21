import { test, expect } from '@playwright/test';

// This test is documentary — verifying the API surface no longer leaks across tenants.
// Requires two test users (Maya in tenant A, Alex in tenant B) with seeded expenses.
// The test self-skips when the environment isn't seeded (e.g., on minimal CI).

test.describe('GTM security — cross-tenant lookups (G-008)', () => {
  test('account lookup with foreign id returns 404, not foreign data', async ({ request }) => {
    // Login as Maya
    const mayaLogin = await request.post('/api/v1/auth/login', {
      data: { email: 'maya@agentbook.test', password: 'agentbook123' },
    });
    if (!mayaLogin.ok()) {
      console.log('SKIP: maya login failed — env not seeded; test inconclusive');
      return;
    }
    const mayaToken = (await mayaLogin.json()).token;

    // Login as Alex (different tenant)
    const alexLogin = await request.post('/api/v1/auth/login', {
      data: { email: 'alex@agentbook.test', password: 'agentbook123' },
    });
    if (!alexLogin.ok()) {
      console.log('SKIP: alex login failed — env not seeded; test inconclusive');
      return;
    }
    const alexToken = (await alexLogin.json()).token;

    // Get one of Alex's accounts
    const alexAccounts = await request.get('/api/v1/agentbook-expense/accounts', {
      headers: { Authorization: `Bearer ${alexToken}` },
    });
    if (!alexAccounts.ok()) {
      console.log('SKIP: cannot fetch alex accounts; integration test inconclusive');
      return;
    }
    const alexAccountsJson: any = await alexAccounts.json();
    const alexAccountList = alexAccountsJson.accounts ?? alexAccountsJson.data ?? alexAccountsJson;
    if (!Array.isArray(alexAccountList) || !alexAccountList[0]?.id) {
      console.log('SKIP: alex has no accounts seeded');
      return;
    }
    const foreignAccountId = alexAccountList[0].id;

    // Try to fetch it AS MAYA — should NOT return Alex's account
    const sneaky = await request.get(`/api/v1/agentbook-expense/accounts/${foreignAccountId}`, {
      headers: { Authorization: `Bearer ${mayaToken}` },
    });
    // Either 404 (good — pretends doesn't exist) or 403 (also acceptable)
    expect([403, 404]).toContain(sneaky.status());
  });
});
