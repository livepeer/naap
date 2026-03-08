import { Router } from 'express';
import type { HealthMonitorService } from '../services/HealthMonitorService.js';
import type { DeploymentOrchestrator } from '../services/DeploymentOrchestrator.js';

export function createHealthRouter(
  healthMonitor: HealthMonitorService,
  orchestrator: DeploymentOrchestrator,
): Router {
  const router = Router();

  router.get('/summary', async (_req, res) => {
    const deployments = await orchestrator.list();
    const summary = {
      total: deployments.length,
      green: deployments.filter((d) => d.healthStatus === 'GREEN').length,
      orange: deployments.filter((d) => d.healthStatus === 'ORANGE').length,
      red: deployments.filter((d) => d.healthStatus === 'RED').length,
      unknown: deployments.filter((d) => d.healthStatus === 'UNKNOWN').length,
    };
    res.json({ success: true, data: summary });
  });

  router.post('/check-all', async (_req, res) => {
    try {
      await healthMonitor.checkAll();
      res.json({ success: true, message: 'Health check completed' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/:deploymentId', (req, res) => {
    const logs = healthMonitor.getHealthLogs(
      req.params.deploymentId,
      parseInt(req.query.limit as string, 10) || 50,
    );
    res.json({ success: true, data: logs });
  });

  router.post('/:deploymentId/check', async (req, res) => {
    try {
      const result = await healthMonitor.checkById(req.params.deploymentId);
      if (!result) {
        res.status(404).json({ success: false, error: 'Deployment not found' });
        return;
      }
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
