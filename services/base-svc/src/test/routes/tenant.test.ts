/**
 * Tenant Routes – Contract Tests
 *
 * Covers multi-tenant plugin installations (list, get, create, delete,
 * preferences, config) and deployment management (list, by-name, stats, users).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  createMockDb,
  createMockTenantService,
  createMockDeploymentService,
  createMockRbacService,
  createMockLifecycleService,
} from '../helpers';
import { createTenantRoutes } from '../../routes/tenant';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let db: ReturnType<typeof createMockDb>;
let tenantService: ReturnType<typeof createMockTenantService>;
let deploymentService: ReturnType<typeof createMockDeploymentService>;
let rbacService: ReturnType<typeof createMockRbacService>;
let lifecycleService: ReturnType<typeof createMockLifecycleService>;
let app: ReturnType<typeof createTestApp>;

const mockGetUserId = vi.fn().mockResolvedValue('user-1');
const noopMiddleware = (_req: any, _res: any, next: any) => next();

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  tenantService = createMockTenantService();
  deploymentService = createMockDeploymentService();
  rbacService = createMockRbacService();
  lifecycleService = createMockLifecycleService();
  app = createTestApp();

  const routes = createTenantRoutes({
    db,
    tenantService,
    deploymentService,
    rbacService,
    lifecycleService,
    getUserIdFromRequest: mockGetUserId,
    csrfProtection: noopMiddleware,
    tenantMiddleware: noopMiddleware,
    forwardTenantHeaders: noopMiddleware,
  });

  app.use('/api/v1', routes);
  mockGetUserId.mockResolvedValue('user-1');
});

// ---------------------------------------------------------------------------
// Tenant Installations
// ---------------------------------------------------------------------------

describe('Tenant Installations', () => {
  it('GET /tenant/installations returns list', async () => {
    tenantService.listUserInstallations.mockResolvedValue([{ id: 'i-1' }]);
    const res = await request(app).get('/api/v1/tenant/installations');
    expect(res.status).toBe(200);
    expect(res.body.installations).toHaveLength(1);
  });

  it('GET /tenant/installations returns 401 when not authenticated', async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/tenant/installations');
    expect(res.status).toBe(401);
  });

  it('GET /tenant/installations/:installId returns installation', async () => {
    tenantService.getInstallation.mockResolvedValue({ id: 'i-1', pluginName: 'test' });
    const res = await request(app).get('/api/v1/tenant/installations/i-1');
    expect(res.status).toBe(200);
    expect(res.body.installation.id).toBe('i-1');
  });

  it('GET /tenant/installations/:installId returns 404 if not found', async () => {
    tenantService.getInstallation.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/tenant/installations/nonexistent');
    expect(res.status).toBe(404);
  });

  it('GET /tenant/installations/plugin/:pluginName returns installation', async () => {
    tenantService.getInstallationByPlugin.mockResolvedValue({ id: 'i-1' });
    const res = await request(app).get('/api/v1/tenant/installations/plugin/my-plugin');
    expect(res.status).toBe(200);
    expect(res.body.installation.id).toBe('i-1');
  });

  it('GET /tenant/installations/plugin/:pluginName returns 404 if not installed', async () => {
    tenantService.getInstallationByPlugin.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/tenant/installations/plugin/missing');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Create / Delete Installation
// ---------------------------------------------------------------------------

describe('Create / Delete Installation', () => {
  it('POST /tenant/installations requires packageName', async () => {
    const res = await request(app).post('/api/v1/tenant/installations').send({});
    expect(res.status).toBe(400);
  });

  it('POST /tenant/installations returns 404 for unknown package', async () => {
    db.pluginPackage.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/tenant/installations').send({ packageName: 'ghost' });
    expect(res.status).toBe(404);
  });

  it('POST /tenant/installations creates installation', async () => {
    db.pluginPackage.findUnique.mockResolvedValue({ id: 'pkg-1', name: 'my-pkg' });
    deploymentService.getOrCreateDeployment.mockResolvedValue({
      deployment: { id: 'dep-1', version: { version: '1.0.0', frontendUrl: null } },
      isNew: false,
    });
    tenantService.createInstallation.mockResolvedValue({ install: { id: 'i-new' }, isFirstInstall: true });

    const res = await request(app).post('/api/v1/tenant/installations').send({ packageName: 'my-pkg' });
    expect(res.status).toBe(201);
    expect(res.body.installation.id).toBe('i-new');
    expect(res.body.isFirstInstall).toBe(true);
    expect(lifecycleService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant_install' }),
    );
  });

  it('POST /tenant/installations returns 409 for duplicate', async () => {
    db.pluginPackage.findUnique.mockResolvedValue({ id: 'pkg-1', name: 'my-pkg' });
    deploymentService.getOrCreateDeployment.mockResolvedValue({
      deployment: { id: 'dep-1', version: { version: '1.0.0', frontendUrl: null } },
      isNew: false,
    });
    tenantService.createInstallation.mockRejectedValue(new Error('Plugin is already installed for this user'));

    const res = await request(app).post('/api/v1/tenant/installations').send({ packageName: 'my-pkg' });
    expect(res.status).toBe(409);
  });

  it('DELETE /tenant/installations/:installId uninstalls', async () => {
    tenantService.uninstall.mockResolvedValue({ success: true, shouldCleanup: false, deploymentId: 'dep-1' });
    db.pluginDeployment.findUnique.mockResolvedValue({
      package: { name: 'my-pkg' }, version: { version: '1.0.0' },
    });

    const res = await request(app).delete('/api/v1/tenant/installations/i-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(lifecycleService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant_uninstall' }),
    );
  });

  it('DELETE /tenant/installations/:installId triggers cleanup when needed', async () => {
    tenantService.uninstall.mockResolvedValue({ success: true, shouldCleanup: true, deploymentId: 'dep-1' });
    db.pluginDeployment.findUnique.mockResolvedValue({ package: { name: 'p' }, version: { version: '1' } });

    await request(app).delete('/api/v1/tenant/installations/i-1');
    expect(deploymentService.cleanupDeployment).toHaveBeenCalledWith('dep-1');
  });

  it('DELETE /tenant/installations/:installId returns 404 for missing', async () => {
    tenantService.uninstall.mockRejectedValue(new Error('Installation not found'));
    const res = await request(app).delete('/api/v1/tenant/installations/missing');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Preferences & Config
// ---------------------------------------------------------------------------

describe('Preferences & Config', () => {
  it('PATCH /tenant/installations/:id/preferences updates preferences', async () => {
    tenantService.updatePreferences.mockResolvedValue({ id: 'i-1', enabled: true, pinned: true });
    const res = await request(app)
      .patch('/api/v1/tenant/installations/i-1/preferences')
      .send({ enabled: true, pinned: true });
    expect(res.status).toBe(200);
    expect(res.body.installation).toBeDefined();
  });

  it('GET /tenant/installations/:id/config returns config', async () => {
    tenantService.getConfig.mockResolvedValue({ settings: { theme: 'dark' } });
    const res = await request(app).get('/api/v1/tenant/installations/i-1/config');
    expect(res.status).toBe(200);
    expect(res.body.config.settings.theme).toBe('dark');
  });

  it('GET /tenant/installations/:id/config returns default when null', async () => {
    tenantService.getConfig.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/tenant/installations/i-1/config');
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({ settings: {} });
  });

  it('PUT /tenant/installations/:id/config updates config', async () => {
    tenantService.updateConfig.mockResolvedValue({ settings: { key: 'val' } });
    const res = await request(app)
      .put('/api/v1/tenant/installations/i-1/config')
      .send({ settings: { key: 'val' } });
    expect(res.status).toBe(200);
    expect(res.body.config.settings.key).toBe('val');
  });
});

// ---------------------------------------------------------------------------
// Deployment Management (Admin)
// ---------------------------------------------------------------------------

describe('Deployment Management', () => {
  it('GET /deployments returns 401 when not authenticated', async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/deployments');
    expect(res.status).toBe(401);
  });

  it('GET /deployments returns 403 for non-admin', async () => {
    rbacService.hasRole.mockResolvedValue(false);
    const res = await request(app).get('/api/v1/deployments');
    expect(res.status).toBe(403);
  });

  it('GET /deployments returns list for admin', async () => {
    rbacService.hasRole.mockResolvedValue(true);
    deploymentService.listDeployments.mockResolvedValue([{ id: 'd-1' }]);
    const res = await request(app).get('/api/v1/deployments');
    expect(res.status).toBe(200);
    expect(res.body.deployments).toHaveLength(1);
  });

  it('GET /deployments/package/:name returns deployment', async () => {
    deploymentService.getDeploymentByName.mockResolvedValue({ id: 'd-1' });
    const res = await request(app).get('/api/v1/deployments/package/my-plugin');
    expect(res.status).toBe(200);
    expect(res.body.deployment.id).toBe('d-1');
  });

  it('GET /deployments/package/:name returns 404 if not found', async () => {
    deploymentService.getDeploymentByName.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/deployments/package/missing');
    expect(res.status).toBe(404);
  });

  it('GET /deployments/stats returns stats for admin', async () => {
    rbacService.hasRole.mockResolvedValue(true);
    deploymentService.getStats.mockResolvedValue({ total: 10, active: 5 });
    const res = await request(app).get('/api/v1/deployments/stats');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
  });

  it('GET /deployments/:id/users returns user list for admin', async () => {
    rbacService.hasRole.mockResolvedValue(true);
    tenantService.getUsersWithPlugin.mockResolvedValue(['u-1', 'u-2']);
    const res = await request(app).get('/api/v1/deployments/dep-1/users');
    expect(res.status).toBe(200);
    expect(res.body.userIds).toEqual(['u-1', 'u-2']);
    expect(res.body.count).toBe(2);
  });
});
