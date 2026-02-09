/**
 * Base Routes
 *
 * API endpoints for CSP reporting, health check, legacy auth (wallet-based),
 * feature flags, job feeds, historical stats, plugin management, user
 * preferences, personalized plugins, and debug console access control.
 */

import { Router, Request, Response } from 'express';
import express from 'express';

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

interface BaseRouteDeps {
  db: any;
  requireToken: any;
  getCacheStats: () => { backend: string; redisConnected: boolean; memorySize: number };
}

// ---------------------------------------------------------------------------
// CSP violation types (module-level, shared by handlers)
// ---------------------------------------------------------------------------

interface CspViolationReport {
  'csp-report'?: {
    'document-uri'?: string;
    'referrer'?: string;
    'violated-directive'?: string;
    'effective-directive'?: string;
    'original-policy'?: string;
    'disposition'?: string;
    'blocked-uri'?: string;
    'line-number'?: number;
    'column-number'?: number;
    'source-file'?: string;
    'status-code'?: number;
    'script-sample'?: string;
  };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createBaseRoutes(deps: BaseRouteDeps) {
  const { db, requireToken, getCacheStats } = deps;
  const router = Router();

  // In-memory store for recent CSP violations (max 1000)
  const cspViolations: Array<{ timestamp: string; violation: CspViolationReport['csp-report']; userAgent: string }> = [];
  const MAX_CSP_VIOLATIONS = 1000;

  // ==========================================================================
  // CSP Report
  // ==========================================================================

  /** POST /csp-report - receive CSP violation reports from browser */
  router.post('/csp-report', express.json({ type: 'application/csp-report' }), (req: Request, res: Response) => {
    try {
      const report = req.body as CspViolationReport;
      const violation = report['csp-report'];
      if (violation) {
        console.warn('[CSP Violation]', {
          documentUri: violation['document-uri'], blockedUri: violation['blocked-uri'],
          violatedDirective: violation['violated-directive'], effectiveDirective: violation['effective-directive'],
          sourceFile: violation['source-file'], lineNumber: violation['line-number'], disposition: violation['disposition'],
        });
        cspViolations.unshift({ timestamp: new Date().toISOString(), violation, userAgent: req.headers['user-agent'] || 'unknown' });
        if (cspViolations.length > MAX_CSP_VIOLATIONS) cspViolations.length = MAX_CSP_VIOLATIONS;
      }
      res.status(204).send();
    } catch (error) {
      console.error('[CSP Report Error]', error);
      res.status(204).send();
    }
  });

  /** GET /csp-report - view recent CSP violations (admin only) */
  router.get('/csp-report', requireToken, (req: any, res: Response) => {
    if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required' });
    const limit = Math.min(parseInt(req.query.limit as string) || 100, MAX_CSP_VIOLATIONS);
    res.json({
      success: true,
      data: {
        total: cspViolations.length,
        violations: cspViolations.slice(0, limit),
        summary: {
          byDirective: cspViolations.reduce((acc, v) => {
            const d = v.violation?.['violated-directive'] || 'unknown'; acc[d] = (acc[d] || 0) + 1; return acc;
          }, {} as Record<string, number>),
          byBlockedUri: cspViolations.reduce((acc, v) => {
            const u = v.violation?.['blocked-uri'] || 'unknown'; acc[u] = (acc[u] || 0) + 1; return acc;
          }, {} as Record<string, number>),
        },
      },
    });
  });

  // ==========================================================================
  // Health Check
  // ==========================================================================

  /** GET /healthz (note: mounted at root, not /api/v1) */
  // Health check is mounted directly on the app in server.ts since it's /healthz

  // ==========================================================================
  // Legacy Auth (Wallet-based)
  // ==========================================================================

  /** GET /base/auth/session - validate session */
  router.get('/base/auth/session', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token provided' });

      const session = await db.session.findUnique({ where: { token }, include: { user: { include: { config: true } } } });
      if (!session || new Date(session.expiresAt) < new Date()) return res.status(401).json({ error: 'Invalid or expired session' });

      await db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
      res.json({
        user: { address: session.user.address, displayName: session.user.displayName, isConnected: true, config: session.user.config },
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (error) {
      console.error('Session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /base/auth/connect - wallet connect */
  router.post('/base/auth/connect', async (req: Request, res: Response) => {
    try {
      const { address } = req.body;
      if (!address) return res.status(400).json({ error: 'Address required' });

      const user = await db.user.upsert({
        where: { address },
        update: {},
        create: { address, displayName: `User ${address.slice(0, 8)}`, config: { create: { theme: 'dark' } } },
        include: { config: true },
      });

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const token = `jwt-${address.slice(0, 10)}-${Date.now()}`;
      await db.session.create({ data: { userId: user.id, token, expiresAt } });

      res.json({
        success: true, token,
        user: { address: user.address, displayName: user.displayName, isConnected: true, config: user.config },
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      console.error('Connect error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /base/auth/disconnect - wallet disconnect */
  router.post('/base/auth/disconnect', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) await db.session.deleteMany({ where: { token } });
      res.json({ success: true });
    } catch (error) {
      console.error('Disconnect error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Feature Flags
  // ==========================================================================

  /** GET /base/config/features - get feature flags */
  router.get('/base/config/features', async (_req: Request, res: Response) => {
    try {
      const flags = await db.featureFlag.findMany();
      const features = flags.reduce((acc: Record<string, boolean>, flag: any) => { acc[flag.key] = flag.enabled; return acc; }, {});
      res.json({ features, version: '0.0.1' });
    } catch (error) {
      console.error('Feature flags error:', error);
      res.json({ features: { enableMockData: true, enableCDNPlugins: true, enableAuth: false, enableNotifications: true }, version: '0.0.1' });
    }
  });

  // ==========================================================================
  // Job Feeds
  // ==========================================================================

  /** GET /base/job-feeds - list job feeds */
  router.get('/base/job-feeds', async (req: Request, res: Response) => {
    try {
      const { gatewayId, jobType, status, limit = '50', offset = '0' } = req.query;
      const where: any = {};
      if (gatewayId) where.gatewayId = gatewayId as string;
      if (jobType) where.jobType = jobType as string;
      if (status) where.status = status as string;

      const [feeds, total] = await Promise.all([
        db.jobFeed.findMany({ where, orderBy: { timestamp: 'desc' }, take: parseInt(limit as string), skip: parseInt(offset as string) }),
        db.jobFeed.count({ where }),
      ]);
      res.json({ feeds, total, limit: parseInt(limit as string), offset: parseInt(offset as string) });
    } catch (error) {
      console.error('Job feeds error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /base/job-feeds/stats - job feed statistics */
  router.get('/base/job-feeds/stats', async (_req: Request, res: Response) => {
    try {
      const [total, byStatus, byType] = await Promise.all([
        db.jobFeed.count(),
        db.jobFeed.groupBy({ by: ['status'], _count: true }),
        db.jobFeed.groupBy({ by: ['jobType'], _count: true }),
      ]);
      res.json({
        total,
        byStatus: byStatus.reduce((acc: Record<string, number>, item: any) => { acc[item.status] = item._count; return acc; }, {}),
        byType: byType.reduce((acc: Record<string, number>, item: any) => { acc[item.jobType] = item._count; return acc; }, {}),
      });
    } catch (error) {
      console.error('Job feeds stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Historical Stats
  // ==========================================================================

  /** GET /base/stats/historical - get historical stats */
  router.get('/base/stats/historical', async (req: Request, res: Response) => {
    try {
      const { service, metric, limit = '100' } = req.query;
      const where: any = {};
      if (service) where.service = service as string;
      if (metric) where.metric = metric as string;
      const stats = await db.historicalStat.findMany({ where, orderBy: { timestamp: 'desc' }, take: parseInt(limit as string) });
      res.json({ stats });
    } catch (error) {
      console.error('Historical stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Plugin Management (Workflow Plugins)
  // ==========================================================================

  /** GET /base/plugins - list workflow plugins */
  router.get('/base/plugins', async (req: Request, res: Response) => {
    try {
      const includeDisabled = req.query.includeDisabled === 'true';
      const plugins = await db.workflowPlugin.findMany({ where: includeDisabled ? {} : { enabled: true }, orderBy: { order: 'asc' } });
      res.json({ plugins });
    } catch (error) {
      console.error('Plugins list error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /base/plugins - create or update a workflow plugin */
  router.post('/base/plugins', async (req: Request, res: Response) => {
    try {
      const { name, displayName, version, remoteUrl, routes, enabled, order, icon, bundleUrl, stylesUrl, bundleHash, bundleSize, deploymentType, globalName } = req.body;
      const plugin = await db.workflowPlugin.upsert({
        where: { name },
        update: { displayName, version, remoteUrl, routes, enabled, order, icon, bundleUrl, stylesUrl, bundleHash, bundleSize, deploymentType: deploymentType || 'cdn', globalName },
        create: { name, displayName, version, remoteUrl, routes, enabled, order, icon, bundleUrl, stylesUrl, bundleHash, bundleSize, deploymentType: deploymentType || 'cdn', globalName },
      });
      res.json({ plugin });
    } catch (error) {
      console.error('Plugin save error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /base/plugins/:name - delete a workflow plugin */
  router.delete('/base/plugins/:name', async (req: Request, res: Response) => {
    try {
      await db.workflowPlugin.delete({ where: { name: req.params.name } });
      res.json({ success: true });
    } catch (error) {
      console.error('Plugin delete error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // User Preferences
  // ==========================================================================

  /** GET /base/user/preferences - get user plugin preferences */
  router.get('/base/user/preferences', async (req: Request, res: Response) => {
    try {
      const userIdOrAddress = req.query.userId as string;
      if (!userIdOrAddress) return res.status(400).json({ error: 'userId required' });

      let user = await db.user.findUnique({ where: { id: userIdOrAddress } });
      if (!user) user = await db.user.findUnique({ where: { address: userIdOrAddress } });
      if (!user) return res.json({ preferences: [] });

      const preferences = await db.userPluginPreference.findMany({ where: { userId: user.id } });
      res.json({ preferences });
    } catch (error) {
      console.error('User preferences error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /base/user/preferences - save user plugin preference */
  router.post('/base/user/preferences', async (req: Request, res: Response) => {
    try {
      const { userId, pluginName, enabled, order, pinned } = req.body;
      if (!userId || !pluginName) return res.status(400).json({ error: 'userId and pluginName required' });

      let user = await db.user.findUnique({ where: { id: userId } });
      if (!user) user = await db.user.findUnique({ where: { address: userId } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const preference = await db.userPluginPreference.upsert({
        where: { userId_pluginName: { userId: user.id, pluginName } },
        update: { enabled, order, pinned },
        create: { userId: user.id, pluginName, enabled, order, pinned },
      });
      res.json({ preference });
    } catch (error) {
      console.error('Save preference error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Debug Console Access Control
  // ==========================================================================

  /** GET /base/user/debug-settings - get current user's debug settings */
  router.get('/base/user/debug-settings', requireToken, async (req: any, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      let config = await db.userConfig.findUnique({ where: { userId } });
      if (!config) config = await db.userConfig.create({ data: { userId, theme: 'dark', debugEnabled: true } });

      res.json({ debugEnabled: config.debugEnabled, debugDisabledBy: config.debugDisabledBy, debugDisabledAt: config.debugDisabledAt });
    } catch (error) {
      console.error('Get debug settings error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /admin/users/:userId/debug - toggle debug access (admin) */
  router.put('/admin/users/:userId/debug', requireToken, async (req: any, res: Response) => {
    try {
      const adminId = req.user?.id;
      if (!adminId) return res.status(401).json({ error: 'Authentication required' });

      const adminRoles = await db.userRole.findMany({ where: { userId: adminId }, include: { role: true } });
      const isAdmin = adminRoles.some((ur: any) => ur.role.name === 'admin' || ur.role.name === 'super-admin' || ur.role.name.endsWith(':admin'));
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

      const { userId } = req.params;
      const { debugEnabled } = req.body;
      if (typeof debugEnabled !== 'boolean') return res.status(400).json({ error: 'debugEnabled must be a boolean' });

      const config = await db.userConfig.upsert({
        where: { userId },
        update: { debugEnabled, debugDisabledBy: debugEnabled ? null : adminId, debugDisabledAt: debugEnabled ? null : new Date() },
        create: { userId, theme: 'dark', debugEnabled, debugDisabledBy: debugEnabled ? null : adminId, debugDisabledAt: debugEnabled ? null : new Date() },
      });

      res.json({ userId, debugEnabled: config.debugEnabled, debugDisabledBy: config.debugDisabledBy, debugDisabledAt: config.debugDisabledAt, message: debugEnabled ? 'Debug access enabled for user' : 'Debug access disabled for user' });
    } catch (error) {
      console.error('Toggle debug access error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /admin/users/debug-access - get all users' debug access (admin) */
  router.get('/admin/users/debug-access', requireToken, async (req: any, res: Response) => {
    try {
      const adminId = req.user?.id;
      if (!adminId) return res.status(401).json({ error: 'Authentication required' });

      const adminRoles = await db.userRole.findMany({ where: { userId: adminId }, include: { role: true } });
      const isAdmin = adminRoles.some((ur: any) => ur.role.name === 'admin' || ur.role.name === 'super-admin' || ur.role.name.endsWith(':admin'));
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

      const users = await db.user.findMany({
        select: { id: true, email: true, displayName: true, config: { select: { debugEnabled: true, debugDisabledBy: true, debugDisabledAt: true } } },
        orderBy: { createdAt: 'desc' }, take: 100,
      });

      res.json({ users: users.map((u: any) => ({ id: u.id, email: u.email, displayName: u.displayName, debugEnabled: u.config?.debugEnabled ?? true, debugDisabledBy: u.config?.debugDisabledBy, debugDisabledAt: u.config?.debugDisabledAt })) });
    } catch (error) {
      console.error('Get users debug access error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Personalized Plugins
  // ==========================================================================

  /** GET /base/plugins/personalized - get personalized plugin list */
  router.get('/base/plugins/personalized', async (req: Request, res: Response) => {
    try {
      const userIdOrAddress = req.query.userId as string;
      const globalPlugins = await db.workflowPlugin.findMany({ where: { enabled: true }, orderBy: { order: 'asc' } });
      if (!userIdOrAddress) return res.json({ plugins: globalPlugins });

      let user = await db.user.findUnique({ where: { id: userIdOrAddress } });
      if (!user) user = await db.user.findUnique({ where: { address: userIdOrAddress } });
      if (!user) return res.json({ plugins: globalPlugins });

      const userPreferences = await db.userPluginPreference.findMany({ where: { userId: user.id } });
      const preferencesMap = new Map<string, any>(userPreferences.map((p: any) => [p.pluginName, p]));

      const personalizedPlugins = globalPlugins
        .map((plugin: any) => {
          const userPref = preferencesMap.get(plugin.name);
          return { ...plugin, enabled: userPref ? userPref.enabled : plugin.enabled, order: userPref?.order ?? plugin.order, pinned: userPref?.pinned ?? false };
        })
        .filter((p: any) => p.enabled)
        .sort((a: any, b: any) => { if (a.pinned && !b.pinned) return -1; if (!a.pinned && b.pinned) return 1; return a.order - b.order; });

      res.json({ plugins: personalizedPlugins });
    } catch (error) {
      console.error('Personalized plugins error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
