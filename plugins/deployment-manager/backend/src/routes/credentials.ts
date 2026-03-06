import { Router } from 'express';
import type { ProviderAdapterRegistry } from '../services/ProviderAdapterRegistry.js';
import { secretStore } from '../lib/SecretStore.js';
import { resolveUserId } from '../lib/providerFetch.js';

export function createCredentialsRouter(registry: ProviderAdapterRegistry): Router {
  const router = Router();

  router.get('/:slug/credential-status', async (req, res) => {
    const { slug } = req.params;
    if (!registry.has(slug)) {
      res.status(404).json({ success: false, error: `Provider not found: ${slug}` });
      return;
    }

    const adapter = registry.get(slug);
    const config = adapter.apiConfig;

    try {
      const userId = await resolveUserId();
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unable to resolve user identity' });
        return;
      }

      const secretStatus = await secretStore.hasSecrets(userId, slug, config.secretNames);
      const allConfigured = secretStatus.every((s) => s.configured);

      res.json({
        success: true,
        data: {
          configured: allConfigured,
          secrets: secretStatus.map((s) => ({
            name: s.name,
            configured: s.configured,
            maskedValue: s.maskedValue,
          })),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put('/:slug/credentials', async (req, res) => {
    const { slug } = req.params;
    if (!registry.has(slug)) {
      res.status(404).json({ success: false, error: `Provider not found: ${slug}` });
      return;
    }

    const adapter = registry.get(slug);
    const config = adapter.apiConfig;
    const { secrets: secretValues } = req.body as { secrets: Record<string, string> };

    if (!secretValues || typeof secretValues !== 'object') {
      res.status(400).json({ success: false, error: 'Body must contain { secrets: { name: value } }' });
      return;
    }

    const invalidKeys = Object.keys(secretValues).filter(
      (k) => !config.secretNames.includes(k),
    );
    if (invalidKeys.length > 0) {
      res.status(400).json({
        success: false,
        error: `Invalid secret names: ${invalidKeys.join(', ')}. Allowed: ${config.secretNames.join(', ')}`,
      });
      return;
    }

    const emptyKeys = Object.entries(secretValues)
      .filter(([, v]) => !v || !v.trim())
      .map(([k]) => k);
    if (emptyKeys.length > 0) {
      res.status(400).json({
        success: false,
        error: `Secret values cannot be empty: ${emptyKeys.join(', ')}`,
      });
      return;
    }

    try {
      const userId = await resolveUserId();
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unable to resolve user identity' });
        return;
      }

      await secretStore.setSecrets(userId, slug, secretValues);

      res.json({
        success: true,
        data: {
          message: `Credentials saved for ${adapter.displayName}`,
          savedSecrets: Object.keys(secretValues),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/:slug/test-connection', async (req, res) => {
    const { slug } = req.params;
    if (!registry.has(slug)) {
      res.status(404).json({ success: false, error: `Provider not found: ${slug}` });
      return;
    }

    const adapter = registry.get(slug);
    const config = adapter.apiConfig;

    try {
      const userId = await resolveUserId();
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unable to resolve user identity' });
        return;
      }

      const secrets = await secretStore.getSecrets(userId, slug);
      const hasAllSecrets = config.secretNames.every((name) => !!secrets[name]);
      if (!hasAllSecrets) {
        res.json({
          success: true,
          data: {
            success: false,
            error: 'Missing credentials. Save your credentials first, then test the connection.',
          },
        });
        return;
      }

      const testPath = config.healthCheckPath || '/';
      const headers = new Headers({ 'Content-Type': 'application/json' });

      if (config.authType !== 'none' && config.authHeaderTemplate) {
        const secretValue = secrets[config.secretNames[0]] || '';
        const headerValue = config.authHeaderTemplate.replace('{{secret}}', secretValue);
        const headerName = config.authHeaderName || 'Authorization';
        headers.set(headerName, headerValue);
      }

      const start = Date.now();
      const testRes = await fetch(`${config.upstreamBaseUrl}${testPath}`, { headers });
      const latencyMs = Date.now() - start;

      let error: string | undefined;
      if (!testRes.ok) {
        if (testRes.status === 401 || testRes.status === 403) {
          error = 'Authentication failed — check that your API key is correct.';
        } else {
          error = `Provider returned ${testRes.status}`;
        }
      }

      res.json({
        success: true,
        data: {
          success: testRes.ok,
          statusCode: testRes.status,
          latencyMs,
          provider: adapter.displayName,
          error,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
