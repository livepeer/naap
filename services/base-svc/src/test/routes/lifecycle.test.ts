/**
 * Lifecycle Routes - Contract Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createLifecycleRoutes } from '../../routes/lifecycle';
import { createTestApp, createMockDb, createMockLifecycleService, createMockSecretVaultService } from '../helpers';

describe('Lifecycle Routes', () => {
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof createMockDb>;
  let lifecycleService: ReturnType<typeof createMockLifecycleService>;
  let secretVaultService: ReturnType<typeof createMockSecretVaultService>;

  beforeEach(() => {
    db = createMockDb();
    lifecycleService = createMockLifecycleService();
    secretVaultService = {
      ...createMockSecretVaultService(),
      getIntegrationSecret: vi.fn().mockResolvedValue(null),
      getGlobalIntegrationSecret: vi.fn().mockResolvedValue(null),
    };

    app = createTestApp();
    const router = createLifecycleRoutes({ db, lifecycleService, secretVaultService });
    app.use('/api/v1', router);
  });

  // --------------------------------------------------------------------------
  // Plugin Installation
  // --------------------------------------------------------------------------

  describe('GET /api/v1/installations', () => {
    it('returns installation list', async () => {
      db.pluginInstallation.findMany.mockResolvedValue([]);
      db.workflowPlugin.findMany.mockResolvedValue([]);
      const res = await request(app).get('/api/v1/installations');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ installations: [] });
    });
  });

  describe('GET /api/v1/installations/:packageName', () => {
    it('returns 404 when package not found', async () => {
      db.pluginPackage.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/installations/missing-pkg');
      expect(res.status).toBe(404);
    });

    it('returns installed: false when not installed', async () => {
      db.pluginPackage.findUnique.mockResolvedValue({ id: 'pkg-1' });
      db.pluginInstallation.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/installations/my-plugin');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ installed: false });
    });
  });

  describe('POST /api/v1/installations', () => {
    it('returns 400 when packageName missing', async () => {
      const res = await request(app).post('/api/v1/installations').send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 when package not found', async () => {
      db.pluginPackage.findUnique.mockResolvedValue(null);
      const res = await request(app).post('/api/v1/installations').send({ packageName: 'nope' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/installations/:packageName', () => {
    it('returns 404 when package not found', async () => {
      db.pluginPackage.findUnique.mockResolvedValue(null);
      const res = await request(app).delete('/api/v1/installations/nope');
      expect(res.status).toBe(404);
    });
  });

  // --------------------------------------------------------------------------
  // Integration Configuration
  // --------------------------------------------------------------------------

  describe('GET /api/v1/integrations', () => {
    it('returns integrations with built-in defaults', async () => {
      db.integrationConfig.findMany.mockResolvedValue([]);
      const res = await request(app).get('/api/v1/integrations');
      expect(res.status).toBe(200);
      expect(res.body.integrations.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('GET /api/v1/integrations/:type/status', () => {
    it('returns configured status', async () => {
      db.integrationConfig.findUnique.mockResolvedValue({ configured: true });
      const res = await request(app).get('/api/v1/integrations/openai/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true, configured: true });
    });

    it('returns not configured when missing', async () => {
      db.integrationConfig.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/integrations/openai/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true, configured: false });
    });
  });

  describe('POST /api/v1/integrations/:type/configure', () => {
    it('upserts integration config', async () => {
      db.integrationConfig.upsert.mockResolvedValue({
        type: 'openai', displayName: 'OpenAI', configured: true,
      });
      const res = await request(app)
        .post('/api/v1/integrations/openai/configure')
        .send({ credentials: { key: 'sk-xxx' } });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/v1/integrations/:type/call', () => {
    it('returns 400 when not configured', async () => {
      db.integrationConfig.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/v1/integrations/openai/call')
        .send({ method: 'complete', args: ['hello'] });
      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Plugin Lifecycle Events
  // --------------------------------------------------------------------------

  describe('GET /api/v1/lifecycle/plugins/:pluginName/events', () => {
    it('returns events for a plugin', async () => {
      lifecycleService.getPluginEvents.mockResolvedValue([{ action: 'install' }]);
      const res = await request(app).get('/api/v1/lifecycle/plugins/my-plugin/events');
      expect(res.status).toBe(200);
      expect(lifecycleService.getPluginEvents).toHaveBeenCalledWith('my-plugin', 50);
    });
  });

  describe('GET /api/v1/lifecycle/events', () => {
    it('returns recent events', async () => {
      lifecycleService.getRecentEvents.mockResolvedValue([]);
      const res = await request(app).get('/api/v1/lifecycle/events');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/lifecycle/install', () => {
    it('returns 400 when packageId missing', async () => {
      const res = await request(app).post('/api/v1/lifecycle/install').send({ versionId: 'v1' });
      expect(res.status).toBe(400);
    });

    it('installs plugin via lifecycle service', async () => {
      lifecycleService.installPlugin.mockResolvedValue({ success: true });
      const res = await request(app)
        .post('/api/v1/lifecycle/install')
        .send({ packageId: 'pkg-1', versionId: 'v-1' });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/lifecycle/uninstall', () => {
    it('returns 400 when packageId missing', async () => {
      const res = await request(app).post('/api/v1/lifecycle/uninstall').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/lifecycle/upgrade', () => {
    it('returns 400 when required fields missing', async () => {
      const res = await request(app).post('/api/v1/lifecycle/upgrade').send({ packageId: 'p' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/lifecycle/enable', () => {
    it('returns 400 when pluginName missing', async () => {
      const res = await request(app).post('/api/v1/lifecycle/enable').send({});
      expect(res.status).toBe(400);
    });

    it('enables plugin', async () => {
      lifecycleService.enablePlugin.mockResolvedValue({ enabled: true });
      const res = await request(app).post('/api/v1/lifecycle/enable').send({ pluginName: 'p' });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/lifecycle/disable', () => {
    it('returns 400 when pluginName missing', async () => {
      const res = await request(app).post('/api/v1/lifecycle/disable').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/audit', () => {
    it('returns audit logs', async () => {
      lifecycleService.getAuditLogs.mockResolvedValue([]);
      const res = await request(app).get('/api/v1/audit');
      expect(res.status).toBe(200);
    });
  });
});
