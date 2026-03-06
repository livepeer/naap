import { Router } from 'express';
import type { ArtifactRegistry } from '../services/ArtifactRegistry.js';

export function createArtifactsRouter(artifactRegistry: ArtifactRegistry): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const artifacts = artifactRegistry.getArtifacts();
    res.json({ success: true, data: artifacts });
  });

  router.get('/:type', (req, res) => {
    const artifact = artifactRegistry.getArtifact(req.params.type);
    if (!artifact) {
      res.status(404).json({ success: false, error: `Unknown artifact type: ${req.params.type}` });
      return;
    }
    res.json({ success: true, data: artifact });
  });

  router.get('/:type/versions', async (req, res) => {
    try {
      const versions = await artifactRegistry.getVersions(req.params.type);
      res.json({ success: true, data: versions });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/:type/latest', async (req, res) => {
    try {
      const latest = await artifactRegistry.getLatestVersion(req.params.type);
      if (!latest) {
        res.status(404).json({ success: false, error: 'No releases found' });
        return;
      }
      res.json({ success: true, data: latest });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
