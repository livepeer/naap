import { Router } from 'express';
import type { DeploymentOrchestrator } from '../services/DeploymentOrchestrator.js';
import type { DeploymentStatus } from '../types/index.js';
import { CreateDeploymentSchema, UpdateDeploymentSchema } from './validation.js';
import { RateLimiter } from '../services/RateLimiter.js';
import { usageService, type InvokeOutcome } from '../services/RequestUsageService.js';
import { authenticatedProviderFetch } from '../lib/providerFetch.js';
import type { ProviderAdapterRegistry } from '../services/ProviderAdapterRegistry.js';

const deployLimiter = new RateLimiter(10, 60_000);
const writeLimiter = new RateLimiter(30, 60_000);

export function createDeploymentsRouter(orchestrator: DeploymentOrchestrator, registry?: ProviderAdapterRegistry): Router {
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

  router.get('/:id/history', async (req, res) => {
    try {
      const history = await orchestrator.getStatusHistory(req.params.id);
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

  router.post('/:id/retry', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const result = await orchestrator.retry(req.params.id, userId);
      res.json({ success: true, data: result });
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

  router.delete('/:id', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const { record, destroyResult } = await orchestrator.destroy(req.params.id, userId);
      res.json({ success: true, data: record, destroyResult });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/:id/force-destroy', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const { record, destroyResult } = await orchestrator.forceDestroy(req.params.id, userId);
      res.json({ success: true, data: record, destroyResult });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/:id/retry-cleanup', async (req, res) => {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const { record, destroyResult } = await orchestrator.retryCleanup(req.params.id, userId);
      res.json({ success: true, data: record, destroyResult });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/:id/invoke', async (req, res) => {
    try {
      const deployment = await orchestrator.get(req.params.id);
      if (!deployment) {
        res.status(404).json({ success: false, error: 'Deployment not found' });
        return;
      }
      if (!deployment.endpointUrl) {
        res.status(400).json({ success: false, error: 'Deployment has no endpoint URL' });
        return;
      }

      const adapter = registry?.get(deployment.providerSlug);
      if (!adapter) {
        res.status(400).json({ success: false, error: `No adapter for provider: ${deployment.providerSlug}` });
        return;
      }

      const runPath = deployment.providerSlug === 'runpod'
        ? `/v2/${deployment.providerDeploymentId}/run`
        : '';
      const invokeUrl = deployment.providerSlug === 'runpod'
        ? 'https://api.runpod.ai'
        : deployment.endpointUrl;

      const start = Date.now();
      const timeoutMs = Number(req.query.timeout) || 30000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let outcome: InvokeOutcome = 'completed';
      try {
        const upstreamRes = await authenticatedProviderFetch(
          deployment.providerSlug,
          { ...adapter.apiConfig, upstreamBaseUrl: invokeUrl },
          runPath,
          {
            method: 'POST',
            body: JSON.stringify(req.body),
            signal: controller.signal,
          },
        );
        clearTimeout(timer);
        const responseTimeMs = Date.now() - start;

        const responseBody = await upstreamRes.text();
        let parsedBody: unknown;
        try { parsedBody = JSON.parse(responseBody); } catch { parsedBody = responseBody; }

        if (!upstreamRes.ok) outcome = 'failed';
        usageService.record(req.params.id, outcome, responseTimeMs);

        res.json({
          success: true,
          data: {
            status: upstreamRes.status,
            statusText: upstreamRes.statusText,
            responseTimeMs,
            body: parsedBody,
          },
        });
      } catch (err: any) {
        clearTimeout(timer);
        outcome = err.name === 'AbortError' ? 'failed' : 'retried';
        usageService.record(req.params.id, outcome, Date.now() - start);
        res.status(504).json({
          success: false,
          error: err.name === 'AbortError' ? `Request timed out after ${timeoutMs}ms` : err.message,
        });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/:id/usage', async (req, res) => {
    try {
      const range = (req.query.range as string) === 'day' ? 'day' : 'hour';
      const stats = usageService.getUsage(req.params.id, range);
      res.json({ success: true, data: stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Pipeline status for livepeer-inference deployments
  router.get('/:id/pipeline-status', async (req, res) => {
    try {
      const deployment = await orchestrator.get(req.params.id);
      if (!deployment) {
        res.status(404).json({ success: false, error: 'Deployment not found' });
        return;
      }

      if (deployment.templateId !== 'livepeer-inference') {
        res.status(400).json({ success: false, error: 'Pipeline status only available for livepeer-inference deployments' });
        return;
      }

      const artifactConfig = deployment.artifactConfig as Record<string, unknown> | undefined;
      const pipelineStatus = {
        capabilityName: artifactConfig?.capabilityName || 'unknown',
        topology: artifactConfig?.topology || 'unknown',
        adapterHealthy: deployment.healthStatus === 'GREEN',
        deploymentStatus: deployment.status,
        healthStatus: deployment.healthStatus,
        endpointUrl: deployment.endpointUrl,
        orchestratorSecret: artifactConfig?.orchestratorSecret ? '***' : undefined,
      };

      res.json({ success: true, data: pipelineStatus });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
