/**
 * RBAC Routes - Contract Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createRbacRoutes } from '../../routes/rbac';
import {
  createTestApp,
  createMockRbacService,
  createMockDelegationService,
  createMockLifecycleService,
} from '../helpers';

describe('RBAC Routes', () => {
  let app: ReturnType<typeof createTestApp>;
  let rbacService: ReturnType<typeof createMockRbacService>;
  let delegationService: ReturnType<typeof createMockDelegationService>;
  let lifecycleService: ReturnType<typeof createMockLifecycleService>;
  const mockGetUserId = vi.fn().mockResolvedValue('requester-1');

  beforeEach(() => {
    rbacService = createMockRbacService();
    delegationService = createMockDelegationService();
    lifecycleService = createMockLifecycleService();
    mockGetUserId.mockResolvedValue('requester-1');

    app = createTestApp();
    const router = createRbacRoutes({
      rbacService,
      delegationService,
      lifecycleService,
      getUserIdFromRequest: mockGetUserId,
    });
    app.use('/api/v1', router);
  });

  // --------------------------------------------------------------------------
  // Core RBAC
  // --------------------------------------------------------------------------

  describe('GET /api/v1/roles', () => {
    it('returns roles list', async () => {
      rbacService.getRoles.mockResolvedValue([{ name: 'admin', permissions: ['all'] }]);
      const res = await request(app).get('/api/v1/roles');
      expect(res.status).toBe(200);
      expect(res.body.roles).toHaveLength(1);
    });
  });

  describe('POST /api/v1/roles', () => {
    it('returns 400 when required fields missing', async () => {
      const res = await request(app).post('/api/v1/roles').send({ name: 'r' });
      expect(res.status).toBe(400);
    });

    it('creates role and audits', async () => {
      rbacService.upsertRole.mockResolvedValue({ name: 'editor' });
      const res = await request(app)
        .post('/api/v1/roles')
        .set('x-user-id', 'user-1')
        .send({ name: 'editor', displayName: 'Editor', permissions: ['read', 'write'] });
      expect(res.status).toBe(200);
      expect(lifecycleService.audit).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/v1/roles/:name', () => {
    it('deletes role and audits', async () => {
      const res = await request(app).delete('/api/v1/roles/editor').set('x-user-id', 'u');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it('returns 400 when service throws', async () => {
      rbacService.deleteRole.mockRejectedValue(new Error('Cannot delete built-in'));
      const res = await request(app).delete('/api/v1/roles/admin');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/users/:userId/roles', () => {
    it('returns 400 when roleName missing', async () => {
      const res = await request(app).post('/api/v1/users/u1/roles').send({});
      expect(res.status).toBe(400);
    });

    it('returns 401 when not authenticated', async () => {
      mockGetUserId.mockResolvedValue(null);
      const res = await request(app).post('/api/v1/users/u1/roles').send({ roleName: 'r' });
      expect(res.status).toBe(401);
    });

    it('assigns role with audit', async () => {
      const res = await request(app).post('/api/v1/users/u1/roles').send({ roleName: 'editor' });
      expect(res.status).toBe(200);
      expect(rbacService.assignRoleWithAudit).toHaveBeenCalledWith(
        'u1', 'editor', 'requester-1', expect.any(Object)
      );
    });
  });

  describe('DELETE /api/v1/users/:userId/roles/:roleName', () => {
    it('returns 401 when not authenticated', async () => {
      mockGetUserId.mockResolvedValue(null);
      const res = await request(app).delete('/api/v1/users/u1/roles/editor');
      expect(res.status).toBe(401);
    });

    it('revokes role', async () => {
      const res = await request(app).delete('/api/v1/users/u1/roles/editor');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/users/:userId/roles', () => {
    it('returns 404 when user not found', async () => {
      rbacService.getUserWithRoles.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/users/u1/roles');
      expect(res.status).toBe(404);
    });

    it('returns user with roles', async () => {
      rbacService.getUserWithRoles.mockResolvedValue({ id: 'u1', roles: [] });
      const res = await request(app).get('/api/v1/users/u1/roles');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/users/:userId/permissions/check', () => {
    it('returns 400 without resource and action', async () => {
      const res = await request(app).get('/api/v1/users/u1/permissions/check');
      expect(res.status).toBe(400);
    });

    it('returns allowed boolean', async () => {
      rbacService.hasPermission.mockResolvedValue(true);
      const res = await request(app).get('/api/v1/users/u1/permissions/check?resource=plugin&action=read');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ allowed: true });
    });
  });

  describe('GET /api/v1/users/:userId/permissions', () => {
    it('returns permissions', async () => {
      rbacService.getUserPermissions.mockResolvedValue([{ resource: 'plugin', action: 'read' }]);
      const res = await request(app).get('/api/v1/users/u1/permissions');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/users/:userId/permissions/effective', () => {
    it('returns effective permissions', async () => {
      rbacService.getEffectivePermissions.mockResolvedValue([]);
      const res = await request(app).get('/api/v1/users/u1/permissions/effective');
      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // Admin API
  // --------------------------------------------------------------------------

  describe('GET /api/v1/admin/users', () => {
    it('returns 401 when not authenticated', async () => {
      mockGetUserId.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/admin/users');
      expect(res.status).toBe(401);
    });

    it('returns 403 when not admin', async () => {
      delegationService.isSystemAdmin.mockResolvedValue(false);
      const res = await request(app).get('/api/v1/admin/users');
      expect(res.status).toBe(403);
    });

    it('returns users when admin', async () => {
      delegationService.isSystemAdmin.mockResolvedValue(true);
      rbacService.getAllUsersWithRoles.mockResolvedValue([{ id: 'u1' }]);
      const res = await request(app).get('/api/v1/admin/users');
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
    });
  });

  describe('GET /api/v1/admin/roles/assignable', () => {
    it('returns 401 when not authenticated', async () => {
      mockGetUserId.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/admin/roles/assignable');
      expect(res.status).toBe(401);
    });

    it('returns assignable roles', async () => {
      delegationService.getAssignableRoles.mockResolvedValue([{ name: 'editor' }]);
      const res = await request(app).get('/api/v1/admin/roles/assignable');
      expect(res.status).toBe(200);
      expect(res.body.roles).toHaveLength(1);
    });
  });

  describe('GET /api/v1/admin/audit', () => {
    it('returns 403 when not admin', async () => {
      delegationService.isSystemAdmin.mockResolvedValue(false);
      const res = await request(app).get('/api/v1/admin/audit');
      expect(res.status).toBe(403);
    });

    it('returns audit logs when admin', async () => {
      delegationService.isSystemAdmin.mockResolvedValue(true);
      lifecycleService.getAuditLogs.mockResolvedValue([{ action: 'role.upsert' }]);
      const res = await request(app).get('/api/v1/admin/audit');
      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Plugin Admin API
  // --------------------------------------------------------------------------

  describe('GET /api/v1/plugins/:pluginName/admin/users', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/v1/plugins/my-plugin/admin/users');
      expect(res.status).toBe(401);
    });

    it('returns 403 when not plugin admin', async () => {
      delegationService.isPluginAdmin.mockResolvedValue(false);
      delegationService.isSystemAdmin.mockResolvedValue(false);
      const res = await request(app)
        .get('/api/v1/plugins/my-plugin/admin/users')
        .set('x-user-id', 'user-1');
      expect(res.status).toBe(403);
    });

    it('returns users when plugin admin', async () => {
      delegationService.isPluginAdmin.mockResolvedValue(true);
      delegationService.getPluginUsers.mockResolvedValue([{ id: 'u1' }]);
      const res = await request(app)
        .get('/api/v1/plugins/my-plugin/admin/users')
        .set('x-user-id', 'user-1');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/plugins/:pluginName/admin/users/:userId/roles', () => {
    it('returns 403 for cross-plugin role assignment', async () => {
      delegationService.isPluginAdmin.mockResolvedValue(true);
      const res = await request(app)
        .post('/api/v1/plugins/my-plugin/admin/users/u1/roles')
        .set('x-user-id', 'admin-1')
        .send({ roleName: 'other-plugin:editor' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/outside your plugin scope/);
    });

    it('assigns scoped role when plugin admin', async () => {
      delegationService.isPluginAdmin.mockResolvedValue(true);
      const res = await request(app)
        .post('/api/v1/plugins/my-plugin/admin/users/u1/roles')
        .set('x-user-id', 'admin-1')
        .send({ roleName: 'my-plugin:editor' });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/v1/plugins/:pluginName/admin/users/:userId/roles/:roleName', () => {
    it('returns 403 for cross-plugin role revocation', async () => {
      delegationService.isPluginAdmin.mockResolvedValue(true);
      const res = await request(app)
        .delete('/api/v1/plugins/my-plugin/admin/users/u1/roles/other:editor')
        .set('x-user-id', 'admin-1');
      expect(res.status).toBe(403);
    });

    it('revokes scoped role', async () => {
      delegationService.isPluginAdmin.mockResolvedValue(true);
      const res = await request(app)
        .delete('/api/v1/plugins/my-plugin/admin/users/u1/roles/my-plugin:editor')
        .set('x-user-id', 'admin-1');
      expect(res.status).toBe(200);
    });
  });
});
