/**
 * E2E Integration Test: RunPod + Scope + RTX 4090
 *
 * Tests the full deployment lifecycle with mocked RunPod API responses.
 * Exercises every major code path:
 *   1. Provider listing and GPU options
 *   2. Credential save / status / test-connection
 *   3. Template listing and version resolution
 *   4. Deployment creation
 *   5. Deploy execution (template create → endpoint create)
 *   6. Status polling
 *   7. Health check
 *   8. Update lifecycle
 *   9. Destroy lifecycle
 *  10. Audit trail
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { ProviderAdapterRegistry } from '../services/ProviderAdapterRegistry.js';
import { DeploymentOrchestrator } from '../services/DeploymentOrchestrator.js';
import { AuditService } from '../services/AuditService.js';
import { TemplateRegistry } from '../services/TemplateRegistry.js';
import { HealthMonitorService } from '../services/HealthMonitorService.js';
import { CostEstimationService } from '../services/CostEstimationService.js';
import { RunPodAdapter } from '../adapters/RunPodAdapter.js';
import { InMemoryDeploymentStore } from '../store/InMemoryDeploymentStore.js';
import { createProvidersRouter } from '../routes/providers.js';
import { createDeploymentsRouter } from '../routes/deployments.js';
import { createTemplatesRouter } from '../routes/templates.js';
import { createHealthRouter } from '../routes/health.js';
import { createAuditRouter } from '../routes/audit.js';
import { createCostRouter } from '../routes/cost.js';
import { createCredentialsRouter } from '../routes/credentials.js';
import { setAuthContext } from '../lib/providerFetch.js';
import { secretStore } from '../lib/SecretStore.js';

vi.mock('../lib/providerFetch.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    resolveUserId: vi.fn().mockResolvedValue('e2e-test-user-001'),
    authenticatedProviderFetch: (_slug: string, apiConfig: any, path: string, options?: RequestInit) => {
      return actual.providerFetch(apiConfig.upstreamBaseUrl, path, options);
    },
  };
});

const TEST_USER_ID = 'e2e-test-user-001';
const TEST_API_KEY = 'rp_E2E_TEST_KEY_not_real';

let mockRunPodApi: Server;
let mockRunPodPort: number;
let app: express.Express;
let server: Server;
let port: number;

function createMockRunPodApi(): express.Express {
  const rpApp = express();
  rpApp.use(express.json());

  const deletedEndpoints = new Set<string>();
  const deletedTemplates = new Set<string>();

  rpApp.get('/v1/gpu-types', (_req, res) => {
    res.json([
      { id: 'NVIDIA GeForce RTX 4090', displayName: 'NVIDIA RTX 4090', memoryInGb: 24, securePrice: 0.44, available: true },
      { id: 'NVIDIA A100-SXM4-80GB', displayName: 'NVIDIA A100 80GB', memoryInGb: 80, securePrice: 1.99, available: true },
    ]);
  });

  rpApp.post('/v1/templates', (req, res) => {
    res.status(201).json({
      id: 'tmpl-scope-e2e-001',
      name: req.body.name,
      imageName: req.body.imageName,
      isServerless: true,
    });
  });

  rpApp.delete('/v1/templates/:id', (req, res) => {
    deletedTemplates.add(req.params.id);
    res.status(204).end();
  });

  rpApp.post('/v1/endpoints', (req, res) => {
    res.status(201).json({
      id: 'ep-scope-e2e-001',
      name: req.body.name,
      templateId: req.body.templateId,
      gpuTypeIds: req.body.gpuTypeIds,
      workersMin: req.body.workersMin,
      workersMax: req.body.workersMax,
      status: 'INITIALIZING',
    });
  });

  rpApp.get('/v1/endpoints/:id', (req, res) => {
    if (deletedEndpoints.has(req.params.id)) {
      res.status(404).json({ error: 'endpoint not found', status: 404 });
      return;
    }
    res.json({
      id: req.params.id,
      templateId: 'tmpl-scope-e2e-001',
      status: 'READY',
      workers: { running: 1, idle: 0 },
    });
  });

  rpApp.get('/v1/endpoints/:id/health', (req, res) => {
    if (deletedEndpoints.has(req.params.id)) {
      res.status(404).json({ error: 'endpoint not found', status: 404 });
      return;
    }
    res.json({
      status: 'READY',
      workers: { running: 1, idle: 0 },
    });
  });

  rpApp.put('/v1/endpoints/:id', (req, res) => {
    res.json({
      id: req.params.id,
      ...req.body,
      status: 'READY',
    });
  });

  rpApp.delete('/v1/endpoints/:id', (req, res) => {
    deletedEndpoints.add(req.params.id);
    res.json({ id: req.params.id, deleted: true });
  });

  return rpApp;
}

describe('E2E: RunPod + Scope + RTX 4090 Deployment', () => {
  let registry: ProviderAdapterRegistry;
  let orchestrator: DeploymentOrchestrator;
  let audit: AuditService;
  let templateRegistry: TemplateRegistry;
  let healthMonitor: HealthMonitorService;
  let costService: CostEstimationService;

  beforeAll(async () => {
    const rpApp = createMockRunPodApi();
    mockRunPodApi = await new Promise<Server>((resolve) => {
      const s = rpApp.listen(0, () => resolve(s));
    });
    mockRunPodPort = (mockRunPodApi.address() as any).port;

    const runpodAdapter = new RunPodAdapter();
    (runpodAdapter.apiConfig as any).upstreamBaseUrl = `http://localhost:${mockRunPodPort}/v1`;

    registry = new ProviderAdapterRegistry();
    registry.register(runpodAdapter);

    audit = new AuditService();
    templateRegistry = new TemplateRegistry();
    const store = new InMemoryDeploymentStore();
    orchestrator = new DeploymentOrchestrator(registry, audit, store);
    healthMonitor = new HealthMonitorService(registry, orchestrator, {
      intervalMs: 999999,
      degradedThresholdMs: 5000,
      failureThreshold: 3,
    });
    costService = new CostEstimationService(registry);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      setAuthContext({
        authorization: 'Bearer e2e-test-token',
        teamId: 'team-e2e',
      });
      (req as any).user = { id: TEST_USER_ID };
      next();
    });

    const prefix = '/api/v1/deployment-manager';
    app.use(`${prefix}/providers`, createProvidersRouter(registry));
    app.use(`${prefix}/deployments`, createDeploymentsRouter(orchestrator));
    app.use(`${prefix}/templates`, createTemplatesRouter(templateRegistry));
    app.use(`${prefix}/health`, createHealthRouter(healthMonitor, orchestrator));
    app.use(`${prefix}/audit`, createAuditRouter(audit));
    app.use(`${prefix}/cost`, createCostRouter(costService));
    app.use(`${prefix}/credentials`, createCredentialsRouter(registry));

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    port = (server.address() as any).port;
  });

  afterAll(() => {
    server?.close();
    mockRunPodApi?.close();
  });

  const api = (path: string, options?: RequestInit) =>
    fetch(`http://localhost:${port}/api/v1/deployment-manager${path}`, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-test-token' },
      ...options,
    });

  // ─── 1. Provider Listing ───────────────────────────────────────────

  it('1. lists RunPod as a registered provider', async () => {
    const res = await api('/providers');
    const body = await res.json();
    expect(body.success).toBe(true);
    const runpod = body.data.find((p: any) => p.slug === 'runpod');
    expect(runpod).toBeDefined();
    expect(runpod.displayName).toBe('RunPod Serverless GPU');
    expect(runpod.mode).toBe('serverless');
    expect(runpod.secretNames).toEqual(['api-key']);
  });

  it('2. fetches GPU options (static fallback — RunPod REST has no GPU list)', async () => {
    const res = await api('/providers/runpod/gpu-options');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const rtx4090 = body.data.find((g: any) => g.id === 'NVIDIA GeForce RTX 4090');
    expect(rtx4090).toBeDefined();
    expect(rtx4090.vramGb).toBe(24);
  });

  // ─── 2. Credential Management ─────────────────────────────────────

  it('3. credential-status shows not configured initially', async () => {
    const res = await api('/credentials/runpod/credential-status');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.configured).toBe(false);
    expect(body.data.secrets).toEqual([{ name: 'api-key', configured: false }]);
  });

  it('4. saves RunPod API key', async () => {
    const res = await api('/credentials/runpod/credentials', {
      method: 'PUT',
      body: JSON.stringify({ secrets: { 'api-key': TEST_API_KEY } }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.savedSecrets).toEqual(['api-key']);
  });

  it('5. credential-status shows configured after save', async () => {
    const res = await api('/credentials/runpod/credential-status');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.configured).toBe(true);
    expect(body.data.secrets).toEqual([{ name: 'api-key', configured: true }]);
  });

  it('6. validates secret names (rejects invalid)', async () => {
    const res = await api('/credentials/runpod/credentials', {
      method: 'PUT',
      body: JSON.stringify({ secrets: { 'invalid-key': 'value' } }),
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid secret names');
  });

  it('7. validates empty values (rejects)', async () => {
    const res = await api('/credentials/runpod/credentials', {
      method: 'PUT',
      body: JSON.stringify({ secrets: { 'api-key': '  ' } }),
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('cannot be empty');
  });

  it('8. test-connection calls the upstream API', async () => {
    const res = await api('/credentials/runpod/test-connection', { method: 'POST' });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.statusCode).toBeDefined();
    expect(body.data.latencyMs).toBeDefined();
  });

  // ─── 3. Template Discovery ─────────────────────────────────────────

  it('9. lists templates including Scope', async () => {
    const res = await api('/templates');
    const body = await res.json();
    expect(body.success).toBe(true);
    const scope = body.data.find((t: any) => t.id === 'scope');
    expect(scope).toBeDefined();
    expect(scope.name).toBe('Daydream Scope');
    expect(scope.dockerImage).toBe('daydreamlive/scope');
    expect(scope.healthPort).toBe(8188);
    expect(scope.healthEndpoint).toBe('/health');
    expect(scope.category).toBe('curated');
  });

  // ─── 4. Deployment Lifecycle ───────────────────────────────────────

  let deploymentId: string;

  it('10. creates a Scope deployment on RunPod with RTX 4090', async () => {
    const res = await api('/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name: 'scope-runpod-e2e',
        providerSlug: 'runpod',
        gpuModel: 'NVIDIA GeForce RTX 4090',
        gpuVramGb: 24,
        gpuCount: 1,
        artifactType: 'scope',
        artifactVersion: 'latest',
        dockerImage: 'daydreamlive/scope:latest',
        healthPort: 8188,
        healthEndpoint: '/health',
        templateId: 'scope',
        concurrency: 1,
      }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe('PENDING');
    expect(body.data.providerSlug).toBe('runpod');
    expect(body.data.gpuModel).toBe('NVIDIA GeForce RTX 4090');
    expect(body.data.dockerImage).toBe('daydreamlive/scope:latest');
    deploymentId = body.data.id;
  });

  it('11. deployment is in PENDING state with correct config', async () => {
    const res = await api(`/deployments/${deploymentId}`);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('PENDING');
    expect(body.data.name).toBe('scope-runpod-e2e');
    expect(body.data.concurrency).toBe(1);
    expect(body.data.healthEndpoint).toBe('/health');
  });

  it('12. deploys to RunPod (template create + endpoint create + health check)', async () => {
    const res = await api(`/deployments/${deploymentId}/deploy`, { method: 'POST' });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.providerDeploymentId).toBe('ep-scope-e2e-001');
    expect(body.data.endpointUrl).toBe('https://api.runpod.ai/v2/ep-scope-e2e-001');
    expect(['ONLINE', 'VALIDATING', 'FAILED']).toContain(body.data.status);
  });

  it('13. deployment status is ONLINE after deploy', async () => {
    const res = await api(`/deployments/${deploymentId}`);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ONLINE');
    expect(body.data.healthStatus).toBe('GREEN');
    expect(body.data.providerDeploymentId).toBe('ep-scope-e2e-001');
  });

  it('14. status history tracks full lifecycle', async () => {
    const res = await api(`/deployments/${deploymentId}/history`);
    const body = await res.json();
    expect(body.success).toBe(true);
    const statuses = body.data.map((e: any) => e.toStatus);
    expect(statuses).toContain('PENDING');
    expect(statuses).toContain('DEPLOYING');
    expect(statuses).toContain('VALIDATING');
    expect(statuses).toContain('ONLINE');
  });

  // ─── 5. Health Check ───────────────────────────────────────────────

  it('15. health check returns GREEN for running deployment', async () => {
    const res = await api(`/health/${deploymentId}/check`, { method: 'POST' });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.healthy).toBe(true);
    expect(body.data.status).toBe('GREEN');
    expect(body.data.statusCode).toBe(200);
    expect(body.data.responseTimeMs).toBeDefined();
  });

  // ─── 6. Update Lifecycle ───────────────────────────────────────────

  it('16. updates deployment image version', async () => {
    const res = await api(`/deployments/${deploymentId}`, {
      method: 'PUT',
      body: JSON.stringify({
        dockerImage: 'daydreamlive/scope:v2.0.0',
        artifactVersion: 'v2.0.0',
      }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ONLINE');
    expect(body.data.dockerImage).toBe('daydreamlive/scope:v2.0.0');
    expect(body.data.artifactVersion).toBe('v2.0.0');
  });

  // ─── 7. Cost Estimation ────────────────────────────────────────────

  it('17. estimates cost for RTX 4090 on RunPod', async () => {
    const res = await api('/cost/estimate?provider=runpod&gpu=NVIDIA GeForce RTX 4090&count=1');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.gpuCostPerHour).toBeGreaterThan(0);
    expect(body.data.totalCostPerDay).toBeGreaterThan(0);
    expect(body.data.currency).toBe('USD');
  });

  // ─── 8. Audit Trail ───────────────────────────────────────────────

  it('18. audit trail records all actions', async () => {
    const res = await api('/audit');
    const body = await res.json();
    expect(body.success).toBe(true);
    const actions = body.data.map((e: any) => e.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('DEPLOY');
    expect(actions).toContain('UPDATE');
  });

  // ─── 9. Destroy Lifecycle ──────────────────────────────────────────

  it('19. destroys the deployment', async () => {
    const res = await api(`/deployments/${deploymentId}`, { method: 'DELETE' });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('DESTROYED');
  });

  it('20. destroyed deployment is DESTROYED in status', async () => {
    const res = await api(`/deployments/${deploymentId}`);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('DESTROYED');
  });

  it('21. cannot re-deploy a destroyed deployment', async () => {
    const res = await api(`/deployments/${deploymentId}/deploy`, { method: 'POST' });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid state transition');
  });

  it('22. audit trail includes DESTROY action', async () => {
    const res = await api('/audit');
    const body = await res.json();
    const actions = body.data.map((e: any) => e.action);
    expect(actions).toContain('DESTROY');
  });

  // ─── 10. Deployment List & Filters ─────────────────────────────────

  it('23. lists deployments with filters', async () => {
    const res = await api('/deployments?status=DESTROYED');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.every((d: any) => d.status === 'DESTROYED')).toBe(true);
  });

  // ─── 11. Error Handling ────────────────────────────────────────────

  it('24. returns 404 for unknown provider', async () => {
    const res = await api('/providers/unknown-provider/gpu-options');
    expect(res.status).toBe(404);
  });

  it('25. rejects invalid deployment config', async () => {
    const res = await api('/deployments', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
    });
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('26. returns 404 for non-existent deployment', async () => {
    const res = await api('/deployments/does-not-exist');
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  // ─── 12. SecretStore Isolation ─────────────────────────────────────

  it('27. secrets are isolated per user+provider', async () => {
    const status1 = await secretStore.hasSecrets(TEST_USER_ID, 'runpod', ['api-key']);
    expect(status1[0].configured).toBe(true);

    const status2 = await secretStore.hasSecrets('other-user', 'runpod', ['api-key']);
    expect(status2[0].configured).toBe(false);

    const status3 = await secretStore.hasSecrets(TEST_USER_ID, 'fal-ai', ['api-key']);
    expect(status3[0].configured).toBe(false);
  });
});
