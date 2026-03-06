import { Router } from 'express';
import type { ProviderAdapterRegistry } from '../services/ProviderAdapterRegistry.js';

export function createProvidersRouter(registry: ProviderAdapterRegistry): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const providers = registry.listProviders();
    res.json({ success: true, data: providers });
  });

  router.get('/:slug', (req, res) => {
    const { slug } = req.params;
    if (!registry.has(slug)) {
      res.status(404).json({ success: false, error: `Provider not found: ${slug}` });
      return;
    }
    const adapter = registry.get(slug);
    res.json({
      success: true,
      data: {
        slug: adapter.slug,
        displayName: adapter.displayName,
        description: adapter.description,
        icon: adapter.icon,
        mode: adapter.mode,
        authMethod: adapter.authMethod,
        secretNames: adapter.apiConfig.secretNames,
      },
    });
  });

  router.get('/:slug/gpu-options', async (req, res) => {
    const { slug } = req.params;
    if (!registry.has(slug)) {
      res.status(404).json({ success: false, error: `Provider not found: ${slug}` });
      return;
    }
    try {
      const adapter = registry.get(slug);
      const gpuOptions = await adapter.getGpuOptions();
      res.json({ success: true, data: gpuOptions });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
