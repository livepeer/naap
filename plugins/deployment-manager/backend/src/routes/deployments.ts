import { Router } from 'express';
import type { DeploymentOrchestrator } from '../services/DeploymentOrchestrator.js';
import type { DeploymentStatus } from '../types/index.js';
import { CreateDeploymentSchema, UpdateDeploymentSchema } from './validation.js';
import { RateLimiter } from '../services/RateLimiter.js';

const deployLimiter = new RateLimiter(10, 60_000); // 10 deploy operations per minute
const writeLimiter = new RateLimiter(30, 60_000);   // 30 writes per minute

export function createDeploymentsRouter(orchestrator: DeploymentOrchestrator): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const { status, provider, userId, teamId } = req.query;
      const deployments = await orchestrator.list({
        status: status as DeploymentStatus | undefined,
        providerSlug: provider as string | undefined,
        ownerUserId: userId as string | undefined,
        teamId: teamId as string | undefined,
      });
      res.json({ success: true, data: deployments, total: deployments.length });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const deployment = await orchestrator.get(req.params.id);
      if (!deployment) {
        res.status(404).json({ success: false, error: 'Deployment not found' });
        return;
      }
      res.json({ success: true, data: deployment });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/:id/history', (req, res) => {
    try {
      const history = orchestrator.getStatusHistory(req.params.id);
      res.json({ success: true, data: history });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const rl = writeLimiter.check(userId);
      if (!rl.allowed) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded', retryAfterMs: rl.resetInMs });
        return;
      }

      const parsed = CreateDeploymentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const teamId = req.headers['x-team-id'] as string | undefined;
      const deployment = await orchestrator.create(parsed.data, userId, teamId);
      res.status(201).json({ success: true, data: deployment });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/:id/deploy', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const rl = deployLimiter.check(userId);
      if (!rl.allowed) {
        res.status(429).json({ success: false, error: 'Deploy rate limit exceeded', retryAfterMs: rl.resetInMs });
        return;
      }
      const deployment = await orchestrator.deploy(req.params.id, userId);
      res.json({ success: true, data: deployment });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/:id/validate', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const deployment = await orchestrator.validate(req.params.id, userId);
      res.json({ success: true, data: deployment });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const rl = writeLimiter.check(userId);
      if (!rl.allowed) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded', retryAfterMs: rl.resetInMs });
        return;
      }

      const parsed = UpdateDeploymentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const deployment = await orchestrator.updateDeployment(req.params.id, parsed.data, userId);
      res.json({ success: true, data: deployment });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/:id/deploy-and-validate', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const maxRetries = parseInt(req.query.retries as string, 10) || 0;
      const result = await orchestrator.deployAndValidate(req.params.id, userId, maxRetries);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/:id/retry', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const result = await orchestrator.retry(req.params.id, userId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const deployment = await orchestrator.destroy(req.params.id, userId);
      res.json({ success: true, data: deployment });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  return router;
}
