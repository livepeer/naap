/**
 * Tenant Routes
 *
 * API endpoints for multi-tenant plugin management (virtual installations,
 * preferences, config) and deployment management (admin listing, stats,
 * per-deployment user queries, and plugin proxy with tenant context).
 */

import { Router, Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

interface TenantRouteDeps {
  db: any;
  tenantService: {
    listUserInstallations: (userId: string) => Promise<unknown>;
    getInstallation: (userId: string, installId: string) => Promise<unknown>;
    getInstallationByPlugin: (userId: string, pluginName: string) => Promise<unknown>;
    createInstallation: (userId: string, deploymentId: string, config?: any) => Promise<{ install: unknown; isFirstInstall: boolean }>;
    uninstall: (userId: string, installId: string) => Promise<{ success: boolean; shouldCleanup: boolean; deploymentId: string }>;
    updatePreferences: (userId: string, installId: string, prefs: any) => Promise<unknown>;
    getConfig: (userId: string, installId: string) => Promise<unknown>;
    updateConfig: (userId: string, installId: string, data: any) => Promise<unknown>;
    getUsersWithPlugin: (deploymentId: string) => Promise<string[]>;
  };
  deploymentService: {
    getOrCreateDeployment: (packageId: string, versionId?: string) => Promise<{ deployment: any; isNew: boolean }>;
    startDeployment: (deploymentId: string) => Promise<unknown>;
    completeDeployment: (deploymentId: string, urls: any) => Promise<unknown>;
    cleanupDeployment: (deploymentId: string) => Promise<unknown>;
    listDeployments: () => Promise<unknown>;
    getDeploymentByName: (name: string) => Promise<unknown>;
    getStats: () => Promise<unknown>;
  };
  rbacService: {
    hasRole: (userId: string, role: string) => Promise<boolean>;
  };
  lifecycleService: {
    recordEvent: (input: any) => Promise<unknown>;
  };
  getUserIdFromRequest: (req: Request) => Promise<string | null>;
  csrfProtection: any;
  tenantMiddleware: any;
  forwardTenantHeaders: any;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createTenantRoutes(deps: TenantRouteDeps) {
  const {
    db, tenantService, deploymentService, rbacService, lifecycleService,
    getUserIdFromRequest, csrfProtection, tenantMiddleware, forwardTenantHeaders,
  } = deps;
  const router = Router();

  // ==========================================================================
  // Multi-Tenant Plugin Installations
  // ==========================================================================

  /** GET /tenant/installations - list user's virtual installations */
  router.get('/tenant/installations', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const installations = await tenantService.listUserInstallations(userId);
      res.json({ installations });
    } catch (error) {
      console.error('Error listing tenant installations:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /tenant/installations/:installId - get single installation */
  router.get('/tenant/installations/:installId', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const installation = await tenantService.getInstallation(userId, req.params.installId);
      if (!installation) return res.status(404).json({ error: 'Installation not found' });
      res.json({ installation });
    } catch (error) {
      console.error('Error getting tenant installation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /tenant/installations/plugin/:pluginName - get installation by plugin name */
  router.get('/tenant/installations/plugin/:pluginName', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const installation = await tenantService.getInstallationByPlugin(userId, req.params.pluginName);
      if (!installation) return res.status(404).json({ error: 'Plugin not installed for this user' });
      res.json({ installation });
    } catch (error) {
      console.error('Error getting tenant installation by plugin:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /tenant/installations - create virtual installation */
  router.post('/tenant/installations', csrfProtection, async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { packageName, versionId, config } = req.body;
      if (!packageName) return res.status(400).json({ error: 'packageName is required' });

      const pkg = await db.pluginPackage.findUnique({ where: { name: packageName } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      const { deployment, isNew } = await deploymentService.getOrCreateDeployment(pkg.id, versionId);
      if (isNew) {
        await deploymentService.startDeployment(deployment.id);
        await deploymentService.completeDeployment(deployment.id, { frontendUrl: deployment.version.frontendUrl || undefined, backendUrl: undefined });
      }

      const { install, isFirstInstall } = await tenantService.createInstallation(userId, deployment.id, config);

      await lifecycleService.recordEvent({
        pluginName: pkg.name, version: deployment.version.version, action: 'tenant_install',
        toStatus: 'active', initiatedBy: userId, details: { isFirstInstall, deploymentId: deployment.id },
      });

      res.status(201).json({ installation: install, isFirstInstall });
    } catch (error) {
      console.error('Error creating tenant installation:', error);
      if ((error as Error).message === 'Plugin is already installed for this user') {
        return res.status(409).json({ error: (error as Error).message });
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /tenant/installations/:installId - uninstall plugin for user */
  router.delete('/tenant/installations/:installId', csrfProtection, async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { success, shouldCleanup, deploymentId } = await tenantService.uninstall(userId, req.params.installId);
      if (shouldCleanup) await deploymentService.cleanupDeployment(deploymentId);

      const deployment = await db.pluginDeployment.findUnique({ where: { id: deploymentId }, include: { package: true, version: true } });
      if (deployment) {
        await lifecycleService.recordEvent({
          pluginName: deployment.package.name, version: deployment.version.version, action: 'tenant_uninstall',
          fromStatus: 'active', toStatus: 'uninstalled', initiatedBy: userId, details: { shouldCleanup, deploymentId },
        });
      }

      res.json({ success, shouldCleanup });
    } catch (error) {
      console.error('Error uninstalling tenant plugin:', error);
      if ((error as Error).message === 'Installation not found') return res.status(404).json({ error: (error as Error).message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /tenant/installations/:installId/preferences - update preferences */
  router.patch('/tenant/installations/:installId/preferences', csrfProtection, async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { enabled, order, pinned } = req.body;
      const installation = await tenantService.updatePreferences(userId, req.params.installId, { enabled, order, pinned });
      res.json({ installation });
    } catch (error) {
      console.error('Error updating tenant preferences:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /tenant/installations/:installId/config - get tenant config */
  router.get('/tenant/installations/:installId/config', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const config = await tenantService.getConfig(userId, req.params.installId);
      res.json({ config: config || { settings: {} } });
    } catch (error) {
      console.error('Error getting tenant config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /tenant/installations/:installId/config - update tenant config */
  router.put('/tenant/installations/:installId/config', csrfProtection, async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { settings, secrets } = req.body;
      const config = await tenantService.updateConfig(userId, req.params.installId, { settings, secrets });
      res.json({ config });
    } catch (error) {
      console.error('Error updating tenant config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Deployment Management (Admin only)
  // ==========================================================================

  /** GET /deployments - list all deployments */
  router.get('/deployments', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const isAdmin = await rbacService.hasRole(userId, 'system:admin');
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const deployments = await deploymentService.listDeployments();
      res.json({ deployments });
    } catch (error) {
      console.error('Error listing deployments:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /deployments/package/:packageName - get deployment by package */
  router.get('/deployments/package/:packageName', async (req: Request, res: Response) => {
    try {
      const deployment = await deploymentService.getDeploymentByName(req.params.packageName);
      if (!deployment) return res.status(404).json({ error: 'Deployment not found' });
      res.json({ deployment });
    } catch (error) {
      console.error('Error getting deployment:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /deployments/stats - get deployment statistics */
  router.get('/deployments/stats', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const isAdmin = await rbacService.hasRole(userId, 'system:admin');
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const stats = await deploymentService.getStats();
      res.json(stats);
    } catch (error) {
      console.error('Error getting deployment stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /deployments/:deploymentId/users - get users with a specific plugin */
  router.get('/deployments/:deploymentId/users', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const isAdmin = await rbacService.hasRole(userId, 'system:admin');
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const userIds = await tenantService.getUsersWithPlugin(req.params.deploymentId);
      res.json({ userIds, count: userIds.length });
    } catch (error) {
      console.error('Error getting deployment users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Plugin proxy route with tenant context
  router.use('/plugins/:pluginName/*', tenantMiddleware, forwardTenantHeaders);

  return router;
}
