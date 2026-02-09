/**
 * Lifecycle Routes
 *
 * API endpoints for plugin installation/uninstallation, integration
 * configuration and proxy calls, lifecycle events (install/uninstall/
 * upgrade/enable/disable), and audit log retrieval.
 */

import { Router, Request, Response } from 'express';
import type { AuditLogInput } from '../services/lifecycle';

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

interface LifecycleRouteDeps {
  db: any; // PrismaClient - uses many models, kept loose intentionally
  lifecycleService: {
    audit: (input: AuditLogInput) => Promise<unknown>;
    getPluginEvents: (pluginName: string, limit: number) => Promise<unknown>;
    getRecentEvents: (limit: number) => Promise<unknown>;
    installPlugin: (packageId: string, versionId: string, userId?: string) => Promise<unknown>;
    uninstallPlugin: (packageId: string, userId?: string) => Promise<unknown>;
    upgradePlugin: (packageId: string, newVersionId: string, userId?: string) => Promise<unknown>;
    enablePlugin: (pluginName: string, userId?: string) => Promise<unknown>;
    disablePlugin: (pluginName: string, userId?: string) => Promise<unknown>;
    getAuditLogs: (filter: any) => Promise<unknown>;
  };
  secretVaultService: {
    getIntegrationSecret: (pluginName: string, type: string) => Promise<string | null>;
    getGlobalIntegrationSecret: (type: string) => Promise<string | null>;
  };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createLifecycleRoutes(deps: LifecycleRouteDeps) {
  const { db, lifecycleService, secretVaultService } = deps;
  const router = Router();

  // ==========================================================================
  // Plugin Installation
  // ==========================================================================

  /** GET /installations - list installed plugins */
  router.get('/installations', async (_req: Request, res: Response) => {
    try {
      const installations = await db.pluginInstallation.findMany({
        include: { package: true, version: true },
      });

      const workflowPlugins = await db.workflowPlugin.findMany({
        where: { enabled: true },
      });

      const installationMap = new Map(
        installations.map((inst: any) => [inst.package.name, inst])
      );

      for (const wp of workflowPlugins) {
        if (!installationMap.has(wp.name)) {
          let pkg = await db.pluginPackage.findUnique({ where: { name: wp.name } });
          if (!pkg) {
            pkg = await db.pluginPackage.create({
              data: {
                name: wp.name,
                displayName: wp.displayName,
                description: `${wp.displayName} plugin`,
                category: 'other',
              },
            });
            await db.pluginVersion.create({
              data: {
                packageId: pkg.id,
                version: wp.version,
                manifest: {
                  name: wp.name,
                  displayName: wp.displayName,
                  version: wp.version,
                  routes: wp.routes,
                },
                frontendUrl: wp.remoteUrl,
              },
            });
          }

          const version = await db.pluginVersion.findFirst({
            where: { packageId: pkg.id },
            orderBy: { publishedAt: 'desc' },
          });

          if (version) {
            const installation = await db.pluginInstallation.upsert({
              where: { packageId: pkg.id },
              create: {
                packageId: pkg.id,
                versionId: version.id,
                status: 'installed',
                installedAt: new Date(),
              },
              update: {},
              include: { package: true, version: true },
            });
            installations.push(installation);
          }
        }
      }

      res.json({ installations });
    } catch (error) {
      console.error('Installations list error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /installations/:packageName - get installation status */
  router.get('/installations/:packageName', async (req: Request, res: Response) => {
    try {
      const pkg = await db.pluginPackage.findUnique({
        where: { name: req.params.packageName },
      });

      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      const installation = await db.pluginInstallation.findUnique({
        where: { packageId: pkg.id },
        include: { package: true, version: true },
      });

      if (!installation) {
        return res.json({ installed: false });
      }

      res.json({ installed: true, installation });
    } catch (error) {
      console.error('Installation status error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /installations - install a plugin */
  router.post('/installations', async (req: Request, res: Response) => {
    try {
      const { packageName, version: requestedVersion } = req.body;

      if (!packageName) {
        return res.status(400).json({ error: 'packageName required' });
      }

      const pkg = await db.pluginPackage.findUnique({
        where: { name: packageName },
        include: { versions: { orderBy: { publishedAt: 'desc' }, take: 1 } },
      });

      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      let version;
      if (requestedVersion) {
        version = await db.pluginVersion.findFirst({
          where: { packageId: pkg.id, version: requestedVersion },
        });
      } else {
        version = pkg.versions[0];
      }

      if (!version) {
        return res.status(404).json({ error: 'Version not found' });
      }

      const installation = await db.pluginInstallation.upsert({
        where: { packageId: pkg.id },
        update: { versionId: version.id, status: 'pending' },
        create: { packageId: pkg.id, versionId: version.id, status: 'pending' },
      });

      await db.pluginPackage.update({
        where: { id: pkg.id },
        data: { downloads: { increment: 1 } },
      });
      await db.pluginVersion.update({
        where: { id: version.id },
        data: { downloads: { increment: 1 } },
      });

      const updatedInstallation = await db.pluginInstallation.update({
        where: { id: installation.id },
        data: { status: 'installed', installedAt: new Date() },
        include: { package: true, version: true },
      });

      const manifest = version.manifest as any;
      const routes = manifest?.routes || manifest?.frontend?.routes || [];
      const remoteUrl = version.frontendUrl || manifest?.frontend?.entry || manifest?.remoteUrl || '';

      const bundleUrl = version.bundleUrl || manifest?.bundleUrl;
      const stylesUrl = version.stylesUrl || manifest?.stylesUrl;
      const bundleHash = version.bundleHash || manifest?.bundleHash;
      const bundleSize = version.bundleSize || manifest?.bundleSize;
      const deploymentType = version.deploymentType || manifest?.deploymentType || 'cdn';
      const globalName = manifest?.globalName ||
        `NaapPlugin${pkg.name.charAt(0).toUpperCase() + pkg.name.slice(1).replace(/[-_](.)/g, (_: string, c: string) => c.toUpperCase())}`;

      await db.workflowPlugin.upsert({
        where: { name: pkg.name },
        update: {
          displayName: pkg.displayName, version: version.version, remoteUrl, routes,
          enabled: true, icon: pkg.icon || manifest?.icon,
          bundleUrl, stylesUrl, bundleHash, bundleSize, deploymentType, globalName,
        },
        create: {
          name: pkg.name, displayName: pkg.displayName, version: version.version,
          remoteUrl, routes, enabled: true, icon: pkg.icon || manifest?.icon,
          bundleUrl, stylesUrl, bundleHash, bundleSize, deploymentType, globalName,
        },
      });

      res.status(201).json({ installation: updatedInstallation });
    } catch (error) {
      console.error('Install error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /installations/:packageName - uninstall a plugin */
  router.delete('/installations/:packageName', async (req: Request, res: Response) => {
    try {
      const { packageName } = req.params;
      const userId = req.headers['x-user-id'] as string || 'system';

      const pkg = await db.pluginPackage.findUnique({ where: { name: packageName } });
      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      const installation = await db.pluginInstallation.findUnique({
        where: { packageId: pkg.id },
      });

      if (installation) {
        const result = await lifecycleService.uninstallPlugin(pkg.id, userId);
        return res.json(result);
      }

      const workflowPlugin = await db.workflowPlugin.findUnique({ where: { name: packageName } });
      if (workflowPlugin) {
        await db.workflowPlugin.delete({ where: { name: packageName } });
        await lifecycleService.audit({
          action: 'plugin.uninstall',
          resource: 'plugin',
          resourceId: packageName,
          userId,
          details: { source: 'workflowPlugin' },
        });
        return res.json({ success: true, message: 'Plugin removed' });
      }

      return res.status(404).json({ error: 'Plugin is not installed' });
    } catch (error) {
      console.error('Uninstall error:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  });

  // ==========================================================================
  // Integration Configuration
  // ==========================================================================

  /** GET /integrations - list available integrations */
  router.get('/integrations', async (_req: Request, res: Response) => {
    try {
      const integrations = await db.integrationConfig.findMany();

      const builtIn = [
        { type: 'openai', displayName: 'OpenAI', configured: false },
        { type: 'aws-s3', displayName: 'AWS S3', configured: false },
        { type: 'sendgrid', displayName: 'SendGrid', configured: false },
        { type: 'stripe', displayName: 'Stripe', configured: false },
        { type: 'twilio', displayName: 'Twilio', configured: false },
      ];

      const existing = new Set(integrations.map((i: any) => i.type));
      const all = [
        ...integrations.map((i: any) => ({
          type: i.type,
          displayName: i.displayName,
          configured: i.configured,
        })),
        ...builtIn.filter(b => !existing.has(b.type)),
      ];

      res.json({ integrations: all });
    } catch (error) {
      console.error('Integrations list error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /integrations/:type/status - get integration status */
  router.get('/integrations/:type/status', async (req: Request, res: Response) => {
    try {
      const config = await db.integrationConfig.findUnique({
        where: { type: req.params.type },
      });
      res.json({ available: true, configured: config?.configured || false });
    } catch (error) {
      console.error('Integration status error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /integrations/:type/configure - configure an integration */
  router.post('/integrations/:type/configure', async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      const { credentials, options } = req.body;

      const config = await db.integrationConfig.upsert({
        where: { type },
        update: { credentials, options, configured: true },
        create: {
          type,
          displayName: type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' '),
          credentials, options, configured: true,
        },
      });

      res.json({
        success: true,
        integration: { type: config.type, displayName: config.displayName, configured: config.configured },
      });
    } catch (error) {
      console.error('Integration configure error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /integrations/:type/call - proxy call to an integration */
  router.post('/integrations/:type/call', async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      const { method, args } = req.body;
      const pluginName = req.headers['x-plugin-name'] as string;

      if (pluginName) {
        const permission = await db.pluginIntegrationPermission.findUnique({
          where: { pluginName_integrationType: { pluginName, integrationType: type } },
        });
        if (!permission?.granted) {
          return res.status(403).json({ error: 'Integration not permitted for this plugin' });
        }
      }

      const config = await db.integrationConfig.findUnique({ where: { type } });
      if (!config?.configured) {
        return res.status(400).json({ error: 'Integration not configured' });
      }

      let apiKey: string | null = null;
      if (pluginName) {
        apiKey = await secretVaultService.getIntegrationSecret(pluginName, type);
      }
      if (!apiKey) {
        apiKey = await secretVaultService.getGlobalIntegrationSecret(type);
      }
      if (!apiKey) {
        return res.status(400).json({ error: 'Integration credentials not configured' });
      }

      try {
        const result = await executeIntegrationCall(type, method, args, apiKey);
        res.json(result);
      } catch (integrationError) {
        const message = integrationError instanceof Error ? integrationError.message : 'Integration call failed';
        res.status(500).json({ error: message });
      }
    } catch (error) {
      console.error('Integration call error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Plugin Lifecycle Events
  // ==========================================================================

  /** GET /lifecycle/plugins/:pluginName/events - get lifecycle events for a plugin */
  router.get('/lifecycle/plugins/:pluginName/events', async (req: Request, res: Response) => {
    try {
      const { pluginName } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const events = await lifecycleService.getPluginEvents(pluginName, limit);
      res.json(events);
    } catch (error) {
      console.error('Error fetching lifecycle events:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /lifecycle/events - get all recent lifecycle events */
  router.get('/lifecycle/events', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const events = await lifecycleService.getRecentEvents(limit);
      res.json(events);
    } catch (error) {
      console.error('Error fetching lifecycle events:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /lifecycle/install - install a plugin via lifecycle service */
  router.post('/lifecycle/install', async (req: Request, res: Response) => {
    try {
      const { packageId, versionId, userId } = req.body;
      if (!packageId || !versionId) {
        return res.status(400).json({ error: 'packageId and versionId are required' });
      }
      const result = await lifecycleService.installPlugin(packageId, versionId, userId);
      res.json(result);
    } catch (error) {
      console.error('Error installing plugin:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  });

  /** POST /lifecycle/uninstall - uninstall a plugin via lifecycle service */
  router.post('/lifecycle/uninstall', async (req: Request, res: Response) => {
    try {
      const { packageId, userId } = req.body;
      if (!packageId) {
        return res.status(400).json({ error: 'packageId is required' });
      }
      const result = await lifecycleService.uninstallPlugin(packageId, userId);
      res.json(result);
    } catch (error) {
      console.error('Error uninstalling plugin:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  });

  /** POST /lifecycle/upgrade - upgrade a plugin */
  router.post('/lifecycle/upgrade', async (req: Request, res: Response) => {
    try {
      const { packageId, newVersionId, userId } = req.body;
      if (!packageId || !newVersionId) {
        return res.status(400).json({ error: 'packageId and newVersionId are required' });
      }
      const result = await lifecycleService.upgradePlugin(packageId, newVersionId, userId);
      res.json(result);
    } catch (error) {
      console.error('Error upgrading plugin:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  });

  /** POST /lifecycle/enable - enable a plugin */
  router.post('/lifecycle/enable', async (req: Request, res: Response) => {
    try {
      const { pluginName, userId } = req.body;
      if (!pluginName) {
        return res.status(400).json({ error: 'pluginName is required' });
      }
      const result = await lifecycleService.enablePlugin(pluginName, userId);
      res.json(result);
    } catch (error) {
      console.error('Error enabling plugin:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  });

  /** POST /lifecycle/disable - disable a plugin */
  router.post('/lifecycle/disable', async (req: Request, res: Response) => {
    try {
      const { pluginName, userId } = req.body;
      if (!pluginName) {
        return res.status(400).json({ error: 'pluginName is required' });
      }
      const result = await lifecycleService.disablePlugin(pluginName, userId);
      res.json(result);
    } catch (error) {
      console.error('Error disabling plugin:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  });

  /** GET /audit - get audit logs */
  router.get('/audit', async (req: Request, res: Response) => {
    try {
      const { resource, resourceId, userId, action, limit, since } = req.query;
      const logs = await lifecycleService.getAuditLogs({
        resource: resource as string,
        resourceId: resourceId as string,
        userId: userId as string,
        action: action as string,
        limit: limit ? parseInt(limit as string) : undefined,
        since: since ? new Date(since as string) : undefined,
      });
      res.json(logs);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Integration call executors (private to this module)
// ---------------------------------------------------------------------------

async function executeIntegrationCall(
  type: string, method: string, args: unknown[], apiKey: string
): Promise<unknown> {
  switch (type) {
    case 'openai': return executeOpenAICall(method, args, apiKey);
    case 'aws-s3': return executeS3Call(method, args, apiKey);
    case 'sendgrid': return executeSendGridCall(method, args, apiKey);
    default: throw new Error(`Unknown integration type: ${type}`);
  }
}

async function executeOpenAICall(method: string, args: unknown[], apiKey: string): Promise<unknown> {
  const baseUrl = 'https://api.openai.com/v1';

  switch (method) {
    case 'complete': {
      const [prompt, options] = args as [string, { model?: string; maxTokens?: number; temperature?: number }?];
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options?.model || 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens,
        }),
      });
      if (!response.ok) { const error = await response.text(); throw new Error(`OpenAI API error: ${error}`); }
      const data = await response.json();
      return { content: data.choices[0]?.message?.content || '', usage: data.usage };
    }
    case 'chat': {
      const [messages, options] = args as [Array<{role: string; content: string}>, { model?: string; maxTokens?: number }?];
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options?.model || 'gpt-3.5-turbo',
          messages,
          max_tokens: options?.maxTokens,
        }),
      });
      if (!response.ok) { const error = await response.text(); throw new Error(`OpenAI API error: ${error}`); }
      const data = await response.json();
      return { content: data.choices[0]?.message?.content || '', usage: data.usage };
    }
    case 'embed': {
      const [text] = args as [string | string[]];
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-ada-002', input: Array.isArray(text) ? text : [text] }),
      });
      if (!response.ok) { const error = await response.text(); throw new Error(`OpenAI API error: ${error}`); }
      const data = await response.json();
      return { embeddings: data.data.map((d: { embedding: number[] }) => d.embedding) };
    }
    case 'getModels': {
      const response = await fetch(`${baseUrl}/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (!response.ok) throw new Error('Failed to fetch models');
      const data = await response.json();
      return { models: data.data.map((m: { id: string }) => m.id) };
    }
    default: throw new Error(`Unknown OpenAI method: ${method}`);
  }
}

async function executeS3Call(method: string, args: unknown[], _apiKey: string): Promise<unknown> {
  console.log(`S3 call: ${method}`, args);
  return { warning: 'S3 integration requires AWS SDK implementation', method, args };
}

async function executeSendGridCall(method: string, args: unknown[], apiKey: string): Promise<unknown> {
  const baseUrl = 'https://api.sendgrid.com/v3';
  switch (method) {
    case 'send': {
      const [to, subject, body, options] = args as [
        { email: string; name?: string } | Array<{ email: string; name?: string }>,
        string, string, { from?: { email: string; name?: string } }?
      ];
      const recipients = Array.isArray(to) ? to : [to];
      const response = await fetch(`${baseUrl}/mail/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: recipients }],
          from: options?.from || { email: 'noreply@naap.io' },
          subject,
          content: [{ type: 'text/html', value: body }],
        }),
      });
      if (!response.ok && response.status !== 202) {
        const error = await response.text();
        throw new Error(`SendGrid API error: ${error}`);
      }
      return { messageId: response.headers.get('x-message-id') || 'sent' };
    }
    default: throw new Error(`Unknown SendGrid method: ${method}`);
  }
}
