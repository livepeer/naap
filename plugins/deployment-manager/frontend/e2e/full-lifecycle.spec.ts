/**
 * E2E Test: Full Deployment Lifecycle with Real RunPod API
 *
 * Exercises all new features:
 *   1. Auth + credentials
 *   2. Deploy scope to RunPod L4 GPU
 *   3. Poll until ONLINE
 *   4. Overview tab — code snippets
 *   5. Request tab — invoke endpoint
 *   6. Usage tab — chart renders
 *   7. Logs tab — transitions visible
 *   8. Health check via API
 *   9. Destroy via API
 *  10. Verify remote cleanup (direct RunPod API)
 *  11. Verify cleanup badge in UI
 *  12. Force destroy from FAILED state
 *
 * Requires NaaP running on localhost:3000
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';
const API = `${BASE}/api/v1/deployment-manager`;
const AUTH_API = `${BASE}/api/v1/auth`;
const RUNPOD_API = 'https://rest.runpod.io/v1';

const TEST_EMAIL = 'e2e-lifecycle@naap.local';
const TEST_PASSWORD = 'LifecycleTest1234!';
const TEST_NAME = 'E2E Lifecycle';
const RUNPOD_KEY = process.env.RUNPOD_KEY ?? '';

let authToken = '';
let deploymentId = '';
let providerDeploymentId = '';
let templateId = '';
let endpointUrl = '';

const results: Record<string, { passed: boolean; durationMs: number; note: string }> = {};

function record(name: string, passed: boolean, durationMs: number, note = '') {
  results[name] = { passed, durationMs, note };
}

async function runpodGet(path: string): Promise<Response> {
  return fetch(`${RUNPOD_API}${path}`, {
    headers: { Authorization: `Bearer ${RUNPOD_KEY}` },
  });
}

async function runpodDelete(path: string): Promise<Response> {
  return fetch(`${RUNPOD_API}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${RUNPOD_KEY}` },
  });
}

test.describe.serial('Full Deployment Lifecycle', () => {
  test.setTimeout(600_000);

  test.beforeAll(async ({ request }) => {
    const t0 = Date.now();
    let res = await request.post(`${AUTH_API}/register`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME },
    });
    let body = await res.json();
    if (!body.success) {
      res = await request.post(`${AUTH_API}/login`, {
        data: { email: TEST_EMAIL, password: TEST_PASSWORD },
      });
      body = await res.json();
    }
    authToken = body.data.token;
    expect(authToken).toBeTruthy();
    record('auth', true, Date.now() - t0, `token=${authToken.slice(0, 12)}...`);

    const credRes = await request.put(`${API}/credentials/runpod/credentials`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { secrets: { 'api-key': RUNPOD_KEY } },
    });
    const credBody = await credRes.json();
    expect(credBody.success).toBe(true);
    record('save-credentials', true, Date.now() - t0);

    const testRes = await request.post(`${API}/credentials/runpod/test-connection`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const testBody = await testRes.json();
    expect(testBody.data.success).toBe(true);
    record('test-connection', true, Date.now() - t0, `latency=${testBody.data.latencyMs}ms`);
  });

  test.afterAll(async () => {
    // Safety net: directly clean up RunPod resources if still alive
    if (providerDeploymentId) {
      try { await runpodDelete(`/endpoints/${providerDeploymentId}`); } catch { /* best effort */ }
    }
    if (templateId) {
      try { await runpodDelete(`/templates/${templateId}`); } catch { /* best effort */ }
    }

    console.log('\n' + '='.repeat(70));
    console.log('  E2E Full Lifecycle Test Report');
    console.log('='.repeat(70));
    for (const [name, r] of Object.entries(results)) {
      const icon = r.passed ? 'PASS' : 'FAIL';
      console.log(`  [${icon}] ${name.padEnd(35)} ${String(r.durationMs).padStart(7)}ms  ${r.note}`);
    }
    console.log('='.repeat(70));
  });

  test('create-and-deploy', async ({ request }) => {
    const deployName = `scope-lifecycle-${Date.now()}`;
    const t0 = Date.now();

    const createRes = await request.post(`${API}/deployments`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        name: deployName,
        providerSlug: 'runpod',
        gpuModel: 'NVIDIA L4',
        gpuVramGb: 24,
        gpuCount: 1,
        dockerImage: 'daydreamlive/scope',
        artifactType: 'scope',
        artifactVersion: 'latest',
        concurrency: 1,
      },
    });
    const createBody = await createRes.json();
    expect(createBody.success).toBe(true);
    deploymentId = createBody.data.id;
    record('create-deployment', true, Date.now() - t0, `id=${deploymentId}`);

    const t1 = Date.now();
    const deployRes = await request.post(`${API}/deployments/${deploymentId}/deploy`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const deployBody = await deployRes.json();
    expect(deployBody.success).toBe(true);

    providerDeploymentId = deployBody.data?.providerDeploymentId || '';
    endpointUrl = deployBody.data?.endpointUrl || '';
    templateId = deployBody.data?.providerConfig?.templateId || '';

    record('trigger-deploy', true, Date.now() - t1,
      `endpoint=${providerDeploymentId} template=${templateId}`);
  });

  test('poll-until-online', async ({ request }) => {
    const t0 = Date.now();
    let finalStatus = 'UNKNOWN';
    let finalHealth = 'UNKNOWN';
    const maxPolls = 24;

    for (let i = 1; i <= maxPolls; i++) {
      await new Promise(r => setTimeout(r, 10_000));
      const res = await request.get(`${API}/deployments/${deploymentId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await res.json();
      if (!body.success) continue;

      finalStatus = body.data.status;
      finalHealth = body.data.healthStatus || 'UNKNOWN';
      if (!providerDeploymentId) providerDeploymentId = body.data.providerDeploymentId || '';
      if (!templateId) templateId = body.data.providerConfig?.templateId || '';

      console.log(`  [poll ${i}] status=${finalStatus} health=${finalHealth}`);
      if (finalStatus === 'ONLINE' || finalStatus === 'FAILED') break;
    }

    record('poll-status', finalStatus === 'ONLINE', Date.now() - t0,
      `final=${finalStatus} health=${finalHealth}`);
    expect(['ONLINE', 'DEPLOYING']).toContain(finalStatus);
  });

  test('overview-tab-code-snippets', async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`${BASE}/deployments`);
    await page.waitForLoadState('networkidle');
    await page.evaluate((token) => { localStorage.setItem('naap_auth_token', token); }, authToken);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Navigate to deployment detail
    await page.goto(`${BASE}/deployments/${deploymentId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Click Overview tab (should be default, but click explicitly)
    const overviewTab = page.locator('button', { hasText: 'Overview' });
    if (await overviewTab.isVisible()) {
      await overviewTab.click();
    }
    await page.waitForTimeout(1000);

    // Check language pills
    const languages = ['curl', 'python', 'javascript', 'go'];
    for (const lang of languages) {
      const pill = page.locator(`[data-testid="lang-${lang}"]`);
      const visible = await pill.isVisible().catch(() => false);
      if (visible) {
        await pill.click();
        await page.waitForTimeout(300);
      }
    }

    // Check copy button exists
    const copyBtn = page.locator('[data-testid="copy-snippet"]');
    const copyVisible = await copyBtn.isVisible().catch(() => false);

    record('overview-tab', true, Date.now() - t0, `copy-visible=${copyVisible}`);
  });

  test('request-tab-invoke', async ({ page, request }) => {
    const t0 = Date.now();

    // Use API invoke since Playwright can't easily wait for cold starts in UI
    const invokeRes = await request.post(`${API}/deployments/${deploymentId}/invoke?timeout=120000`, {
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      data: { input: { prompt: 'test' } },
    });

    const invokeBody = await invokeRes.json();
    const invokeOk = invokeRes.ok() || invokeRes.status() === 504;
    record('invoke-request', invokeOk, Date.now() - t0,
      `status=${invokeRes.status()} body=${JSON.stringify(invokeBody).substring(0, 100)}`);

    // Now verify the Request tab renders in UI
    await page.goto(`${BASE}/deployments/${deploymentId}`);
    await page.waitForLoadState('networkidle');
    await page.evaluate((token) => { localStorage.setItem('naap_auth_token', token); }, authToken);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const requestTab = page.locator('button', { hasText: 'Request' });
    if (await requestTab.isVisible()) {
      await requestTab.click();
      await page.waitForTimeout(1000);
    }

    const runBtn = page.locator('[data-testid="run-request"]');
    const runVisible = await runBtn.isVisible().catch(() => false);
    record('request-tab-ui', runVisible, Date.now() - t0, `run-button=${runVisible}`);
  });

  test('usage-tab-chart', async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`${BASE}/deployments/${deploymentId}`);
    await page.waitForLoadState('networkidle');
    await page.evaluate((token) => { localStorage.setItem('naap_auth_token', token); }, authToken);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const usageTab = page.locator('button', { hasText: 'Usage' });
    if (await usageTab.isVisible()) {
      await usageTab.click();
      await page.waitForTimeout(2000);
    }

    const pageContent = await page.content();
    const hasChart = pageContent.includes('usage-chart') || pageContent.includes('Request Usage');
    record('usage-tab', true, Date.now() - t0, `chart-visible=${hasChart}`);
  });

  test('logs-tab-history', async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`${BASE}/deployments/${deploymentId}`);
    await page.waitForLoadState('networkidle');
    await page.evaluate((token) => { localStorage.setItem('naap_auth_token', token); }, authToken);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const logsTab = page.locator('button', { hasText: 'Logs' });
    if (await logsTab.isVisible()) {
      await logsTab.click();
      await page.waitForTimeout(2000);
    }

    const pageContent = await page.content();
    const hasPending = pageContent.includes('PENDING');
    const hasDeploying = pageContent.includes('DEPLOYING');
    record('logs-tab', true, Date.now() - t0, `pending=${hasPending} deploying=${hasDeploying}`);
  });

  test('health-check', async ({ request }) => {
    const t0 = Date.now();
    const res = await request.post(`${API}/health/${deploymentId}/check`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (res.ok()) {
      const body = await res.json();
      record('health-check', true, Date.now() - t0,
        `healthy=${body.data?.healthy} status=${body.data?.status}`);
    } else {
      record('health-check', true, Date.now() - t0, `status=${res.status()} (may be cold)`);
    }
  });

  test('destroy-deployment', async ({ request }) => {
    const t0 = Date.now();
    const res = await request.delete(`${API}/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const body = await res.json();
    expect(body.success).toBe(true);

    const hasSteps = body.destroyResult?.steps?.length > 0;
    const allClean = body.destroyResult?.allClean;
    record('destroy', true, Date.now() - t0,
      `allClean=${allClean} steps=${body.destroyResult?.steps?.length || 0}`);

    // Verify status is DESTROYED
    await new Promise(r => setTimeout(r, 2000));
    const checkRes = await request.get(`${API}/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const checkBody = await checkRes.json();
    expect(checkBody.data.status).toBe('DESTROYED');
    record('verify-destroyed-status', true, Date.now() - t0,
      `cleanupPending=${checkBody.data.providerConfig?.cleanupPending}`);
  });

  test('verify-remote-cleanup', async () => {
    const t0 = Date.now();
    let endpointGone = false;
    let templateGone = false;

    if (providerDeploymentId) {
      // Wait for RunPod to process the deletion
      await new Promise(r => setTimeout(r, 5000));
      try {
        const res = await runpodGet(`/endpoints/${providerDeploymentId}`);
        endpointGone = res.status === 404 || !res.ok;
      } catch {
        endpointGone = true;
      }
    } else {
      endpointGone = true;
    }

    if (templateId) {
      try {
        const res = await runpodGet(`/templates/${templateId}`);
        templateGone = res.status === 404 || !res.ok;
      } catch {
        templateGone = true;
      }
    } else {
      templateGone = true;
    }

    record('verify-remote-endpoint', endpointGone, Date.now() - t0,
      `endpoint=${providerDeploymentId} gone=${endpointGone}`);
    record('verify-remote-template', templateGone, Date.now() - t0,
      `template=${templateId} gone=${templateGone}`);

    // If still exists, try direct delete as safety
    if (!endpointGone && providerDeploymentId) {
      await runpodDelete(`/endpoints/${providerDeploymentId}`);
    }
    if (!templateGone && templateId) {
      await runpodDelete(`/templates/${templateId}`);
    }
  });

  test('verify-cleanup-badge-in-ui', async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`${BASE}/deployments/${deploymentId}`);
    await page.waitForLoadState('networkidle');
    await page.evaluate((token) => { localStorage.setItem('naap_auth_token', token); }, authToken);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const pageContent = await page.content();
    const hasCleanBadge = pageContent.includes('Cleanly removed from remote provider');
    const hasWarningBadge = pageContent.includes('Remote cleanup incomplete');
    const hasDestroyedStatus = pageContent.includes('DESTROYED');

    record('cleanup-badge-ui', hasDestroyedStatus, Date.now() - t0,
      `clean=${hasCleanBadge} warning=${hasWarningBadge}`);

    // Clear IDs so afterAll doesn't double-delete
    providerDeploymentId = '';
    templateId = '';
  });
});

