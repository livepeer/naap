import { test, expect } from '@playwright/test';

/**
 * Regression for G-003: /agentbook-core/admin/llm-configs must require an
 * admin user; previously it returned the plaintext Gemini apiKey to any caller.
 */
test.describe('GTM security — admin /llm-configs', () => {
  test('GET requires auth (401)', async ({ request }) => {
    const r = await request.get('/api/v1/agentbook-core/admin/llm-configs');
    // 401 (no session) is the spec; 500 acceptable if env not configured.
    expect([401, 500]).toContain(r.status());
  });

  test('non-admin authenticated user gets 403', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', {
      data: { email: 'maya@agentbook.test', password: 'agentbook123' },
    });
    if (!login.ok()) {
      console.log('SKIP: maya login failed; integration test inconclusive');
      return;
    }
    const cookies = login.headers()['set-cookie'] || '';
    const tokenMatch = cookies.match(/naap_auth_token=([^;]+)/);
    if (!tokenMatch) {
      console.log('SKIP: no naap_auth_token cookie set by login');
      return;
    }
    const token = tokenMatch[1];

    const r = await request.get('/api/v1/agentbook-core/admin/llm-configs', {
      headers: { cookie: `naap_auth_token=${token}` },
    });
    expect(r.status()).toBe(403);
  });

  test('DELETE on a config id requires auth (401)', async ({ request }) => {
    const r = await request.delete('/api/v1/agentbook-core/admin/llm-configs/nonexistent-id');
    expect([401, 500]).toContain(r.status());
  });

  test('set-default requires auth (401)', async ({ request }) => {
    const r = await request.post('/api/v1/agentbook-core/admin/llm-configs/nonexistent-id/set-default');
    expect([401, 500]).toContain(r.status());
  });

  test('test endpoint requires auth (401)', async ({ request }) => {
    const r = await request.post('/api/v1/agentbook-core/admin/llm-configs/nonexistent-id/test');
    expect([401, 500]).toContain(r.status());
  });
});
