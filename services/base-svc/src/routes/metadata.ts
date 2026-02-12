/**
 * Metadata Routes
 *
 * API endpoints for plugin configuration, publish metrics, artifact health,
 * manifest validation, and version management.
 *
 * These are low-dependency, read-heavy endpoints used by the plugin
 * marketplace UI and CLI tooling.
 */

import { Router, Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

interface MetadataRouteDeps {
  /** Prisma client for direct DB queries (plugin config). */
  db: {
    pluginConfig: {
      findUnique: (args: any) => Promise<any>;
      upsert: (args: any) => Promise<any>;
    };
  };
  /** Extracts user ID from request (Bearer token or x-user-id header). */
  getUserIdFromRequest: (req: Request) => Promise<string | null>;
  /** Singleton service for publish analytics. */
  publishMetrics: {
    getSummary: (period: string) => Promise<unknown>;
    getPackageMetrics: (name: string, period: string) => Promise<unknown>;
  };
  /** Singleton service for artifact health monitoring. */
  artifactHealth: {
    getHealthSummary: () => Promise<unknown>;
    checkArtifact: (name: string, version: string) => Promise<unknown>;
    checkAllInstalled: () => Promise<Array<{ issues: unknown[] }>>;
  };
  /** Singleton service for plugin manifest validation. */
  manifestValidator: {
    validate: (manifest: unknown) => unknown;
  };
  /** Singleton service for semver-based version management. */
  versionManager: {
    validateVersion: (version: string) => { valid: boolean; error?: string };
    checkVersionConflict: (packageId: string, version: string) => Promise<unknown>;
    getVersionHistory: (packageId: string) => Promise<unknown[]>;
    getLatestVersion: (packageId: string, includePrerelease: boolean) => Promise<unknown>;
    checkForUpgrade: (packageId: string, currentVersion: string, includePrerelease: boolean) => Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createMetadataRoutes(deps: MetadataRouteDeps) {
  const { db, getUserIdFromRequest, publishMetrics, artifactHealth, manifestValidator, versionManager } = deps;
  const router = Router();

  // ==========================================================================
  // Personal Plugin Config
  // ==========================================================================

  /** GET /plugins/:pluginName/config - returns user's personal config for a plugin */
  router.get('/plugins/:pluginName/config', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { pluginName } = req.params;
      const configKey = `user_plugin_config:${userId}:${pluginName}`;
      const record = await db.pluginConfig.findUnique({ where: { key: configKey } });

      if (!record) {
        return res.json({});
      }

      try {
        res.json(JSON.parse(record.value));
      } catch {
        res.json({});
      }
    } catch (error) {
      console.error('Error fetching personal plugin config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /plugins/:pluginName/config - saves user's personal config for a plugin */
  router.put('/plugins/:pluginName/config', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { pluginName } = req.params;
      const configKey = `user_plugin_config:${userId}:${pluginName}`;
      const configValue = JSON.stringify(req.body || {});

      await db.pluginConfig.upsert({
        where: { key: configKey },
        update: { value: configValue },
        create: { key: configKey, value: configValue },
      });

      res.json(req.body || {});
    } catch (error) {
      console.error('Error saving personal plugin config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Publish Metrics
  // ==========================================================================

  /** GET /metrics/summary - aggregate publish metrics */
  router.get('/metrics/summary', async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as '24h' | '7d' | '30d') || '7d';
      const summary = await publishMetrics.getSummary(period);
      res.json(summary);
    } catch (error) {
      console.error('Error fetching metrics:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /metrics/packages/:name - per-package publish metrics */
  router.get('/metrics/packages/:name', async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as '24h' | '7d' | '30d') || '7d';
      const metrics = await publishMetrics.getPackageMetrics(req.params.name, period);
      res.json(metrics);
    } catch (error) {
      console.error('Error fetching package metrics:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Artifact Health
  // ==========================================================================

  /** GET /health/artifacts - health summary for all artifacts */
  router.get('/health/artifacts', async (_req: Request, res: Response) => {
    try {
      const summary = await artifactHealth.getHealthSummary();
      res.json(summary);
    } catch (error) {
      console.error('Error fetching health summary:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /health/artifacts/:name/:version - check specific artifact */
  router.get('/health/artifacts/:name/:version', async (req: Request, res: Response) => {
    try {
      const { name, version } = req.params;
      const result = await artifactHealth.checkArtifact(name, version);
      res.json(result);
    } catch (error) {
      console.error('Error checking artifact health:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /health/check-all - trigger health check for all installed plugins */
  router.post('/health/check-all', async (_req: Request, res: Response) => {
    try {
      const results = await artifactHealth.checkAllInstalled();
      res.json({
        checked: results.length,
        healthy: results.filter(r => r.issues.length === 0).length,
        unhealthy: results.filter(r => r.issues.length > 0).length,
        results,
      });
    } catch (error) {
      console.error('Error running health checks:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Manifest Validation
  // ==========================================================================

  /** POST /validate/manifest - validate a plugin manifest */
  router.post('/validate/manifest', async (req: Request, res: Response) => {
    try {
      const result = manifestValidator.validate(req.body);
      res.json(result);
    } catch (error) {
      console.error('Error validating manifest:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Version Management
  // ==========================================================================

  /** GET /versions/:packageId/check/:version - check for version conflicts */
  router.get('/versions/:packageId/check/:version', async (req: Request, res: Response) => {
    try {
      const { packageId, version } = req.params;

      const validation = versionManager.validateVersion(version);
      if (!validation.valid) {
        return res.status(400).json({ valid: false, error: validation.error });
      }

      const conflict = await versionManager.checkVersionConflict(packageId, version);
      res.json({
        valid: !conflict,
        conflict: conflict || null,
      });
    } catch (error) {
      console.error('Error checking version:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /versions/:packageId/history - get version history */
  router.get('/versions/:packageId/history', async (req: Request, res: Response) => {
    try {
      const history = await versionManager.getVersionHistory(req.params.packageId);
      res.json({ versions: history });
    } catch (error) {
      console.error('Error fetching version history:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /versions/:packageId/latest - get latest version */
  router.get('/versions/:packageId/latest', async (req: Request, res: Response) => {
    try {
      const includePrerelease = req.query.prerelease === 'true';
      const latest = await versionManager.getLatestVersion(req.params.packageId, includePrerelease);
      res.json({ latest });
    } catch (error) {
      console.error('Error fetching latest version:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /versions/:packageId/upgrade/:currentVersion - check for upgrade */
  router.get('/versions/:packageId/upgrade/:currentVersion', async (req: Request, res: Response) => {
    try {
      const { packageId, currentVersion } = req.params;
      const includePrerelease = req.query.prerelease === 'true';
      const upgrade = await versionManager.checkForUpgrade(packageId, currentVersion, includePrerelease);
      res.json(upgrade);
    } catch (error) {
      console.error('Error checking for upgrade:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
