/**
 * E2E Integration Tests for ALL Provider Adapters
 *
 * Each adapter gets a mock upstream API server and a full lifecycle test:
 *   credential save → deploy → status → health → update → destroy → audit
 *
 * Adapters tested:
 *   1. fal.ai      — /applications endpoints, Key auth
 *   2. Replicate   — /deployments endpoints, Bearer auth
 *   3. Baseten     — /models endpoints, Bearer auth
 *   4. Modal       — /apps endpoints, Bearer auth
 *   5. SSH Bridge  — /connect + /exec/script, no auth (ssh-key based)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { ProviderAdapterRegistry } from '../services/ProviderAdapterRegistry.js';
import { DeploymentOrchestrator } from '../services/DeploymentOrchestrator.js';
import { AuditService } from '../services/AuditService.js';
import { HealthMonitorService } from '../services/HealthMonitorService.js';
import { CostEstimationService } from '../services/CostEstimationService.js';
import { TemplateRegistry } from '../services/TemplateRegistry.js';
import { FalAdapter } from '../adapters/FalAdapter.js';
import { ReplicateAdapter } from '../adapters/ReplicateAdapter.js';
import { BasetenAdapter } from '../adapters/BasetenAdapter.js';
import { ModalAdapter } from '../adapters/ModalAdapter.js';
import { SshBridgeAdapter } from '../adapters/SshBridgeAdapter.js';
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

const TEST_USER_ID = 'e2e-all-adapters-user';

vi.mock('../lib/providerFetch.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    resolveUserId: vi.fn().mockResolvedValue('e2e-all-adapters-user'),
    authenticatedProviderFetch: (_slug: string, apiConfig: any, path: string, options?: RequestInit) => {
      return actual.providerFetch(apiConfig.upstreamBaseUrl, path, options);
    },
  };
});

// ─── Mock Provider APIs ──────────────────────────────────────────────

function createMockFalApi(): express.Express {
  const app = express();
  app.use(express.json());

  app.post('/applications', (req, res) => {
    res.status(201).json({
      id: 'fal-app-001',
      application_id: 'fal-app-001',
      url: 'https://fal.run/fal-app-001',
      status: 'DEPLOYING',
    });
  });
  app.get('/applications/:id', (req, res) => {
    res.json({ id: req.params.id, status: 'ACTIVE', url: `https://fal.run/${req.params.id}` });
  });
  app.put('/applications/:id', (req, res) => {
    res.json({ id: req.params.id, status: 'ACTIVE', url: `https://fal.run/${req.params.id}` });
  });
  app.delete('/applications/:id', (_req, res) => {
    res.json({ deleted: true });
  });
  return app;
}

function createMockReplicateApi(): express.Express {
  const app = express();
  app.use(express.json());

  app.post('/v1/deployments', (req, res) => {
    res.status(201).json({
      owner: req.body.owner,
      name: req.body.name,
      current_release: { url: `https://api.replicate.com/v1/deployments/${req.body.owner}/${req.body.name}/predictions` },
    });
  });
  app.get('/v1/deployments/:owner/:name', (req, res) => {
    res.json({
      owner: req.params.owner,
      name: req.params.name,
      current_release: { url: `https://api.replicate.com/v1/deployments/${req.params.owner}/${req.params.name}/predictions` },
    });
  });
  app.patch('/v1/deployments/:owner/:name', (req, res) => {
    res.json({
      owner: req.params.owner,
      name: req.params.name,
      current_release: { url: `https://api.replicate.com/v1/deployments/${req.params.owner}/${req.params.name}/predictions` },
    });
  });
  app.delete('/v1/deployments/:owner/:name', (_req, res) => {
    res.json({ deleted: true });
  });
  return app;
}

function createMockBasetenApi(): express.Express {
  const app = express();
  app.use(express.json());

  app.post('/v1/models', (req, res) => {
    res.status(201).json({
      model_id: 'bt-model-001',
      id: 'bt-model-001',
      name: req.body.name,
      status: 'BUILDING',
      url: `https://model-bt-model-001.api.baseten.co/production/predict`,
    });
  });
  app.get('/v1/models/:id', (req, res) => {
    res.json({ id: req.params.id, status: 'ACTIVE', url: `https://model-${req.params.id}.api.baseten.co/production/predict` });
  });
  app.patch('/v1/models/:id', (req, res) => {
    res.json({ id: req.params.id, status: 'ACTIVE', url: `https://model-${req.params.id}.api.baseten.co/production/predict` });
  });
  app.delete('/v1/models/:id', (_req, res) => {
    res.json({ deleted: true });
  });
  return app;
}

function createMockModalApi(): express.Express {
  const app = express();
  app.use(express.json());

  app.post('/v1/apps', (req, res) => {
    res.status(201).json({
      app_id: 'modal-app-001',
      id: 'modal-app-001',
      web_url: `https://${req.body.name}--serve.modal.run`,
      state: 'deploying',
    });
  });
  app.get('/v1/apps/:id', (req, res) => {
    res.json({ id: req.params.id, state: 'deployed', web_url: `https://app--serve.modal.run` });
  });
  app.put('/v1/apps/:id', (req, res) => {
    res.json({ id: req.params.id, state: 'deployed', web_url: `https://app--serve.modal.run` });
  });
  app.delete('/v1/apps/:id', (_req, res) => {
    res.json({ deleted: true });
  });
  return app;
}

function createMockSshBridgeApi(): express.Express {
  const app = express();
  app.use(express.json());

  app.post('/connect', (_req, res) => {
    res.json({ connected: true });
  });
  app.post('/exec/script', (_req, res) => {
    res.json({ data: { jobId: 'ssh-job-001', status: 'completed', exitCode: 0 } });
  });
  app.get('/jobs/:id', (req, res) => {
    res.json({ data: { jobId: req.params.id, status: 'completed', exitCode: 0 } });
  });
  app.post('/exec', (_req, res) => {
    res.json({ data: { exitCode: 0, stdout: '200' } });
  });
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return app;
}

// ─── Test Infrastructure ────────────────────────────────────────────

interface MockServer {
  server: Server;
  port: number;
}

async function startMockServer(mockApp: express.Express): Promise<MockServer> {
  return new Promise((resolve) => {
    const s = mockApp.listen(0, () => {
      resolve({ server: s, port: (s.address() as any).port });
    });
  });
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe('E2E: All Provider Adapters Full Lifecycle', () => {
  const mockServers: MockServer[] = [];
  let appServer: Server;
  let port: number;

  beforeAll(async () => {
    const falMock = await startMockServer(createMockFalApi());
    const replicateMock = await startMockServer(createMockReplicateApi());
    const basetenMock = await startMockServer(createMockBasetenApi());
    const modalMock = await startMockServer(createMockModalApi());
    const sshMock = await startMockServer(createMockSshBridgeApi());
    mockServers.push(falMock, replicateMock, basetenMock, modalMock, sshMock);

    const falAdapter = new FalAdapter();
    (falAdapter.apiConfig as any).upstreamBaseUrl = `http://localhost:${falMock.port}`;

    const replicateAdapter = new ReplicateAdapter();
    (replicateAdapter.apiConfig as any).upstreamBaseUrl = `http://localhost:${replicateMock.port}/v1`;

    const basetenAdapter = new BasetenAdapter();
    (basetenAdapter.apiConfig as any).upstreamBaseUrl = `http://localhost:${basetenMock.port}/v1`;

    const modalAdapter = new ModalAdapter();
    (modalAdapter.apiConfig as any).upstreamBaseUrl = `http://localhost:${modalMock.port}/v1`;

    const sshAdapter = new SshBridgeAdapter();
    (sshAdapter.apiConfig as any).upstreamBaseUrl = `http://localhost:${sshMock.port}`;

    const registry = new ProviderAdapterRegistry();
    registry.register(falAdapter);
    registry.register(replicateAdapter);
    registry.register(basetenAdapter);
    registry.register(modalAdapter);
    registry.register(sshAdapter);

    const audit = new AuditService();
    const store = new InMemoryDeploymentStore();
    const orchestrator = new DeploymentOrchestrator(registry, audit, store);
    const healthMonitor = new HealthMonitorService(registry, orchestrator, {
      intervalMs: 999999,
      degradedThresholdMs: 5000,
      failureThreshold: 3,
    });
    const costService = new CostEstimationService(registry);
    const templateRegistry = new TemplateRegistry();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      setAuthContext({ authorization: 'Bearer e2e-token', teamId: 'team-e2e' });
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

    appServer = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    port = (appServer.address() as any).port;
  });

  afterAll(() => {
    appServer?.close();
    mockServers.forEach((m) => m.server.close());
  });

  const api = (path: string, options?: RequestInit) =>
    fetch(`http://localhost:${port}/api/v1/deployment-manager${path}`, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-token' },
      ...options,
    });

  // ═══════════════════════════════════════════════════════════════════
  //  fal.ai Adapter
  // ═══════════════════════════════════════════════════════════════════

  describe('fal.ai', () => {
    let deploymentId: string;

    it('lists as a provider with Key auth', async () => {
      const res = await api('/providers');
      const body = await res.json();
      const fal = body.data.find((p: any) => p.slug === 'fal-ai');
      expect(fal).toBeDefined();
      expect(fal.displayName).toBe('fal.ai Serverless GPU');
      expect(fal.secretNames).toEqual(['api-key']);
    });

    it('returns static GPU options', async () => {
      const res = await api('/providers/fal-ai/gpu-options');
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(6);
      expect(body.data.find((g: any) => g.id === 'A100')).toBeDefined();
    });

    it('saves and verifies credentials', async () => {
      let res = await api('/credentials/fal-ai/credential-status');
      let body = await res.json();
      expect(body.data.configured).toBe(false);

      res = await api('/credentials/fal-ai/credentials', {
        method: 'PUT',
        body: JSON.stringify({ secrets: { 'api-key': 'fal_test_key_123' } }),
      });
      body = await res.json();
      expect(body.success).toBe(true);

      res = await api('/credentials/fal-ai/credential-status');
      body = await res.json();
      expect(body.data.configured).toBe(true);
    });

    it('test-connection reaches upstream', async () => {
      const res = await api('/credentials/fal-ai/test-connection', { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.latencyMs).toBeDefined();
    });

    it('creates deployment', async () => {
      const res = await api('/deployments', {
        method: 'POST',
        body: JSON.stringify({
          name: 'scope-fal-e2e',
          providerSlug: 'fal-ai',
          gpuModel: 'A100',
          gpuVramGb: 80,
          gpuCount: 1,
          artifactType: 'scope',
          artifactVersion: 'latest',
          dockerImage: 'daydreamlive/scope:latest',
          healthPort: 8188,
          healthEndpoint: '/health',
          concurrency: 5,
        }),
      });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('PENDING');
      deploymentId = body.data.id;
    });

    it('deploys → ONLINE (application created + health checked)', async () => {
      const res = await api(`/deployments/${deploymentId}/deploy`, { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.providerDeploymentId).toBe('fal-app-001');
      expect(body.data.status).toBe('ONLINE');
      expect(body.data.healthStatus).toBe('GREEN');
    });

    it('on-demand health check returns GREEN', async () => {
      const res = await api(`/health/${deploymentId}/check`, { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.healthy).toBe(true);
      expect(body.data.status).toBe('GREEN');
    });

    it('updates image version', async () => {
      const res = await api(`/deployments/${deploymentId}`, {
        method: 'PUT',
        body: JSON.stringify({ dockerImage: 'daydreamlive/scope:v2.0.0', artifactVersion: 'v2.0.0' }),
      });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ONLINE');
    });

    it('destroys and verifies DESTROYED', async () => {
      let res = await api(`/deployments/${deploymentId}`, { method: 'DELETE' });
      let body = await res.json();
      expect(body.data.status).toBe('DESTROYED');

      res = await api(`/deployments/${deploymentId}`);
      body = await res.json();
      expect(body.data.status).toBe('DESTROYED');
    });

    it('status history has full lifecycle', async () => {
      const res = await api(`/deployments/${deploymentId}/history`);
      const body = await res.json();
      const statuses = body.data.map((e: any) => e.toStatus);
      expect(statuses).toContain('PENDING');
      expect(statuses).toContain('DEPLOYING');
      expect(statuses).toContain('ONLINE');
      expect(statuses).toContain('DESTROYED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Replicate Adapter
  // ═══════════════════════════════════════════════════════════════════

  describe('Replicate', () => {
    let deploymentId: string;

    it('lists as a provider with Bearer auth', async () => {
      const res = await api('/providers');
      const body = await res.json();
      const rep = body.data.find((p: any) => p.slug === 'replicate');
      expect(rep).toBeDefined();
      expect(rep.displayName).toBe('Replicate Deployments');
      expect(rep.secretNames).toEqual(['api-key']);
    });

    it('saves and verifies credentials', async () => {
      let res = await api('/credentials/replicate/credentials', {
        method: 'PUT',
        body: JSON.stringify({ secrets: { 'api-key': 'r8_test_replicate_key' } }),
      });
      let body = await res.json();
      expect(body.success).toBe(true);

      res = await api('/credentials/replicate/credential-status');
      body = await res.json();
      expect(body.data.configured).toBe(true);
    });

    it('creates deployment', async () => {
      const res = await api('/deployments', {
        method: 'POST',
        body: JSON.stringify({
          name: 'scope-replicate-e2e',
          providerSlug: 'replicate',
          gpuModel: 'gpu-a100-large',
          gpuVramGb: 80,
          gpuCount: 1,
          artifactType: 'scope',
          artifactVersion: 'latest',
          dockerImage: 'daydreamlive/scope:latest',
          healthPort: 8188,
          healthEndpoint: '/health',
          concurrency: 3,
        }),
      });
      const body = await res.json();
      expect(body.success).toBe(true);
      deploymentId = body.data.id;
    });

    it('deploys → ONLINE', async () => {
      const res = await api(`/deployments/${deploymentId}/deploy`, { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.providerDeploymentId).toBe('naap/scope-replicate-e2e');
      expect(body.data.status).toBe('ONLINE');
      expect(body.data.healthStatus).toBe('GREEN');
    });

    it('health check returns GREEN', async () => {
      const res = await api(`/health/${deploymentId}/check`, { method: 'POST' });
      const body = await res.json();
      expect(body.data.healthy).toBe(true);
    });

    it('updates and destroys', async () => {
      let res = await api(`/deployments/${deploymentId}`, {
        method: 'PUT',
        body: JSON.stringify({ dockerImage: 'daydreamlive/scope:v2.0.0', artifactVersion: 'v2.0.0' }),
      });
      let body = await res.json();
      expect(body.data.status).toBe('ONLINE');

      res = await api(`/deployments/${deploymentId}`, { method: 'DELETE' });
      body = await res.json();
      expect(body.data.status).toBe('DESTROYED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Baseten Adapter
  // ═══════════════════════════════════════════════════════════════════

  describe('Baseten', () => {
    let deploymentId: string;

    it('lists as a provider', async () => {
      const res = await api('/providers');
      const body = await res.json();
      const bt = body.data.find((p: any) => p.slug === 'baseten');
      expect(bt).toBeDefined();
      expect(bt.displayName).toBe('Baseten Model Deployment');
    });

    it('saves and verifies credentials', async () => {
      let res = await api('/credentials/baseten/credentials', {
        method: 'PUT',
        body: JSON.stringify({ secrets: { 'api-key': 'bt_test_key_456' } }),
      });
      let body = await res.json();
      expect(body.success).toBe(true);

      res = await api('/credentials/baseten/credential-status');
      body = await res.json();
      expect(body.data.configured).toBe(true);
    });

    it('creates and deploys → ONLINE', async () => {
      let res = await api('/deployments', {
        method: 'POST',
        body: JSON.stringify({
          name: 'scope-baseten-e2e',
          providerSlug: 'baseten',
          gpuModel: 'A100',
          gpuVramGb: 40,
          gpuCount: 1,
          artifactType: 'scope',
          artifactVersion: 'latest',
          dockerImage: 'daydreamlive/scope:latest',
          healthPort: 8188,
          healthEndpoint: '/health',
          concurrency: 3,
        }),
      });
      let body = await res.json();
      expect(body.success).toBe(true);
      deploymentId = body.data.id;

      res = await api(`/deployments/${deploymentId}/deploy`, { method: 'POST' });
      body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.providerDeploymentId).toBe('bt-model-001');
      expect(body.data.status).toBe('ONLINE');
      expect(body.data.healthStatus).toBe('GREEN');
    });

    it('health check returns GREEN', async () => {
      const res = await api(`/health/${deploymentId}/check`, { method: 'POST' });
      const body = await res.json();
      expect(body.data.healthy).toBe(true);
    });

    it('updates and destroys', async () => {
      let res = await api(`/deployments/${deploymentId}`, {
        method: 'PUT',
        body: JSON.stringify({ dockerImage: 'daydreamlive/scope:v2.0.0', artifactVersion: 'v2.0.0' }),
      });
      let body = await res.json();
      expect(body.data.status).toBe('ONLINE');

      res = await api(`/deployments/${deploymentId}`, { method: 'DELETE' });
      body = await res.json();
      expect(body.data.status).toBe('DESTROYED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Modal Adapter
  // ═══════════════════════════════════════════════════════════════════

  describe('Modal', () => {
    let deploymentId: string;

    it('lists as a provider', async () => {
      const res = await api('/providers');
      const body = await res.json();
      const modal = body.data.find((p: any) => p.slug === 'modal');
      expect(modal).toBeDefined();
      expect(modal.displayName).toBe('Modal Serverless GPU');
    });

    it('saves and verifies credentials', async () => {
      let res = await api('/credentials/modal/credentials', {
        method: 'PUT',
        body: JSON.stringify({ secrets: { 'api-key': 'modal_test_token_789' } }),
      });
      let body = await res.json();
      expect(body.success).toBe(true);

      res = await api('/credentials/modal/credential-status');
      body = await res.json();
      expect(body.data.configured).toBe(true);
    });

    it('creates and deploys → ONLINE', async () => {
      let res = await api('/deployments', {
        method: 'POST',
        body: JSON.stringify({
          name: 'scope-modal-e2e',
          providerSlug: 'modal',
          gpuModel: 'a100-80gb',
          gpuVramGb: 80,
          gpuCount: 1,
          artifactType: 'scope',
          artifactVersion: 'latest',
          dockerImage: 'daydreamlive/scope:latest',
          healthPort: 8188,
          healthEndpoint: '/health',
          concurrency: 5,
        }),
      });
      let body = await res.json();
      expect(body.success).toBe(true);
      deploymentId = body.data.id;

      res = await api(`/deployments/${deploymentId}/deploy`, { method: 'POST' });
      body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.providerDeploymentId).toBe('modal-app-001');
      expect(body.data.status).toBe('ONLINE');
      expect(body.data.healthStatus).toBe('GREEN');
    });

    it('health check returns GREEN', async () => {
      const res = await api(`/health/${deploymentId}/check`, { method: 'POST' });
      const body = await res.json();
      expect(body.data.healthy).toBe(true);
      expect(body.data.status).toBe('GREEN');
    });

    it('updates and destroys', async () => {
      let res = await api(`/deployments/${deploymentId}`, {
        method: 'PUT',
        body: JSON.stringify({ dockerImage: 'daydreamlive/scope:v2.0.0', artifactVersion: 'v2.0.0' }),
      });
      let body = await res.json();
      expect(body.data.status).toBe('ONLINE');

      res = await api(`/deployments/${deploymentId}`, { method: 'DELETE' });
      body = await res.json();
      expect(body.data.status).toBe('DESTROYED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  SSH Bridge Adapter
  // ═══════════════════════════════════════════════════════════════════

  describe('SSH Bridge', () => {
    let deploymentId: string;

    it('lists as ssh-bridge provider', async () => {
      const res = await api('/providers');
      const body = await res.json();
      const ssh = body.data.find((p: any) => p.slug === 'ssh-bridge');
      expect(ssh).toBeDefined();
      expect(ssh.mode).toBe('ssh-bridge');
      expect(ssh.displayName).toBe('SSH Bridge (Bare-Metal / VM)');
    });

    it('creates SSH deployment with host config', async () => {
      const res = await api('/deployments', {
        method: 'POST',
        body: JSON.stringify({
          name: 'scope-ssh-e2e',
          providerSlug: 'ssh-bridge',
          gpuModel: 'NVIDIA RTX 4090',
          gpuVramGb: 24,
          gpuCount: 1,
          artifactType: 'scope',
          artifactVersion: 'latest',
          dockerImage: 'daydreamlive/scope:latest',
          healthPort: 8188,
          healthEndpoint: '/health',
          sshHost: '10.0.0.100',
          sshPort: 22,
          sshUsername: 'deploy',
        }),
      });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('PENDING');
      expect(body.data.sshHost).toBe('10.0.0.100');
      expect(body.data.sshUsername).toBe('deploy');
      deploymentId = body.data.id;
    });

    it('deploys via SSH (connect + script + poll → ONLINE)', async () => {
      const res = await api(`/deployments/${deploymentId}/deploy`, { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.providerDeploymentId).toContain('10.0.0.100');
      expect(body.data.providerDeploymentId).toContain('ssh-job-001');
      expect(body.data.endpointUrl).toBe('http://10.0.0.100:8188');
      expect(body.data.status).toBe('ONLINE');
    }, 20_000);

    it('health check via SSH returns GREEN', async () => {
      const res = await api(`/health/${deploymentId}/check`, { method: 'POST' });
      const body = await res.json();
      expect(body.data.healthy).toBe(true);
      expect(body.data.status).toBe('GREEN');
    });

    it('destroys SSH deployment', async () => {
      const res = await api(`/deployments/${deploymentId}`, { method: 'DELETE' });
      const body = await res.json();
      expect(body.data.status).toBe('DESTROYED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Cross-Adapter Verification
  // ═══════════════════════════════════════════════════════════════════

  describe('Cross-adapter', () => {
    it('all 5 providers are registered', async () => {
      const res = await api('/providers');
      const body = await res.json();
      expect(body.data.length).toBe(5);
      const slugs = body.data.map((p: any) => p.slug).sort();
      expect(slugs).toEqual(['baseten', 'fal-ai', 'modal', 'replicate', 'ssh-bridge']);
    });

    it('audit trail contains actions from all adapters', async () => {
      const res = await api('/audit');
      const body = await res.json();
      const providers = [...new Set(body.data.filter((a: any) => a.details?.provider).map((a: any) => a.details.provider))];
      expect(providers).toContain('fal-ai');
      expect(providers).toContain('replicate');
      expect(providers).toContain('baseten');
      expect(providers).toContain('modal');
      expect(providers).toContain('ssh-bridge');
    });

    it('secrets are isolated across providers', async () => {
      const falStatus = await secretStore.hasSecrets(TEST_USER_ID, 'fal-ai', ['api-key']);
      const repStatus = await secretStore.hasSecrets(TEST_USER_ID, 'replicate', ['api-key']);
      const btStatus = await secretStore.hasSecrets(TEST_USER_ID, 'baseten', ['api-key']);
      const modalStatus = await secretStore.hasSecrets(TEST_USER_ID, 'modal', ['api-key']);

      expect(falStatus[0].configured).toBe(true);
      expect(repStatus[0].configured).toBe(true);
      expect(btStatus[0].configured).toBe(true);
      expect(modalStatus[0].configured).toBe(true);

      const otherUser = await secretStore.hasSecrets('other-user', 'fal-ai', ['api-key']);
      expect(otherUser[0].configured).toBe(false);
    });

    it('all deployments in DESTROYED state', async () => {
      const res = await api('/deployments?status=DESTROYED');
      const body = await res.json();
      expect(body.data.length).toBe(5);
    });
  });
});
