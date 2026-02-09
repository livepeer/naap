/**
 * RBAC Routes
 *
 * API endpoints for role-based access control, platform administration,
 * and plugin-scoped administration. Handles roles, permissions,
 * user-role assignments, and delegation checks.
 */

import { Router, Request, Response } from 'express';
import type { AuditLogInput } from '../services/lifecycle';

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

interface RbacRouteDeps {
  rbacService: {
    getRoles: () => Promise<Array<{ permissions: unknown } & Record<string, unknown>>>;
    upsertRole: (input: any) => Promise<unknown>;
    deleteRole: (name: string) => Promise<unknown>;
    assignRoleWithAudit: (userId: string, roleName: string, assignerId: string, meta: any) => Promise<unknown>;
    revokeRoleWithAudit: (userId: string, roleName: string, revokerId: string, meta: any) => Promise<unknown>;
    getUserWithRoles: (userId: string) => Promise<unknown>;
    hasPermission: (userId: string, resource: string, action: string, scope?: string) => Promise<boolean>;
    getUserPermissions: (userId: string) => Promise<unknown>;
    getEffectivePermissions: (userId: string) => Promise<unknown>;
    getAllUsersWithRoles: () => Promise<unknown>;
  };
  delegationService: {
    isSystemAdmin: (userId: string) => Promise<boolean>;
    isPluginAdmin: (userId: string, pluginName: string) => Promise<boolean>;
    getAssignableRoles: (userId: string) => Promise<unknown>;
    getPluginUsers: (pluginName: string) => Promise<unknown>;
    getPluginRoles: (pluginName: string) => Promise<Array<{ permissions: unknown } & Record<string, unknown>>>;
  };
  lifecycleService: {
    audit: (input: AuditLogInput) => Promise<unknown>;
    getAuditLogs: (filter: any) => Promise<unknown>;
  };
  getUserIdFromRequest: (req: Request) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createRbacRoutes(deps: RbacRouteDeps) {
  const { rbacService, delegationService, lifecycleService, getUserIdFromRequest } = deps;
  const router = Router();

  // ==========================================================================
  // RBAC (Role-Based Access Control)
  // ==========================================================================

  /** GET /roles - list all roles */
  router.get('/roles', async (_req: Request, res: Response) => {
    try {
      const roles = await rbacService.getRoles();
      res.json({
        roles: roles.map(r => ({
          ...r,
          permissions: r.permissions as unknown[],
        })),
      });
    } catch (error) {
      console.error('Error fetching roles:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /roles - create or update a role */
  router.post('/roles', async (req: Request, res: Response) => {
    try {
      const { name, displayName, description, permissions } = req.body;
      const userId = req.headers['x-user-id'] as string;

      if (!name || !displayName || !permissions) {
        return res.status(400).json({ error: 'name, displayName, and permissions are required' });
      }

      const role = await rbacService.upsertRole({ name, displayName, description, permissions });

      await lifecycleService.audit({
        action: 'role.upsert',
        resource: 'role',
        resourceId: name,
        userId,
        details: { permissions },
      });

      res.json(role);
    } catch (error) {
      console.error('Error upserting role:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /roles/:name - delete a role */
  router.delete('/roles/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const userId = req.headers['x-user-id'] as string;

      await rbacService.deleteRole(name);

      await lifecycleService.audit({
        action: 'role.delete',
        resource: 'role',
        resourceId: name,
        userId,
      });

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      console.error('Error deleting role:', error);
      res.status(400).json({ error: message });
    }
  });

  /** POST /users/:userId/roles - assign role to user (with delegation check) */
  router.post('/users/:userId/roles', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { roleName } = req.body;
      const assignerId = await getUserIdFromRequest(req);

      if (!roleName) {
        return res.status(400).json({ error: 'roleName is required' });
      }
      if (!assignerId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      await rbacService.assignRoleWithAudit(userId, roleName, assignerId, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      console.error('Error assigning role:', error);
      res.status(403).json({ error: message });
    }
  });

  /** DELETE /users/:userId/roles/:roleName - remove role from user */
  router.delete('/users/:userId/roles/:roleName', async (req: Request, res: Response) => {
    try {
      const { userId, roleName } = req.params;
      const revokerId = await getUserIdFromRequest(req);

      if (!revokerId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      await rbacService.revokeRoleWithAudit(userId, roleName, revokerId, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      console.error('Error removing role:', error);
      res.status(403).json({ error: message });
    }
  });

  /** GET /users/:userId/roles - get user with their roles */
  router.get('/users/:userId/roles', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const user = await rbacService.getUserWithRoles(userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(user);
    } catch (error) {
      console.error('Error fetching user roles:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /users/:userId/permissions/check - check a specific permission */
  router.get('/users/:userId/permissions/check', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { resource, action, scope } = req.query;

      if (!resource || !action) {
        return res.status(400).json({ error: 'resource and action are required' });
      }

      const allowed = await rbacService.hasPermission(
        userId,
        resource as string,
        action as string,
        scope as string | undefined,
      );

      res.json({ allowed });
    } catch (error) {
      console.error('Error checking permission:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /users/:userId/permissions - get user's permissions */
  router.get('/users/:userId/permissions', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const permissions = await rbacService.getUserPermissions(userId);
      res.json(permissions);
    } catch (error) {
      console.error('Error fetching permissions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /users/:userId/permissions/effective - get effective permissions with inheritance */
  router.get('/users/:userId/permissions/effective', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const permissions = await rbacService.getEffectivePermissions(userId);
      res.json(permissions);
    } catch (error) {
      console.error('Error fetching effective permissions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Admin API (Platform Administration)
  // ==========================================================================

  /** GET /admin/users - get all users with roles (admin only) */
  router.get('/admin/users', async (req: Request, res: Response) => {
    try {
      const requesterId = await getUserIdFromRequest(req);
      if (!requesterId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const isAdmin = await delegationService.isSystemAdmin(requesterId);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const users = await rbacService.getAllUsersWithRoles();
      res.json({ users });
    } catch (error) {
      console.error('Error fetching admin users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /admin/roles/assignable - get roles current user can assign */
  router.get('/admin/roles/assignable', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const assignableRoles = await delegationService.getAssignableRoles(userId);
      res.json({ roles: assignableRoles });
    } catch (error) {
      console.error('Error fetching assignable roles:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /admin/audit - get role assignment audit log (admin only) */
  router.get('/admin/audit', async (req: Request, res: Response) => {
    try {
      const requesterId = await getUserIdFromRequest(req);
      if (!requesterId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const isAdmin = await delegationService.isSystemAdmin(requesterId);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await lifecycleService.getAuditLogs({
        action: req.query.action as string,
        resource: 'role',
        limit,
      });
      res.json({ logs });
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Plugin Admin API (Scoped Administration)
  // ==========================================================================

  /** GET /plugins/:pluginName/admin/users - get users for a plugin */
  router.get('/plugins/:pluginName/admin/users', async (req: Request, res: Response) => {
    try {
      const { pluginName } = req.params;
      const requesterId = req.headers['x-user-id'] as string;

      if (!requesterId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const isPluginAdmin = await delegationService.isPluginAdmin(requesterId, pluginName);
      const isSystemAdmin = await delegationService.isSystemAdmin(requesterId);

      if (!isPluginAdmin && !isSystemAdmin) {
        return res.status(403).json({ error: 'Plugin admin access required' });
      }

      const users = await delegationService.getPluginUsers(pluginName);
      res.json(users);
    } catch (error) {
      console.error('Error fetching plugin users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /plugins/:pluginName/admin/roles - get roles for a plugin */
  router.get('/plugins/:pluginName/admin/roles', async (req: Request, res: Response) => {
    try {
      const { pluginName } = req.params;
      const requesterId = req.headers['x-user-id'] as string;

      if (!requesterId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const isPluginAdmin = await delegationService.isPluginAdmin(requesterId, pluginName);
      const isSystemAdmin = await delegationService.isSystemAdmin(requesterId);

      if (!isPluginAdmin && !isSystemAdmin) {
        return res.status(403).json({ error: 'Plugin admin access required' });
      }

      const roles = await delegationService.getPluginRoles(pluginName);
      res.json(roles.map(r => ({
        ...r,
        permissions: r.permissions as unknown[],
      })));
    } catch (error) {
      console.error('Error fetching plugin roles:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /plugins/:pluginName/admin/users/:userId/roles - assign plugin role */
  router.post('/plugins/:pluginName/admin/users/:userId/roles', async (req: Request, res: Response) => {
    try {
      const { pluginName, userId } = req.params;
      const { roleName } = req.body;
      const assignerId = req.headers['x-user-id'] as string;

      if (!roleName) {
        return res.status(400).json({ error: 'roleName is required' });
      }
      if (!assignerId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Ensure role belongs to this plugin
      if (!roleName.startsWith(`${pluginName}:`)) {
        return res.status(403).json({ error: 'Cannot assign roles outside your plugin scope' });
      }

      const isPluginAdmin = await delegationService.isPluginAdmin(assignerId, pluginName);
      const isSystemAdmin = await delegationService.isSystemAdmin(assignerId);

      if (!isPluginAdmin && !isSystemAdmin) {
        return res.status(403).json({ error: 'Plugin admin access required' });
      }

      await rbacService.assignRoleWithAudit(userId, roleName, assignerId, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      console.error('Error assigning plugin role:', error);
      res.status(403).json({ error: message });
    }
  });

  /** DELETE /plugins/:pluginName/admin/users/:userId/roles/:roleName - revoke plugin role */
  router.delete('/plugins/:pluginName/admin/users/:userId/roles/:roleName', async (req: Request, res: Response) => {
    try {
      const { pluginName, userId, roleName } = req.params;
      const revokerId = req.headers['x-user-id'] as string;

      if (!revokerId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Ensure role belongs to this plugin
      if (!roleName.startsWith(`${pluginName}:`)) {
        return res.status(403).json({ error: 'Cannot revoke roles outside your plugin scope' });
      }

      const isPluginAdmin = await delegationService.isPluginAdmin(revokerId, pluginName);
      const isSystemAdmin = await delegationService.isSystemAdmin(revokerId);

      if (!isPluginAdmin && !isSystemAdmin) {
        return res.status(403).json({ error: 'Plugin admin access required' });
      }

      await rbacService.revokeRoleWithAudit(userId, roleName, revokerId, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      console.error('Error revoking plugin role:', error);
      res.status(403).json({ error: message });
    }
  });

  return router;
}
