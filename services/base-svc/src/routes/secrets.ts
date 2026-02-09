/**
 * Secrets Routes
 *
 * API endpoints for the secret vault and API key mapping management.
 * Handles secure storage of credentials and mapping plugin integrations
 * to their corresponding secret keys.
 */

import { Router, Request, Response } from 'express';
import type { AuditLogInput } from '../services/lifecycle';

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

interface SecretsRouteDeps {
  secretVaultService: {
    storeSecret: (input: any) => Promise<unknown>;
    listSecrets: (scope?: string) => Promise<unknown>;
    deleteSecret: (key: string) => Promise<boolean>;
    rotateSecret: (key: string, value: string, userId: string) => Promise<unknown>;
    getAllKeyMappings: () => Promise<unknown>;
    getPluginKeyMappings: (pluginName: string) => Promise<unknown>;
    createKeyMapping: (input: any) => Promise<unknown>;
    deleteKeyMapping: (pluginName: string, integrationType: string) => Promise<boolean>;
  };
  lifecycleService: {
    audit: (input: AuditLogInput) => Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createSecretsRoutes(deps: SecretsRouteDeps) {
  const { secretVaultService, lifecycleService } = deps;
  const router = Router();

  // ==========================================================================
  // Secret Vault
  // ==========================================================================

  /** POST /secrets - store a secret */
  router.post('/secrets', async (req: Request, res: Response) => {
    try {
      const { key, value, description, scope } = req.body;
      const userId = req.headers['x-user-id'] as string;

      if (!key || !value) {
        return res.status(400).json({ error: 'key and value are required' });
      }

      const metadata = await secretVaultService.storeSecret({
        key, value, description, scope, createdBy: userId,
      });

      await lifecycleService.audit({
        action: 'secret.create',
        resource: 'secret',
        resourceId: key,
        userId,
        details: { scope },
      });

      res.json(metadata);
    } catch (error) {
      console.error('Error storing secret:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /secrets - list secrets (metadata only, no values) */
  router.get('/secrets', async (req: Request, res: Response) => {
    try {
      const scope = req.query.scope as string | undefined;
      const secrets = await secretVaultService.listSecrets(scope);
      res.json(secrets);
    } catch (error) {
      console.error('Error listing secrets:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /secrets/:key - delete a secret */
  router.delete('/secrets/:key', async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      const userId = req.headers['x-user-id'] as string;

      const deleted = await secretVaultService.deleteSecret(key);
      if (!deleted) {
        return res.status(404).json({ error: 'Secret not found' });
      }

      await lifecycleService.audit({
        action: 'secret.delete',
        resource: 'secret',
        resourceId: key,
        userId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting secret:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /secrets/:key/rotate - rotate a secret value */
  router.post('/secrets/:key/rotate', async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      const { value } = req.body;
      const userId = req.headers['x-user-id'] as string;

      if (!value) {
        return res.status(400).json({ error: 'value is required' });
      }

      const metadata = await secretVaultService.rotateSecret(key, value, userId);
      if (!metadata) {
        return res.status(404).json({ error: 'Secret not found' });
      }

      await lifecycleService.audit({
        action: 'secret.rotate',
        resource: 'secret',
        resourceId: key,
        userId,
      });

      res.json(metadata);
    } catch (error) {
      console.error('Error rotating secret:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // API Key Mappings
  // ==========================================================================

  /** GET /key-mappings - list all key mappings */
  router.get('/key-mappings', async (_req: Request, res: Response) => {
    try {
      const mappings = await secretVaultService.getAllKeyMappings();
      res.json(mappings);
    } catch (error) {
      console.error('Error listing key mappings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /key-mappings/:pluginName - get key mappings for a plugin */
  router.get('/key-mappings/:pluginName', async (req: Request, res: Response) => {
    try {
      const { pluginName } = req.params;
      const mappings = await secretVaultService.getPluginKeyMappings(pluginName);
      res.json(mappings);
    } catch (error) {
      console.error('Error fetching key mappings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /key-mappings - create a key mapping */
  router.post('/key-mappings', async (req: Request, res: Response) => {
    try {
      const { pluginName, integrationType, secretKey } = req.body;
      const userId = req.headers['x-user-id'] as string;

      if (!pluginName || !integrationType || !secretKey) {
        return res.status(400).json({ error: 'pluginName, integrationType, and secretKey are required' });
      }

      await secretVaultService.createKeyMapping({ pluginName, integrationType, secretKey });

      await lifecycleService.audit({
        action: 'keyMapping.create',
        resource: 'keyMapping',
        resourceId: `${pluginName}:${integrationType}`,
        userId,
        details: { secretKey },
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error creating key mapping:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /key-mappings/:pluginName/:integrationType - delete a key mapping */
  router.delete('/key-mappings/:pluginName/:integrationType', async (req: Request, res: Response) => {
    try {
      const { pluginName, integrationType } = req.params;
      const userId = req.headers['x-user-id'] as string;

      const deleted = await secretVaultService.deleteKeyMapping(pluginName, integrationType);
      if (!deleted) {
        return res.status(404).json({ error: 'Key mapping not found' });
      }

      await lifecycleService.audit({
        action: 'keyMapping.delete',
        resource: 'keyMapping',
        resourceId: `${pluginName}:${integrationType}`,
        userId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting key mapping:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
