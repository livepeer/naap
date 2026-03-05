import { Router } from 'express';
import type { TemplateRegistry } from '../services/TemplateRegistry.js';

export function createTemplatesRouter(templateRegistry: TemplateRegistry): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const templates = templateRegistry.getTemplates();
    res.json({ success: true, data: templates });
  });

  router.get('/:id', (req, res) => {
    const template = templateRegistry.getTemplate(req.params.id);
    if (!template) {
      res.status(404).json({ success: false, error: `Unknown template: ${req.params.id}` });
      return;
    }
    res.json({ success: true, data: template });
  });

  router.get('/:id/versions', async (req, res) => {
    try {
      const versions = await templateRegistry.getVersions(req.params.id);
      res.json({ success: true, data: versions });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/:id/latest', async (req, res) => {
    try {
      const latest = await templateRegistry.getLatestVersion(req.params.id);
      if (!latest) {
        res.status(404).json({ success: false, error: 'No releases found' });
        return;
      }
      res.json({ success: true, data: latest });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/', (req, res) => {
    try {
      const { id, name, description, icon, dockerImage, defaultVersion, healthEndpoint, healthPort, envVars } = req.body;
      if (!id || !name || !dockerImage) {
        res.status(400).json({ success: false, error: 'id, name, and dockerImage are required' });
        return;
      }
      const template = templateRegistry.addCustomTemplate({
        id,
        name,
        description: description || '',
        icon: icon || '📦',
        dockerImage,
        defaultVersion,
        healthEndpoint: healthEndpoint || '/health',
        healthPort: healthPort || 8080,
        envVars,
      });
      res.status(201).json({ success: true, data: template });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    const removed = templateRegistry.removeCustomTemplate(req.params.id);
    if (!removed) {
      res.status(404).json({ success: false, error: 'Template not found or is a curated template' });
      return;
    }
    res.json({ success: true });
  });

  return router;
}