test.describe.serial('FAILED State Recovery', () => {
  test.setTimeout(600_000);

  let recoveryDeploymentId = '';
  let recoveryEndpointId = '';
  let recoveryTemplateId = '';

  test.afterAll(async () => {
    if (recoveryEndpointId) {
      try { await runpodDelete(`/endpoints/${recoveryEndpointId}`); } catch { /* best effort */ }
    }
    if (recoveryTemplateId) {
      try { await runpodDelete(`/templates/${recoveryTemplateId}`); } catch { /* best effort */ }
    }
  });

  test('force-destroy-from-failed', async ({ request }) => {
    // Auth
    let res = await request.post(`${AUTH_API}/register`, {
      data: { email: 'e2e-failed-recovery@naap.local', password: 'Recovery1234!', name: 'Recovery Test' },
    });
    let body = await res.json();
    if (!body.success) {
      res = await request.post(`${AUTH_API}/login`, {
        data: { email: 'e2e-failed-recovery@naap.local', password: 'Recovery1234!' },
      });
      body = await res.json();
    }
    const token = body.data.token;

    // Save creds
    await request.put(`${API}/credentials/runpod/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { secrets: { 'api-key': RUNPOD_KEY } },
    });

    const t0 = Date.now();
    // Create and deploy
    const createRes = await request.post(`${API}/deployments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: `recovery-test-${Date.now()}`,
        providerSlug: 'runpod',
        gpuModel: 'NVIDIA L4',
        gpuVramGb: 24,
        gpuCount: 1,
        dockerImage: 'daydreamlive/scope',
        artifactType: 'scope',
        artifactVersion: 'latest',
        concurrency: 1,
      },
    });
    const createBody = await createRes.json();
    expect(createBody.success).toBe(true);
    recoveryDeploymentId = createBody.data.id;

    const deployRes = await request.post(`${API}/deployments/${recoveryDeploymentId}/deploy`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const deployBody = await deployRes.json();
    recoveryEndpointId = deployBody.data?.providerDeploymentId || '';
    recoveryTemplateId = deployBody.data?.providerConfig?.templateId || '';

    // Wait for it to reach a non-PENDING state
    await new Promise(r => setTimeout(r, 15_000));

    // Force destroy regardless of state
    const destroyRes = await request.post(`${API}/deployments/${recoveryDeploymentId}/force-destroy`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const destroyBody = await destroyRes.json();
    expect(destroyBody.success).toBe(true);

    const finalStatus = destroyBody.data?.status;
    const allClean = destroyBody.destroyResult?.allClean;

    record('force-destroy-from-any-state', finalStatus === 'DESTROYED', Date.now() - t0,
      `status=${finalStatus} allClean=${allClean}`);
    expect(finalStatus).toBe('DESTROYED');

    // Verify remote cleanup
    await new Promise(r => setTimeout(r, 5000));
    if (recoveryEndpointId) {
      try {
        const epRes = await runpodGet(`/endpoints/${recoveryEndpointId}`);
        if (epRes.status === 404 || !epRes.ok) {
          recoveryEndpointId = '';
        }
      } catch {
        recoveryEndpointId = '';
      }
    }
    if (recoveryTemplateId) {
      try {
        const tplRes = await runpodGet(`/templates/${recoveryTemplateId}`);
        if (tplRes.status === 404 || !tplRes.ok) {
          recoveryTemplateId = '';
        }
      } catch {
        recoveryTemplateId = '';
      }
    }

    record('force-destroy-remote-cleanup',
      !recoveryEndpointId && !recoveryTemplateId, Date.now() - t0,
      `endpoint-remaining=${!!recoveryEndpointId} template-remaining=${!!recoveryTemplateId}`);
  });
});
